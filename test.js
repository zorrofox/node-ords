var oracledb = require('oracledb');

oracledb.getConnection(
  {
    user          : "hr",
    password      : "oracle",
    connectString : "localhost/pdb1"
  },
  function(err, connection)
  {
    if (err) {
      console.error(err.message);
      return;
    }
    connection.execute(
      "select source from apex_rest_resource_handlers where rownum = 1",
      [],
      function(err, result)
      {
        if (err) {
          console.error(err.message);
          return;
        }
        var lob = result.rows[0][0];
    	if (lob === null) { console.log("CLOB was NULL"); return; } 

    	lob.setEncoding('utf8');  // we want text, not binary output
    	lob.on('error', function(err) { console.error(err); });
    	var string='';
        lob.on('data',function(buffer){
  			var part = buffer.toString();
  			string += part;
  			console.log('stream data ' + part);
		});


		lob.on('end',function(){
 			console.log('final output ' + string);
		});
      });
  });