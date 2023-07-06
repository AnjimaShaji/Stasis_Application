/**
 * Utils calls for Stasis App
 * 
 * Author: Anees Sadeek
 * Email: aneessadeek@gmail.com
 */

'use strict';

const DB = require('./DB'),
    fsPromises = require('fs').promises,
    axios = require('axios'),
    Constants = require('./Constants');

class Utils {}

Utils.showUsageAndExit = (argv) => {
    console.log('Usage: ' + argv._[0] + ' -e <development-mumbai|development-bangalore|',
        'development-voip|testing-mumbai|testing-bangalore|testing-voip|production-mumbai|',
        'production-bangalore|production-voip|production-mumbai-release>');
    process.exit();
};

Utils.getConfig = async() => {
    var argv = require('minimist')(process.argv.slice(1));
    if (argv.e) {
        try {
            var conf = await fsPromises.readFile(global.appPath + '/configs/application.json', 'utf8');
            conf = JSON.parse(conf);
            if (conf[argv.e]) {
                global.appEnv = argv.e;
                return conf[argv.e];
            } else {
                Utils.showUsageAndExit(argv);
            }
        } catch (e) {
            console.log('Application config parse error: ', e);
            process.exit();
        }
    } else {
        Utils.showUsageAndExit(argv);
    }
};

Utils.setDebugFlag = async() => {
    fsPromises.readFile(global.appPath + '/configs/logger.json', 'utf8')
        .then((conf) => {
            conf = JSON.parse(conf);
            global.loggerDebug = conf.debug;
        }).catch((e) => {
            global.logger.error(null, 'Logger config parse error: ', e);
        });
};

Utils.getConstants = async() => {
    try {
        var conf = await fsPromises.readFile(global.appPath + '/configs/constants.json', 'utf8');
        conf = JSON.parse(conf);
        return conf;
    } catch (e) {
        console.error(null, 'Constants parse error: ', e);
    }
};

Utils.getAriDetails = async(context) => {
    try {
        var conf = await fsPromises.readFile(global.appPath + '/configs/ari.json', 'utf8');
        conf = JSON.parse(conf);
        return conf[context];
    } catch (e) {
        global.logger.console(null, 'Ari config parse error: ', e);
        process.exit();
    }
};


Utils.writeCallReportFile = (cdr,callData) => {
    let callbackConf = callData.dealer.callback_conf;
    let cdrFile = {
        "AppName": callData.dealer.app_name,
        "callback": {
            "url": callbackConf.url,
            "method": callbackConf.method,
            "headers": {
                "Content-Type": "application\/json",
                "user": callbackConf.user
            }
        },
        "Data": cdr
    };
    let cdrFileName = global.constants.cdrPath + callData.dealer.app_name + "_" + cdr.callId;

    fsPromises.writeFile(cdrFileName, JSON.stringify(cdrFile))
        .then(() => {
            global.logger.info('call log write to file');
        }).catch((e) => {
            global.logger.debug(cdr);
            global.logger.debug(cdrFile);
            global.logger.error('Call log write error:', e);
        });
};

Utils.localToE164Formater = (phoneNumber) => {
    phoneNumber = phoneNumber.replace(/^\+|^0+/g, '');
    if (12 == phoneNumber.length) {
        return '+' + phoneNumber;
    } else if (10 == phoneNumber.length) {
        return '+91' + phoneNumber;
    }
    global.logger.warn(null, "Invalid Indian number: ${phoneNumber}");

    return false;
};

Utils.e164Formater = (phoneNumber) => {
    phoneNumber = phoneNumber.replace(/^\+|^0+/g, '');
    if (12 == phoneNumber.length) {
        return '+' + phoneNumber;
    } else if (10 == phoneNumber.length) {
        return '+91' + phoneNumber;
    }
    global.logger.warn(null, "Invalid/international number: ${phoneNumber}");

    return '+' + phoneNumber;
};


Utils.moveCallRec = async(callId) => {
    const mv = require('mv');
    mv(`/var/spool/asterisk/recording/${global.calls[callId].dealer.callrecord_bucket}--${callId}.wav`,
        `/home/recordings/${global.calls[callId].dealer.callrecord_bucket}--${callId}.wav`,
        function(err) {
            if (err) {
                global.logger.error('rec file move error: ' + callId, err);
            }
        });
};

Utils.isWorkingHour = (callId, workingHours) => {
    let isWorkingHour = false;
    let days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    let date = new Date();
    let day = days[date.getDay()];
    let time = date.toTimeString().split(' ').shift().replace(':', '').substr(0, 4);

    let workingHoursDay;
    if (workingHours.all) {
        workingHoursDay = workingHours.all;
    } else if (workingHours[day]) {
        workingHoursDay = workingHours[day];
    }

    if (workingHoursDay) {
        let start, end;
        workingHoursDay.some((session) => {
            start = session.from;
            end = session.to;
            if (start <= time && time <= end) {
                isWorkingHour = true;
                return true;
            }
        });
    }

    return isWorkingHour;
};

Utils.sendDTMF = async (callId) => {
    let dtmf;
    if (global.calls[callId].sendDtmf.digits) {
        dtmf = global.calls[callId].sendDtmf.digits;
    } else {
        dtmf = global.calls[callId].sendDtmf.dtmfData;
        let callDetails = global.calls[callId];
        dtmf = callDetails[dtmf];
    }

    let dtmfParams = {
        channelId: global.calls[callId].calleeChannelId,
        dtmf: dtmf
    };
    if (global.calls[callId].sendDtmf.conf) {
        let conf = global.calls[callId].sendDtmf.conf;
        dtmfParams = Object.assign(dtmfParams, global.calls[callId].sendDtmf.conf);
    } else {
        dtmfParams = Object.assign(dtmfParams, {
            before: 1000,
            after: 1000,
            between: 100
        });
    }

    global.ari.channels.sendDTMF(dtmfParams);
};

Utils.sleep = require('util').promisify(setTimeout);


module.exports = Utils;