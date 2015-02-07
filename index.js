var restify = require('restify');
var oracledb = require('oracledb');
var dbConfig = require('./metaconfig.js');//require('./dbconfig.js');
//var metaConfig = require('./metaconfig.js');

var metaDataSql = "SELECT dbms_lob.substr(source, 4000, 1) source, source_type " +
	"FROM apex_rest_resource_handlers " +
	"WHERE workspace = :workspace " +
	"AND method = :method " +
	"AND uri_template = :template";

var metaDataSqlParam = "SELECT dbms_lob.substr(source, 4000, 1) source, source_type " +
	"FROM apex_rest_resource_handlers " +
	"WHERE workspace = :workspace " +
	"AND method = :method " +
	"AND uri_template LIKE :template || '{%}'";

// Create REST Server
var server = restify.createServer({
	name: 'Node Oracle RESTfull',
	version: '1.0.0'
});

var routeReg = /^\/([a-zA-Z0-9_\.~-]+)\/(.*)/;


server.use(restify.acceptParser(server.acceptable));
server.use(restify.queryParser());
server.use(restify.bodyParser());

server.get('/echo/:name', function(req, res, next) {
	res.send(req.params);
	return next();
});

function restServerError(res, err) {
	console.error(err);
	res.send(503, err);
}

oracledb.createPool(dbConfig,
	function(err, pool) {
		server.get(routeReg, handleRequest);
		server.post(routeReg, handleRequest);

		function handleRequest(req, res, next) {
			if (err) {
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
			pool.getConnection(
				function(err, connection) {
					if (err) {
						err.custMessage('Oracle Pool Get Connect Error');
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


							pool.getConnection(
								function(err, conn4data) {
									if (err) {
										err.custMessage = 'Get connect from pool for Execution SQL Error';
										restServerError(res, err);
										return;
									}

									var dataSql = result.rows[0].SOURCE.replace('\n', ' ');
									//var varArr = dataSql.match(/:\w+/g);
									var valueArr = [query];
									var valueObj = {};

									if (result.rows[0].SOURCE_TYPE === 'PL/SQL') {
										dataSql = 'DECLARE vc owa.vc_arr; page htp.htbuf_arr; num INTEGER := 99999999; BEGIN owa.init_cgi_env(vc); ' +
											dataSql + 'owa.get_page(page, num); FOR i in 4..page.last LOOP :out := :out || page(i); END LOOP; END;';

										conn4data.execute(
											dataSql, {
												out: {
													type: oracledb.STRING,
													dir: oracledb.BIND_OUT
												}
											},
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
						});
				});
			return next();
		}
	});


server.listen(8081, function() {
	console.log('%s listening at %s', server.name, server.url);
});
