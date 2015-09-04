/* Copyright (c) 2015, Oracle and/or its affiliates. All rights reserved. */

/******************************************************************************
 *
 * You may not use the identified files except in compliance with the Apache
 * License, Version 2.0 (the "License.")
 *
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0.
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * NAME
 *   plsql.js
 *
 * DESCRIPTION
 *   The bulk of the logic for the module. Executes PL/SQL code and then
 *   sends the HTP buffer contents to the client.
 *
 *****************************************************************************/

var async = require('async');
var url = require('url');
var oracledb = require('oracledb');
var config = require('./config.js');
var error = require('./error.js');
var page = require('./page.js');
var service = require('./service.js');


var serverDomain;
//var poolCache = {};
var connEvent = require('./event.js');
var pid;



var useCache = config.useCache;

if (useCache){
	var cache = require('./cache.js');
	cache.syncCache();
}


function requestHandler(req, res, next, workerPid, poolCache, sd) {

	var requestParts = parseRequest(req.url);
	var pid = workerPid;

	//console.log('PID %s handle this request!', workerPid);
	//console.log('requestParts', requestParts);
	
	if (requestParts.err) {
		//Redirect the home page to f?p=4550 defult APEX application
		var newPath = requestParts.urlParts.pathname.replace(/\//g,'');
		if (config.dads[newPath]) {
			res.redirect('/' + newPath + '/f?p=4550');
		}
		else{
			return error.send404(res);
		}
	}

	else{

		serverDomain = sd;
		exports.serverDomain = serverDomain;


		//var result = {};

		if (requestParts.service) {
			async.waterfall([
				function(callback) {
					getConnection(poolCache[requestParts.dad], pid, callback);
				},
				function(connection, callback) {
					if (useCache){
						service.getMetaDataCache(connection, requestParts,
							req, res, callback);
					}
					else{
						connection.module = 'NODEJS-APEX-REST-' + pid;
						connection.action = pid + '|' + 'getServiceMetaData';
						service.getServiceMetaData(connection, requestParts,
							 req, res, callback);
					}
					
					
				},
				function(connection, result, callback) {
					if(useCache){
						service.getParamsCache(connection, result, req, res, callback);
					}
					else{
						connection.module = 'NODEJS-APEX-REST-' + pid;
						connection.action = pid + '|' + 'getServiceParams';
						service.getServiceParams(connection, result, req, res, callback);
					}

				},
				function(connection, result, callback) {
					connection.module = 'NODEJS-APEX-REST-' + pid;
					connection.action = pid + '|' + 'handleService';
					service.handleService(connection, result, requestParts,
							 req, res, callback);
				}
			], function(err) {
				if (err) throw err;

				next();
			});
		} else {
			async.waterfall([
				function(callback){
					getConnection(poolCache[requestParts.dad], pid, callback);
				},
				function(connection, callback) {
					connection.module = 'NODEJS-APEX-PAGE-' + pid;
					connection.action = pid + '|' + 'pageExecutePlsql';
					page.executePlsql(connection, requestParts, req, res, callback);
				},
				function(res, results, callback) {
					page.returnPage(res, results, callback);
				}
			], function(err) {
				if (err) throw err;

				next();
			});
		}

	}

}

function parseRequest(u) {
	var retval = {};
	var pathParts;

	retval.urlParts = url.parse(u, true);

	pathParts = retval.urlParts.pathname.split('/');
	pathParts.shift(); //first element is empty, get rid of it

	retval.err = false;
	
	/*********************************************************************************************
	   Support APEX page and RESTful service URLs:
	   1. Apex Page only have two path parts, one for DAD source and one for APEX PL/SQL function.
	   2. RESTful service must have 4 path parts or above:
	      1) DAD source
	      2) Workspace
	      3) Module prefix
	      4) URI template
	      5) More for URI parameters (option)
	**********************************************************************************************/

	if (pathParts.length < 2 || pathParts.length == 3 || !config.dads[pathParts[0]]
		 || (pathParts.length < 3 && !(config.tempParamMappings[pathParts[1]] || pathParts[1] === 'f'))) {
		//throw "The URL specified is incomplete or malformed";
		retval.err = true;
		return retval;
	}

	retval.dad = pathParts[0];
	retval.proc = pathParts[1];
	retval.service = false;

	if (pathParts.length > 2) {
		retval.service = true;
		retval.module = pathParts[2] + '/';
		retval.template = pathParts[3] + ((pathParts.length == 4)? '' : '/');
		retval.uriParams = '';
		for (var i = 4; i <= pathParts.length - 1; i++) {
			retval.uriParams = retval.uriParams + '/' + pathParts[i];
		}

	}

	//validate proc here
	// /^[A-Za-z0-9\._#$]+$/m.test(retval.proc)
	// then run aginst the include/exclude lists

	return retval;
}

var quene = 0;

function getConnection(pool, pid, callback){

	pool.getConnection(function(err, connection) {

		// Handle Connection in line
		if (err && err.message.indexOf('ORA-24418') > -1) {
			console.log('Thread ' + pid + ' has ' + quene + ' in line, and has ' + pool.connectionsOpen + ' open connections.');
			quene++
			connEvent.myConnEvent.once('connectionfree', function() {
				quene--
				getConnection(pool, pid, callback);
			});
		}
		else{
			if(err){
				console.error('getConnection() callback: %s', err.message);
				return callback(err);
			}
			callback(null, connection);

		}

	});
	
}

//exports.poolCache = poolCache;
exports.requestHandler = requestHandler;

