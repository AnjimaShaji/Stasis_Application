/**
 * Tata Motors Number Mapped Outbound Stasis App
 * 
 * @author Anjima Shaji <anjimashaji97@gmail.com>
 */

'use strict';

const client = require('ari-client'),
    DB = require('./lib/DB'),
    Events = require('./lib/Events'),
    Logger = require('./lib/Logger'),
    Utils = require('./lib/Utils');


function init(ariConf) {
    client.connect(`http://${ariConf.host}:${ariConf.port}`, ariConf.user, ariConf.password)
        .then(function(ari) {
            global.ari = ari;

            // Register for stasis events
            Events.register();

            // can also use global.ari.start(['app-name'...]) to start multiple applications
            global.ari.start(global.appConf.appname);
            global.logger.info(null, `<<< Stasis ${global.appConf.appname} App Listening >>>`);
        })
        .done(); // program will crash if it fails to connect
}

async function bootstrap() {
    // Set Application path
    global.appPath = __dirname;

    // Get configuration details
    global.appConf = await Utils.getConfig();

    // Get constants
    global.constants = await Utils.getConstants();

    // General logger for stasis
    global.logger = new Logger('stasis');
    
    // Refresh constant values on every 15sec
    // Gives the flixibilty to update gateways and other conf without an app restart
    setInterval(async () => {
        let resp = await Utils.getConstants();
        if (resp) {
            global.constants = resp;
        }
    }, 15000);

    // Calls variable to store call details globally
    global.calls = {};
    global.channelCallMap = [];

    // Create a mysql db connection pool for database queries.
    DB.createMysqlConnectionPool();

    init(global.appConf.asterisk);
}
// Bootstrap application
bootstrap();