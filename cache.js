var config = require('./config.js');
var oracledb = require('oracledb');
var redis = require("redis");
var async = require('async');


var metasql = "SELECT \n" +
	"  dbms_lob.substr(h.source, 4000, 1) source, \n" +
	"  h.source_type, \n" +
	"  h.handler_id, \n" +
	"  t.uri_template , \n" +
	"  NVL(h.items_per_page, 10) page_size, \n" +
	"  h.workspace, \n" +
	"  h.method, \n" +
	"  m.uri_prefix, \n" +
	"  h.uri_template \n" +
	"FROM \n" +
	"  apex_rest_resource_handlers h, \n" +
	"  apex_rest_resource_templates t, \n" +
	"  apex_rest_resource_modules m \n" +
	"WHERE \n" +
	"  t.template_id = h.template_id \n" +
	"AND t.module_id = m.module_id";

var paramsql = "SELECT parameter_name, param_type, handler_id " +
	"FROM apex_rest_resource_parameters ";

var client = redis.createClient(config.redis.port, config.redis.server, config.redis.options);

client.on("error", function(err) {
	console.log("Error " + err);
});



var callArray = [];

var val = '';

for (c in config.dads) {
	
	val = val + "callArray.push(function(callback) { " +
					"getParam(callback, config.dads['" + c + "']) " +
			  "}); " +
			  "callArray.push(function(callback) { " +
					"getMetaData(callback, config.dads['" + c + "'])" +
			  "});";

}
		  
//console.log(val);


eval(val);


function syncCache(){
	var ret = false;
	async.parallel(callArray, function(err) {
		console.log('Cache update complete!')
		client.end();

	});
	
	return ret;
}

exports.syncCache = syncCache;

function getMetaData(callback, dad) {
	oracledb.getConnection(
		dad,
		function(err, conn) {
			if (err) {
				console.error(err.message);
				callback(err);
			}

			conn.execute(
				'SELECT COUNT(1) FROM apex_rest_resource_handlers ', {},
				function(err, ret) {
					if (err) {
						callback(err);
						return;
					}
					var count = ret.rows[0][0];
					//console.log('count: ', count);
					conn.execute(
						metasql, {}, {
							outFormat: oracledb.OBJECT,
							maxRows: count
						},
						function(err, result) {
							if (err) {
								console.error(err);
								callback(err);
							}
							var mset = [];
							var mpara = [];
							for (var i = 0; i < result.rows.length; i++) {
								mset.push(dad.defaultPage + '|' + result.rows[i].WORKSPACE + '|' + result.rows[i].METHOD + '|' +
									result.rows[i].URI_PREFIX + '|' + result.rows[i].URI_TEMPLATE);
								mset.push(JSON.stringify(result.rows[i]));
							}
							//console.log(mset);

							client.mset(mset, function(err, res) {
								if (err) {
									console.error(err);
									callback(err);
								}
							});

							callback(null);

						});

				}
			)

		});

}


function getParam(callback, dad) {
	oracledb.getConnection(

		dad,
		function(err, conn) {
			if (err) {
				console.error(err.message);
				callback(err);
			}

			conn.execute(
				'SELECT COUNT(1) FROM apex_rest_resource_parameters ', {},
				function(err, ret) {
					if (err) {
						callback(err);
						return;
					}

					var count = ret.rows[0][0];
					//console.log('count: ', count);
					conn.execute(
						paramsql, {}, {
							outFormat: oracledb.OBJECT,
							maxRows: count
						},
						function(err, result) {
							if (err) {
								console.error(err);
								callback(err);
							}
							var mset = [];
							var mpara = [];
							for (var i = 0; i < result.rows.length; i++) {
								mset.push(dad.defaultPage + '|' + result.rows[i].HANDLER_ID + '|' + result.rows[i].PARAMETER_NAME);
								mset.push(JSON.stringify(result.rows[i]));
							}
							//console.log(mset);
							if (mset.length > 0){
								client.mset(mset, function(err, res) {
									if (err) {
										console.error(err);
										callback(err);
									}
								});
							}
							

							callback(null);

						});
				}
			)


		});

}
