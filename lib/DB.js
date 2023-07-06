'use strict';

const mysql = require('mysql');
// redis = require('redis');

class DB {

}

DB.createMysqlConnectionPool = function() {
    DB._pool = mysql.createPool({
        connectionLimit: global.appConf.mysql.connections,
        host: global.appConf.mysql.host,
        user: global.appConf.mysql.user,
        password: global.appConf.mysql.password,
        database: global.appConf.mysql.dbname,
        debug: false
    });
};

// DB.connectRedis = function() {
//     DB._redisClient = redis.createClient({
//         port: global.appConf.redis.port,
//         host: global.appConf.redis.host,
//         // password: 'your password',
//     });
// };

DB.execute = (query) => {
    return new Promise(function(resolve, reject) {
        DB._pool.query(query, function(err, rows) {
            if (!err) {
                resolve(rows);
            } else {
                global.logger.info(null, 'Query: ' + query);
                global.logger.crit(null, 'Error while performing Query: ', err);
                reject(err);
            }
        });
    });
};

module.exports = DB;