//prepare the event
var eventEmitter = require('events').EventEmitter;
var util = require('util');
 
var connEvent = function() {};

util.inherits(connEvent,eventEmitter);

connEvent.prototype.freeCon = function () {
	this.emit( 'connectionfree' );
}

var myConnEvent = new connEvent();

exports.myConnEvent = myConnEvent;