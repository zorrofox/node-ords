var oracledb = require('oracledb');
var config = require('./config.js');
var error = require('./error.js');
var plsql = require('./plsql.js');
var connEvent = require('./event.js');
var URI = require("uri-template-lite").URI;

if (config.useCache){
	var redis = require("redis");

	var client = redis.createClient(config.redis.port, config.redis.server, config.redis.options);

	client.on("error", function (err) {
		console.log("Error " + err);
	});

}



function getMetaDataCache(connection, requestParts, req, res, callback){
	var metaKey = requestParts.dad + '|' + requestParts.proc.toUpperCase() +
		'|' + req.method.toUpperCase() + '|' + requestParts.module + '|';
	var result ={};
	result.dad = requestParts.dad;
	var serverDomain = plsql.serverDomain;
	
	if(!requestParts.uriParams || requestParts.uriParams === '/'){
		metaKey = metaKey + requestParts.template;
	}
	else{
		metaKey = metaKey + requestParts.template + '{*}';
	}

	client.keys(metaKey, serverDomain.bind(function(err, keys){
		if(err) {
			console.error('Error get metaKey ', err);
			return error.send500(err);
		}

		if(!keys || keys.length === 0) return error.send404(res);
		
		client.get(keys[0], function(err, val){
			if (err) throw err;
			var vals = {};
			var rows =[];
			rows.push(JSON.parse(val));
			vals.rows = rows;
			result.metaData = vals;
			callback(null, connection, result);
		})
	}));
}

function getParamsCache(connection, result, req, res, callback){
	var serverDomain = plsql.serverDomain;
	var paramKey = result.dad + '|' + result.metaData.rows[0].HANDLER_ID + '|*';
	console.log(paramKey);
	client.keys(paramKey, serverDomain.bind(function(err, keys){
		
		if (err) console.err('Error get paramKeys ', err);
		if(!keys || keys.length === 0) {
			result.params = {};
			callback(null, connection, result);
			return;
		}
		client.mget(keys, function(err, vals){
			if (err) throw err;

			var ret =[];
			for (var i = 0; i < vals.length; i++){
				ret.push(JSON.parse(vals[i]));
			}
			result.params = {};
			result.params.rows = ret;
			
			callback(null, connection, result);
		});
	}));
}

function getServiceMetaData(connection, requestParts, req, res, callback) {

	var serverDomain = plsql.serverDomain;
	var result = {};

	var sql = "SELECT dbms_lob.substr(h.source, 4000, 1) source, h.source_type, h.handler_id, t.uri_template " +
		", nvl(h.items_per_page, 10) page_size " +
		"FROM apex_rest_resource_handlers h, apex_rest_resource_templates t, apex_rest_resource_modules m " +
		"WHERE t.template_id = h.template_id " +
		"AND t.module_id = m.module_id " +
		"AND h.workspace = :workspace " +
		"AND h.method = :method " +
		"AND m.uri_prefix = :prefix ";
	

	if(!requestParts.uriParams || requestParts.uriParams === '/'){
		sql += "AND h.uri_template = :template ";
	}
	else{
		sql += "AND h.uri_template LIKE :template || '{%}'";
	}

	var bind = [requestParts.proc.toUpperCase(), req.method.toUpperCase(), requestParts.module, requestParts.template];

	//console.log('sql',sql);
	//console.log('bind',bind);

	connection.execute(
		sql, bind, {
			outFormat: oracledb.OBJECT
		},
		serverDomain.bind(function(err, results) {
			if (err) {
				console.error('Error executing plsql code', err.message);
				connection.release(serverDomain.bind(function(err) {
					if (err) throw err;
					connEvent.myConnEvent.freeCon();
				}));
				return error.send500(res);
			}


			if(results.rows.length == 0){
				connection.release(serverDomain.bind(function(err) {
					if (err) throw err;
				}));
				return error.send404(res);
			}
			result.metaData = results
			callback(null, connection, result);
		})
	);

}

function getServiceParams(connection, result, req, res, callback) {

	var serverDomain = plsql.serverDomain;
	var paramsSql = "SELECT parameter_name, param_type " +
		"FROM apex_rest_resource_parameters " +
		"WHERE handler_id = :handler_id ";

	connection.execute(
		paramsSql, [result.metaData.rows[0].HANDLER_ID + ''], {
			outFormat: oracledb.OBJECT
		},
		serverDomain.bind(function(err, results) {
			if (err) {
				console.error('Error executing plsql code', err.message);
				connection.release(serverDomain.bind(function(err) {
					if (err) throw err;
					connEvent.myConnEvent.freeCon();
				}));
				return error.send500(res);
			}

			// Release the connection back to the connection pool
			result.params = results;
			callback(null, connection, result);
		}));

}

function handleService(connection, result, requestParts, req, res, callback) {


	//console.log('params', params);
	//console.log('metaData', metaData);
	var serverDomain = plsql.serverDomain;
	var binds ={};
	var plsqlBlock;
	var body ={};

	var template = new URI.Template(result.metaData.rows[0].URI_TEMPLATE);
	var uriParams = template.match(requestParts.template + requestParts.uriParams.substr(1));
	var allParams = result.metaData.rows[0].SOURCE.toLowerCase().match(/:\w+/g);
	
	

	if (result.params.rows && result.params.rows.length > 0) {
		for (i = 0; i < result.params.rows.length; i++) {
			var type;
			var index = allParams.indexOf(':' + result.params.rows[i].PARAMETER_NAME.toLowerCase());
			if(index != -1){
				allParams.splice(index, 1);
			}
			
			if (result.params.rows[i].PARAM_TYPE === 'String')
				type = oracledb.STRING;
			else {
				if (result.params.rows[i].PARAM_TYPE === 'Timestamp')
				//TO-DO add some logic to support date value
					type = oracledb.STRING;
				else
					type = oracledb.NUMBER;
			}
			binds[result.params.rows[i].PARAMETER_NAME.toLowerCase()] = {
				type: type,
				dir: oracledb.BIND_IN,
				val: getValFunction(req, result.params.rows[i].PARAMETER_NAME.toLowerCase(), result.params.rows[i].PARAM_TYPE, uriParams)
			};
		}
	}
	
	//Get the bind param values from request params, not need regist in the APEX
	//All the parameter names in the request body will update to lower case.
	for(var c in req.body){
		var v = req.body[c]
		delete req.body[c];
		req.body[c.toLowerCase()] = v;
	}
	if(allParams){
		for (var i = 0; i<allParams.length; i++){
			if(allParams[i] === ':body'){
				binds.body = {
					dir: oracledb.BIND_IN,
					type: oracledb.STRING,
					val: JSON.stringify(req.body)
				}
			}
			else{
				binds[allParams[i].substr(1)] = {
					dir: oracledb.BIND_IN,
					type: oracledb.STRING,
					val: req.body[allParams[i].substr(1)]
				}
			}
		
		}
	}

	if (result.metaData.rows[0].SOURCE_TYPE === 'PL/SQL') {

		binds.nalHtbuf1 = {
				dir: oracledb.BIND_OUT,
				type: oracledb.STRING,
				maxSize: 32767
			};
		binds.nalHtbuf2 = {
				dir: oracledb.BIND_OUT,
				type: oracledb.STRING,
				maxSize: 32767
			};
		binds.nalHtbuf3 = {
				dir: oracledb.BIND_OUT,
				type: oracledb.STRING,
				maxSize: 32767
			};
		binds.nalHtbuf4 = {
				dir: oracledb.BIND_OUT,
				type: oracledb.STRING,
				maxSize: 32767
			};
		binds.nalHtbuf5 = {
				dir: oracledb.BIND_OUT,
				type: oracledb.STRING,
				maxSize: 32767
			};
		
		var dataSql = result.metaData.rows[0].SOURCE;

		plsqlBlock = 'DECLARE \n' + 
					 '	vc owa.vc_arr; \n' +
					 '	page htp.htbuf_arr; \n' + 
					 '	num INTEGER := 99999999; \n' + 
					 'BEGIN \n' +
					 '	owa.init_cgi_env(vc); \n' +
					 '	htp.init; htp.htbuf_len := 63; \n' +
					  dataSql + 
					 '	htp.get_page(page, num); \n' +
					 "   FOR x IN 4 .. page.count \n" +
					 "   LOOP \n" +
					 "      IF x BETWEEN 1 AND 400 \n" +
					 "      THEN \n" +
					 "         :nalHtbuf1 := :nalHtbuf1 || page(x); \n" +
					 "      ELSIF x BETWEEN 401 AND 800 \n" +
					 "      THEN \n" +
					 "         :nalHtbuf2 := :nalHtbuf2 || page(x); \n" +
					 "      ELSIF x BETWEEN 801 AND 1200 \n" +
					 "      THEN \n" +
					 "         :nalHtbuf3 := :nalHtbuf3 || page(x); \n" +
					 "      ELSIF x BETWEEN 1201 AND 1600 \n" +
					 "      THEN \n" +
					 "         :nalHtbuf4 := :nalHtbuf4 || page(x); \n" +
					 "      ELSIF x BETWEEN 1601 AND 2000 \n" +
					 "      THEN \n" +
					 "         :nalHtbuf5 := :nalHtbuf5 || page(x); \n" +
					 "      END IF; \n" +
					 "   END LOOP; \n" +
					 'END;';


	} 
	else {

		var pageNum = Number(requestParts.urlParts.query.page?requestParts.urlParts.query.page:'0');
		if(pageNum > 0){
			body.first = {};
			body.previous = {};
			body.first.$ref = 'http://' + req.headers.host + requestParts.urlParts.pathname;
			if(pageNum > 1){
				body.previous.$ref = 'http://' + req.headers.host + requestParts.urlParts.pathname + '?page=' + (pageNum - 1)
			}else{
				body.previous.$ref = 'http://' + req.headers.host + requestParts.urlParts.pathname;
			}
		}
		body.next = {};
		body.next.$ref = 'http://' + req.headers.host + requestParts.urlParts.pathname + '?page=' + (pageNum + 1);
		

		plsqlBlock = 'SELECT * FROM ( SELECT t.*, rownum rn FROM ( ' + result.metaData.rows[0].SOURCE + ' ) t WHERE rownum <= ' + 
			((pageNum + 1)*result.metaData.rows[0].PAGE_SIZE) + ' ) WHERE rn > ' + (pageNum*result.metaData.rows[0].PAGE_SIZE);

	}

	//console.log('binds', binds);
	//console.log('plsqlBlock', plsqlBlock);
	connection.execute(
		plsqlBlock,
		binds, {
			outFormat: oracledb.OBJECT
		},
		serverDomain.bind(function(err, results) {
			// Release the connection back to the connection pool
			connection.release(serverDomain.bind(function(err) {
				if (err) throw err;
				connEvent.myConnEvent.freeCon();
			}));

			if (err) {
				console.error('Error executing sql code', err.message);
				return error.send500(res);
			}

			res.writeHead(200, {'Content-Type': 'application/json'});
			if (result.metaData.rows[0].SOURCE_TYPE === 'PL/SQL') {
				body.items = results.outBinds.nalHtbuf1 + results.outBinds.nalHtbuf2 + results.outBinds.nalHtbuf3 +
					results.outBinds.nalHtbuf4 + results.outBinds.nalHtbuf5;
				res.end(body.items);
			}
			else{
				body.itmes = results.rows;
				res.end(JSON.stringify(body));
			}

			callback(null);
		})
	);

}

function getValFunction(req, parameterName, parameterType, uriParams) {
	
	if (parameterType === 'Int' || parameterType === 'Long' || parameterType === 'Double') {
		var val = req.header(parameterName) ? Number(req.header(parameterName)) : Number(uriParams[parameterName]);
		if (isNaN(val)) val = undefined;
	} else {
		if (parameterType === 'Timestamp') {
			//var val = new Date(req.params[param]);
			var val = req.header(parameterName) ? req.header(parameterName) : uriParams[parameterName];
		} else {
			var val = req.header(parameterName) ? req.header(parameterName) : uriParams[parameterName];
		}
	}
	return val;
}

exports.handleService = handleService;
exports.getServiceParams = getServiceParams;
exports.getServiceMetaData = getServiceMetaData;
exports.getMetaDataCache = getMetaDataCache;
exports.getParamsCache = getParamsCache;
