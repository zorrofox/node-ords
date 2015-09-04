var async = require('async');
var domain = require('domain');
var restify = require('restify');
var config = require('./config.js');
var plsql = require('./plsql.js');
var serverDomain = domain.create();

var openConnections = {};
var app;

serverDomain.on('error', function(err) {
    console.error('Domain error caught', err);

    shutdown();
});

serverDomain.run(createWebServer);

function createWebServer() {
    app = restify.createServer();
	
	var rg = new RegExp(config.staticFileRepos[0].alias + '?.*');
	
	app.get(/\/i\/?.*/, restify.serveStatic({
	  directory: 'D:\\openSource\\apache-tomcat-6.0.35\\webapps'
	}));
	
	app.use(restify.bodyParser({maxBodySize: 0, mapParams: false}));
	//app.use(restify.queryParser());

	[
	    'del',
	    'get',
	    'head',
	    'opts',
	    'post',
	    'put',
	    'patch'
	].forEach(function (method) {
		app[method](/([0-9]|[a-z]|[A-Z])/,function(req, res, next){
			plsql.requestHandler(req, res, next, serverDomain);
			next();
		});
	});
	
	

	app.listen(config.port, function() {
	  console.log('%s listening at %s', app.name, app.url);
	});

}

function shutdown() {
    console.log('Shutting down');

    app.server.close(function () {
        var terminatePools = [];

        console.log('Web server closed');

        for (key in plsql.poolCache) {
            terminatePools.push(function() {
                plsql.poolCache[key].terminate(function(err) {
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

}