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
 *   index.js
 *
 * DESCRIPTION
 *   The "main" file for the module.
 *
 *****************************************************************************/

var async = require('async');
var domain = require('domain');
var http = require('http');
var express = require('express');
var bodyParser = require('body-parser');
var oracledb = require('oracledb');
var morgan = require('morgan');
var serveStatic = require('serve-static');
var config = require('./config.js');
var plsql = require('./plsql.js');
//var cluster = require('cluster');
//var numCPUs = 2;//require('os').cpus().length;

var serverDomain = domain.create();
var urlEncodedParser = bodyParser.urlencoded({ extended: false });
var openConnections = {};
var app;
var poolCache = {};


serverDomain.on('error', function(err) {
    console.error('Domain error caught', err);

    shutdown();
});


//Create Node cluster according to CPU cores

/*if (cluster.isMaster) {
  // Fork workers.
  for (var i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', function(worker, code, signal) {
    console.log('worker ' + worker.process.pid + ' died');
  });

  cluster.on('listening', function(worker, address) {
    console.log('A worker ' + worker.process.pid + ' is now connected to ' + address.address + ':' + address.port);
  });
} else {
    var workerPid = cluster.worker.process.pid;

    serverDomain.run(createWebServer);
}*/

//Will only create one node
var workerPid = process.pid;
serverDomain.run(createWebServer);

function createWebServer() {
    app = express();

    //app.use(morgan('combined')); //Add logging via morgan
	
	app.use(bodyParser.json()); // for parsing application/json
	app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
	//app.use(multer()); // for parsing multipart/form-data

    config.staticFileRepos.forEach(function(repo) {
        app.use(repo.alias, serveStatic(repo.path));
    });
	
	async.waterfall([
		function(callback){
			createConnectionPool(callback);
		},
		function(pools, callback){
			poolCache = pools;
			console.log(poolCache);
		    app.use(urlEncodedParser, function(req, res, next) {
		        plsql.requestHandler(req, res, next, workerPid, poolCache, serverDomain);
		    });
		}
	], function(err){
		if (err) throw err;
	});

    app.server = http.createServer(app);

    app.server.listen(config.port);

    app.server.on('connection', function(conn) {
        var key = conn.remoteAddress + ':' + conn.reportPort;

        openConnections[key] = conn;

        conn.on('close', function() {
            delete openConnections[key];
        });
    });

    console.log("Server running at http://localhost:" + config.port);
}

function createConnectionPool(callback) {
	
	var poolCallStack = {};
	
	
	for (dad in config.dads){
		var val = 'poolCallStack["' + dad + '"] = function(cb){' +
				'oracledb.createPool(' +
				'config.dads["' + dad + '"],' +
				'serverDomain.bind(function(err, dadPool) {' +
				'	if (err) return callback(err);' +
				'	cb(null, dadPool);' +
			 '}));' +
			'};'
		//console.log(val);
		eval(val);
		
	}
	
	async.parallel(
		poolCallStack,
		function(err, result){
			if(err) return callback(err);
			callback(null, result);
	});
}


function shutdown() {
    console.log('Shutting down');

    app.server.close(function () {
        var terminatePools = [];

        console.log('Web server closed');

        for (key in poolCache) {
            terminatePools.push(function() {
                poolCache[key].terminate(function(err) {
                    if (err) {
                        console.error('Error terminating pool for ' + key, err.message);
                    }

                    console.log('Closed connection pool for ' + key);
                });
            });
        }

        if (terminatePools) {
            async.parallel(terminatePools, function() {
                process.exit(0);
            });
        } else {
            process.exit(0);
        }
    });

    for (key in openConnections) {
        openConnections[key].destroy();
    }
}
