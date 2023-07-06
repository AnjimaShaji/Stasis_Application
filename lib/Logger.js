/**
 * Utils calls for Stasis App
 * 
 * @author Anees Sadeek <aneessadeek@gmail.com>
 * 
 * @todo log rotate, 
 */


'use strict';

const fs = require('fs'),
    os = require('os'),
    _ = require('lodash'),
    util = require('util');

class Logger {

    constructor(logName) {
        this.logFileName = global.appEnv + '-' + logName + '.log';
        this.logWriter = this.logWriterFileName = false;
        this.logPriority = {
            'crit': 0,
            'error': 1,
            'warn': 2,
            'console': 3,
            'info': 4,
            'debug': 5
        };
        this.logsPath = global.constants.logPath;

        this._setNewLogWriter();
        setInterval(() => {
            this._setNewLogWriter();
        }, 60 * 1000);
    }

    _setNewLogWriter() {
        let date = new Date();
        let dateYmd = date.getFullYear() + ('0' + (date.getMonth() + 1)).slice(-2) + ('0' + date.getDate()).slice(-2);
        let fileName = this.logFileName.replace('.log', ('-' + dateYmd + '.log'));
        if (fileName != this.logWriterFileName) {
            this.logWriterFileName = fileName;
            if (this.writer) {
                this.writer.removeAllListeners();
                this.writer.end(os.EOL);
            }
            this.writer = fs.createWriteStream(this.logsPath + fileName, {
                flags: 'a'
            });
        }
    }

    _writeToFile(data) {
        if (this.writer) {
            this.writer.write(data);
        } else {
            console.log('<<<<<<<<<< ERROR: No Writer >>>>>>>>>>>>');
        }
    }

    log(callId, type, msg, obj = null) {
        var data = new Date(new Date().getTime() + 19800000).toISOString() + ': ' + _.upperCase(type) + ': ' + callId + '; ';
        if ('string' == typeof msg) {
            data += msg;
        } else {
            data += util.inspect(msg, {
                depth: null
            });
        }
        if (obj) {
            data += ': ' + util.inspect(obj, {
                depth: null
            });
        }
        data += os.EOL;

        this._writeToFile(data);
        // if (this.logPriority[_.lowerCase(type)] < 4) {
        //     // set alerts
        // }
    }

    debug(callId, msg, obj = null) {
        this.log(callId, 'DEBUG', msg, obj);
    }

    info(callId, msg, obj = null) {
        this.log(callId, 'INFO', msg, obj);
    }

    warn(callId, msg, obj = null) {
        this.log(callId, 'WARN', msg, obj);
    }

    error(callId, msg, obj = null) {
        this.log(callId, 'ERROR', msg, obj);
    }

    crit(callId, msg, obj = null) {
        this.log(callId, 'CRIT', msg, obj);
    }

    console(callId, msg, obj = null) {
        console.log(callId, msg, obj);
        this.log(callId, 'CONSOLE', msg, obj);
    }

}

module.exports = Logger;