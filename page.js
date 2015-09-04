var oracledb = require('oracledb');
var config = require('./config.js');
var error = require('./error.js');
var plsql = require('./plsql.js');
var connEvent = require('./event.js');


function executePlsql(connection, requestParts, req, res, callback) {
	var binds;
	var envVars = {};
	var plsqlBlock;
	var cleanKey;
	var serverDomain = plsql.serverDomain;

	binds = {
		nalHtbuf: {
			dir: oracledb.BIND_OUT,
			type: oracledb.CLOB
		}
	};

	for (key in req.headers) {
		cleanKey = key.replace(/[^A-Za-z0-9\._#$]+/g, '');
		envVars[key] = ':nal' + cleanKey;
		binds['nal' + cleanKey] = req.headers[key];
	}

	envVars['APEX_LISTENER_VERSION'] = '2.0.8.163.10.40';
	envVars['DAD_NAME'] = ':nalDadName';
	binds['nalDadName'] = requestParts.dad;
	envVars['DOC_ACCESS_PATH'] = '';
	envVars['DOCUMENT_TABLE'] = '';
	envVars['GATEWAY_IVERSION'] = '3';
	envVars['GATEWAY_INTERFACE'] = 'CGI/1.1';
	envVars['HTTP_ACCEPT'] = ':nalHttpAccept';
	binds['nalHttpAccept'] = req.headers.accept;
	envVars['HTTP_ACCEPT_ENCODING'] = ':nalHttpAcceptEncoding';
	binds['nalHttpAcceptEncoding'] = req.headers['accept-encoding'];
	envVars['HTTP_ACCEPT_LANGUAGE'] = ':nalHttpAcceptLanguage';
	binds['nalHttpAcceptLanguage'] = req.headers['accept-language'];
	envVars['HTTP_ACCEPT_CHARSET'] = ':nalHttpAcceptCharset';
	binds['nalHttpAcceptCharset'] = req.headers['accept-charset'];
	envVars['HTTP_IF_MODIFIED_SINCE'] = '';
	envVars['HTTP_IF_NONE_MATCH'] = '';
	envVars['HTTP_HOST'] = ':nalHttpHost';
	binds['nalHttpHost'] = req.hostname + ':' + config.port.toString();
	envVars['HTTP_ORACLE_ECID'] = '';
	envVars['HTTP_PORT'] = ':nalHttpPort';
	binds['nalHttpPort'] = config.port.toString();
	envVars['HTTP_REFERER'] = ':nalHttpReferer';
	binds['nalHttpReferer'] = req.headers.referer;
	envVars['HTTP_USER_AGENT'] = ':nalHttpUserAgent';
	binds['nalHttpUserAgent'] = req.headers['user-agent'];
	envVars['PATH_ALIAS'] = '';
	envVars['PATH_INFO'] = ':nalPathInfo';
	binds['nalPathInfo'] = '/' + requestParts.proc;
	envVars['PLSQL_GATEWAY'] = 'WebDb';
	envVars['QUERY_STRING'] = ':nalQueryString';
	binds['nalQueryString'] = requestParts.urlParts.search.replace(/^\?/, '');
	envVars['REMOTE_ADDR'] = '0:0:0:0:0:0:0:1';
	envVars['REMOTE_USER'] = 'apex';
	envVars['REQUEST_CHARSET'] = 'AL32UTF8';
	envVars['REQUEST_IANA_CHARSET'] = 'UTF-8';
	envVars['REQUEST_METHOD'] = ':nalRequestMethod';
	binds['nalRequestMethod'] = req.method;
	envVars['REQUEST_PROTOCOL'] = ':nalRequestProtocol';
	binds['nalRequestProtocol'] = req.protocol;
	envVars['REQUEST_SCHEME'] = ':nalRequestScheme';
	binds['nalRequestScheme'] = req.protocol;
	envVars['SCRIPT_NAME'] = ':nalScriptName';
	binds['nalScriptName'] = '/' + requestParts.dad;
	envVars['SCRIPT_PREFIX'] = '';
	envVars['SERVER_NAME'] = ':nalServerName';
	binds['nalServerName'] = req.hostname;
	envVars['SERVER_PORT'] = ':nalServerPort';
	binds['nalServerPort'] = config.port.toString();
	envVars['SERVER_PROTOCOL'] = 'HTTP/1.1';
	envVars['SERVER_SOFTWARE'] = 'Mod-Apex';
	envVars['WEB_AUTHENT_PREFIX'] = '';
	envVars['HTTP_COOKIE'] = ':nalHttpCookie';
	binds['nalHttpCookie'] = req.headers.cookie;

	plsqlBlock = buildPlsqlBlock(requestParts, req, binds, envVars);

	//console.log('binds', binds);
	//console.log('plsqlBlock', plsqlBlock);
	//console.log('req.body', req.body);
	//console.log('req.files', req.files);

	connection.execute(
		plsqlBlock,
		binds,
		serverDomain.bind(function(err, results) {
			// Release the connection back to the connection pool
			connection.release(serverDomain.bind(function(err) {
				if (err) throw err;
				connEvent.myConnEvent.freeCon();
			}));
			
			if (err) {
				console.error('Error executing plsql code', err.message);
				return error.send500(res);
			}

			callback(null, res, results);
		})
	);
}

//This function is currently handles dynamic binds
//because the driver doesn't yet support arrays

function buildPlsqlBlock(requestParts, req, binds, envVars) {
	var procMappings = config.tempParamMappings[requestParts.proc] || {};
	var params = (req.method === 'POST') ? req.body : requestParts.urlParts.query;
	var paramValues;
	var paramValueIdx;
	var envVarCount = 0;
	var plsqlBlock = "";

	plsqlBlock += "" +
		"DECLARE \n" +
		" \n" +
		"   l_param_names  OWA.VC_ARR; \n" +
		"   l_param_values OWA.VC_ARR; \n" +
		"   l_htbuf        SYS.HTP.HTBUF_ARR; \n" +
		"   l_rows         INTEGER := 9999999999; \n" +
		" \n";

	for (paramName in procMappings) {
		plsqlBlock += '   ' + paramName + ' ' + procMappings[paramName] + '; \n';
	}

	plsqlBlock += "" +
		" \n" +
		"BEGIN \n" +
		" \n" +
		"   EXECUTE IMMEDIATE q'[alter session set nls_language='AMERICAN' nls_territory='AMERICA']'; \n" +
		"   sys.dbms_session.modify_package_state(sys.dbms_session.reinitialize); \n" +
		"   sys.htp.init; \n" +
		"   sys.htp.htbuf_len := 63; \n" +
		" \n";

	//Add in envVars
	for (varName in envVars) {
		envVarCount += 1;

		plsqlBlock += '   l_param_names(' + envVarCount + ') := ' + '\'' + varName + '\'; \n' +
			'   l_param_values(' + envVarCount + ') := ' +
			((envVars[varName].lastIndexOf(':', 0) === 0) ? envVars[varName] : "'" + envVars[varName] + "'") +
			'; \n';
	}

	plsqlBlock += "" +
		" \n" +
		"   sys.owa.init_cgi_env( \n" +
		"      num_params => l_param_names.count, \n" +
		"      param_name => l_param_names, \n" +
		"      param_val  => l_param_values \n" +
		"   ); \n" +
		" \n";

	//Add standard binds

	for (paramName in params) {
		if (procMappings[paramName] === undefined) {
			binds[paramName] = params[paramName];
		}
	}

	//Add dynamic binds
	for (paramName in procMappings) {
		paramValues = params[paramName];

		if (typeof paramValues === 'string') {
			paramValues = [paramValues];
		} else if (paramValues === undefined) {
			paramValues = [];
		}

		for (paramValueIdx = 0; paramValueIdx < paramValues.length; paramValueIdx += 1) {
			plsqlBlock += '   ' + paramName + '(' + (paramValueIdx + 1) + ') := :' +
				paramName + '_' + (paramValueIdx + 1) + '; \n';

			binds[paramName + '_' + (paramValueIdx + 1)] = paramValues[paramValueIdx];
		}
	}

	//Add in the procedure call
	plsqlBlock += '   ' + requestParts.proc + '(\n';

	for (paramName in params) {
		plsqlBlock += '      ' + paramName + ' => ' +
			((procMappings[paramName]) ? '' : ':') + paramName + ',\n';

		if (!procMappings[paramName]) {
			binds[paramName] = params[paramName];
			console.log(params[paramName]);
		}
	}

	plsqlBlock = '   ' + plsqlBlock.replace(/,\n$/, '') + '\n   ); \n';

	//Finish up the block


	plsqlBlock += "" +
		" \n" +
		"   sys.owa.get_page(l_htbuf, l_rows); \n" +
		"   dbms_lob.createtemporary(:nalHtbuf, TRUE, dbms_lob.session); \n" +
		" \n" +
		"   FOR x IN 1 .. l_htbuf.count \n" +
		"   LOOP \n" +
		"      dbms_lob.append(:nalHtbuf, l_htbuf(x)); \n" +
		"   END LOOP; \n" +
		" \n" +
		"END;";

	return plsqlBlock;
}

function returnPage(res, results, callback) {
	var htbuf = results.outBinds.nalHtbuf;
	htbuf.on('error', function(err) { console.error(err); });

	var htbuf1 = '';
	htbuf.on('data',function(buffer){
  		var part = buffer.toString();
  		htbuf1 += part;
	});


	htbuf.on('end',function(){
 		var header;
		var headerLines = [];
		var headerMap = {};
		var headerEnd;
		var body;

		headerEnd = htbuf1.indexOf('\n\n');


		if (headerEnd === -1) {
			header = htbuf1;
		} else {
			header = htbuf1.substring(0, headerEnd);
			body = htbuf1.substring(headerEnd + 2);
		}

		headerLines = header.split('\n');

		headerLines.forEach(function(line) {
			var lineParts = line.split(': ');

			if (lineParts[0] && lineParts[0] != 'X-ORACLE-IGNORE' && !lineParts[0].match(/content-length/i)) {
				headerMap[lineParts[0]] = lineParts[1];
			}
		});


		if (headerMap['Location']) {
			res.writeHead(302, headerMap);
		} else {
			res.writeHead(200, headerMap);
		}

		res.end(body);

		callback(null);
	});



}

exports.executePlsql = executePlsql;
exports.returnPage = returnPage;