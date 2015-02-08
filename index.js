var restify = require('restify');
var oracledb = require('oracledb');
var dbConfig = require('./dbconfig.js');
//var metaConfig = require('./metaconfig.js');

var metaDataSql = "SELECT dbms_lob.substr(source, 4000, 1) source, source_type, handler_id " +
	"FROM apex_rest_resource_handlers " +
	"WHERE workspace = :workspace " +
	"AND method = :method " +
	"AND uri_template = :template";

var metaDataSqlParam = "SELECT dbms_lob.substr(source, 4000, 1) source, source_type, handler_id " +
	"FROM apex_rest_resource_handlers " +
	"WHERE workspace = :workspace " +
	"AND method = :method " +
	"AND uri_template LIKE :template || '{%}'";

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
	if (type === 'Int') {
		var val = req.params[param] ? Number(req.params[param]) : Number(req.header(param));
	} else {
		var val = req.params[param] ? req.params[param] : req.header(param);
	}
	return val;
}

function handleRequest(req, res, next) {
	if (cb.err) {
		err.custMessage = 'Create Oracle DB Pool for Meta Data Error! Error Message';
		restServerError(res, err);
		return;
	}

	if (req.params[0] !== undefined && req.params[1] !== undefined) {
		var workspace = req.params[0].toUpperCase();
		var template = req.params[1].split('/')[0] + '/';
		var query = req.params[1].split('/')[1];
		var method = req.route.method.toUpperCase();

	} else {
		err.custMessage = 'Bad URL'
		restServerError(res, err);
		return;
	}
	var that = {};
	cb.pool.getConnection(
		function(err, connection) {
			if (err) {
				err.custMessage = 'Oracle Pool Get Connect Error';
				restServerError(res, err);
				return;
			}
			connection.execute(
				query ? metaDataSqlParam : metaDataSql, [workspace, method, template], {
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
						err.custMessage = 'Connect execution error';
						restServerError(res, err);
						return;
					}

					if (result.rows.length === 0 || result.rows.length === undefined) {
						err.custMessage = 'Metadata no data found!';
						restServerError(res, err);
						return;
					}

					that.metaData = result.rows;

					that.paramsConn();


				});
		});

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
						err.custMessage = 'Params Connect execution error';
						restServerError(res, err);
						return;
					}
					if (result) that.params = result.rows;

					that.dataConnect();
				}

			});
	};

	that.dataConnect = function() {
		cb.pool.getConnection(
			function(err, conn4data) {
				if (err) {
					err.custMessage = 'Get connect from pool for Data Execution SQL Error';
					restServerError(res, err);
					return;
				}

				var dataSql = that.metaData[0].SOURCE.replace('\n', ' ').replace(',', ' ');
				//var varArr = dataSql.match(/:\w+/g);
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
								type = oracledb.DATE;
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
						err.custMessage = 'Data Connect execution error';
						restServerError(res, err);
						return;
					}
					if (result4data.rows)
						res.send(result4data.rows);
					if (result4data.outBinds)
						res.send(result4data.outBinds);

				}
			});
	};

	return next();
}
