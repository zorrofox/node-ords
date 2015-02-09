var restify = require('restify');
var oracledb = require('oracledb');
var dbConfig = require('./dbconfig.js');
//var metaConfig = require('./metaconfig.js');

var metaDataSql = "SELECT dbms_lob.substr(h.source, 4000, 1) source, h.source_type, h.handler_id " +
	"FROM apex_rest_resource_handlers h, apex_rest_resource_templates t, apex_rest_resource_modules m " +
	"WHERE t.template_id = h.template_id " +
	"AND t.module_id = m.module_id " +
	"AND h.workspace = :workspace " +
	"AND h.method = :method " +
	"AND h.uri_template = :template " +
	"AND m.uri_prefix = :prefix";

var metaDataSqlParam = "SELECT dbms_lob.substr(h.source, 4000, 1) source, h.source_type, h.handler_id " +
	"FROM apex_rest_resource_handlers h, apex_rest_resource_templates t, apex_rest_resource_modules m " +
	"WHERE t.template_id = h.template_id " +
	"AND t.module_id = m.module_id " +
	"AND h.workspace = :workspace " +
	"AND h.method = :method " +
	"AND h.uri_template LIKE :template || '/{%}'" +
	"AND m.uri_prefix = :prefix";

var paramsSql = "SELECT parameter_name, param_type " +
	"FROM apex_rest_resource_parameters " +
	"WHERE handler_id = :handler_id ";

// Create REST Server
var server = restify.createServer({
	name: 'Node Oracle RESTfull',
	version: '1.0.0'
});

var routeReg = /^\/([a-zA-Z0-9_\.~-]+)\/(.*)/;


server.use(restify.acceptParser(server.acceptable));
server.use(restify.queryParser());
server.use(restify.bodyParser());

oracledb.createPool(dbConfig, poolCB);


server.listen(8081, function() {
	console.log('%s listening at %s', server.name, server.url);
});



function restServerError(res, err) {
	err.message = err.custMessage + '  Error message: ' + err.message;
	console.error(err);
	res.send(503, err);
}

var cb = {};

function poolCB(err, pool) {

	cb.err = err;
	cb.pool = pool;
	server.get(routeReg, handleRequest);
	server.post(routeReg, handleRequest);
	server.put(routeReg, handleRequest);
	server.del(routeReg, handleRequest);
}

function releaseConnect(conn, res) {
	conn.release(
		function(err) {
			if (err) {
				err.custMessage = 'Connection release error';
				restServerError(res, err);
				return;
			}
		});
}

function getParamsFunction(req, param, type) {
	if (type === 'Int' || type === 'Long' || type === 'Double') {
		var val = req.params[param] ? Number(req.params[param]) : Number(req.header(param));
	} else {
		if (type === 'Timestamp') {
			//var val = new Date(req.params[param]);
			var val = req.params[param] ? req.params[param] : req.header(param);;
		} else {
			var val = req.params[param] ? req.params[param] : req.header(param);
		}
	}
	return val;
}

function handleRequest(req, res, next) {
	res.charSet('utf-8');
	if (cb.err) {
		err.custMessage = 'Create Oracle DB Pool for Meta Data Error! Error Message';
		restServerError(res, err);
		return;
	}

	if (req.params[0] !== undefined && req.params[1] !== undefined) {
		var workspace = req.params[0].toUpperCase();
		var uri = req.params[1].split('/');
		var prefix = uri[0] + '/';
		var template = uri[1];
		var query = uri[2];
		// Logic for tempalte end with slash but have no query strings
		if (!query && req.params[1].substr(req.params[1].length - 1) === '/') template = template + '/';
		var method = req.route.method.toUpperCase();

	} else {
		err.custMessage = 'Bad URL'
		restServerError(res, err);
		return;
	}
	var that = {};
	//Connect for meta data
	cb.pool.getConnection(
		function(err, connection) {
			if (err) {
				err.custMessage = 'Oracle Pool Get Connect Error';
				restServerError(res, err);
				return;
			}
			//console.log(workspace + ' ' + method + ' ' + template + ' ' + prefix + ' ' + query);
			var querySql = query ? metaDataSqlParam : metaDataSql;
			connection.execute(
				querySql , [workspace, method, template, prefix], {
					outFormat: oracledb.OBJECT
				},
				function(err, result) {
					/* Release the connection back to the connection pool */
					connection.release(
						function(err) {
							if (err) {
								err.custMessage = 'Meta data connection release error';
								restServerError(res, err);
								return;
							}
						});

					if (err) {
						err.errorSql = querySql;
						err.sqlParams = [workspace, method, template, prefix];
						err.custMessage = 'Meta data connect execution error';
						restServerError(res, err);
						return;
					}

					if (result.rows.length === 0 || result.rows.length === undefined) {
						var err = {};
						err.errorSql = querySql;
						err.sqlParams = [workspace, method, template, prefix];
						err.custMessage = 'Metadata no data found!';
						restServerError(res, err);
						return;
					}

					that.metaData = result.rows;

					that.paramsConn();


				});
		});

	// Connect for Params

	that.paramsConn = function() {
		cb.pool.getConnection(
			function(err, conn4params) {
				if (err) {
					err.custMessage = 'Get connect from pool for Params Execution SQL Error';
					restServerError(res, err);
					return;
				}
				conn4params.execute(paramsSql, [String(that.metaData[0].HANDLER_ID)], {
					outFormat: oracledb.OBJECT
				}, execFunc);

				function execFunc(err, result) {
					releaseConnect(conn4params, res);
					if (err) {
						err.errorSql = paramsSql;
						err.sqlParams = that.metaData[0].HANDLER_ID;
						err.custMessage = 'Params Connect execution error';
						restServerError(res, err);
						return;
					}
					if (result) that.params = result.rows;

					that.dataConnect();
				}

			});
	};

	// Connect for data

	that.dataConnect = function() {
		cb.pool.getConnection(
			function(err, conn4data) {
				if (err) {
					err.custMessage = 'Get connect from pool for Data Execution SQL Error';
					restServerError(res, err);
					return;
				}

				var dataSql = that.metaData[0].SOURCE;
				var valueArr = [query];
				var valueObj = {};
				var bindVar = {
					out: {
						type: oracledb.STRING,
						dir: oracledb.BIND_OUT
					}
				};

				if (that.params) {
					for (i = 0; i < that.params.length; i++) {
						var type;
						if (that.params[i].PARAM_TYPE === 'String')
							type = oracledb.STRING;
						else {
							if (that.params[i].PARAM_TYPE === 'Timestamp')
								//TO-DO add some logic to support date value
								type = oracledb.STRING;
							else
								type = oracledb.NUMBER;
						}
						bindVar[that.params[i].PARAMETER_NAME.toLowerCase()] = {
							type: type,
							dir: oracledb.BIND_IN,
							val: getParamsFunction(req, that.params[i].PARAMETER_NAME, that.params[i].PARAM_TYPE)
						};
					}
				}

				if (that.metaData[0].SOURCE_TYPE === 'PL/SQL') {

					dataSql = 'DECLARE vc owa.vc_arr; page htp.htbuf_arr; num INTEGER := 99999999; BEGIN owa.init_cgi_env(vc); htp.init; ' +
						dataSql + 'htp.get_page(page, num); :out := \'\'; FOR i in 4..page.last LOOP :out := :out || page(i); END LOOP; END;';

					conn4data.execute(
						dataSql, bindVar,
						execFunc);

				} else {
					conn4data.execute(
						dataSql,
						query ? valueArr : valueObj, {
							outFormat: oracledb.OBJECT
						},
						execFunc);

				}

				function execFunc(err, result4data) {
					conn4data.release(
						function(err) {
							if (err) {
								err.custMessage = 'Data Connection Release Error';
								restServerError(res, err);
								return;
							}
						});

					if (err) {
						err.errorSql = dataSql;
						err.sqlParams = bindVar;
						err.custMessage = 'Data Connect execution error';
						restServerError(res, err);
						return;
					}
					if (result4data.rows)
						res.send(result4data.rows);
					if (result4data.outBinds) {
						try {
							res.send(JSON.parse(result4data.outBinds.out));
						} catch (err) {
							err.custMessage = 'Your PL/SQL function do not return a json body!';
							restServerError(res, err);
							return;
						}

					}
				}
			});
	};

	return next();
}
