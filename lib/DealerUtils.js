'use strict';

const Utils = require('./Utils'),
    DB = require('./DB'),
    Constants = require('./Constants'),
    _ = require('lodash');

class DealerUtils {}

DealerUtils.generateCDR = function(callData) {
    delete callData.channel1;
    delete callData.channel2;

    let callId = callData.id;
    global.logger.debug(callId, 'call details: ', callData);
    if (!callData.answerTime) {
        callData.answerTime = callData.startTime;
    }
    let answerTime = new Date(callData.answerTime),
        endTime = new Date(callData.callEndTime);

    let answerTimeISO = new Date(answerTime.getTime() + 19800000).toISOString().replace('T', ' ').split('.').shift();
    let endTimeISO = new Date(endTime.getTime() + 19800000).toISOString().replace('T', ' ').split('.').shift();
    let date = new Date(answerTimeISO);
    let dateTime  = date.getTime();

    let cdr = {
        "callId": callData.id,
        "date" : answerTimeISO.split(' ').shift(),
        "dateTime": dateTime,
        "callType": "INBOUND",
        "callerNumber" : callData.caller,
        "uniqueId" : callData.channel,
        "virtualNumber" : callData.virtualNumber,
        "dateTimeIso": new Date(answerTime.getTime() + 19800000).toISOString(),
        "conversationDuration": 0,
        "ivrDuration": 0,
        "ivrLog": callData.ivrLog,
        "hangupLeg": callData.hangupLeg ? callData.hangupLeg : 'Visitor',
        "gateway": "MumbaiPRI",
        "totalDuration": Math.round((endTime.getTime() - answerTime.getTime()) / 1000),
        "ringDuration": 0,
        "callerStatus": "Success",
        "calleeStatus": "",
        "correlationId" : callData.channel,
        "status": "Missed",
        "dtmfKeys":[],
    };

    if (callData.offline) {
        cdr.status = 'Offline';
    } else if (callData.dialTime) {
        cdr.status = 'Missed';
    } else {
        cdr.status = 'IVR Drop';
    } 

    if (callData.tag) {
        cdr.tag = callData.tag;
    }

    for (let ivr of callData.ivrLog) {
        cdr.dtmfKeys.push(Object.keys(ivr).shift());
    }

    if (callData.dialTime) {
        cdr.busyCallees = cdr.busyCalleesStr = global.calls[callId].busycallees.join();
        let dialTime = new Date(callData.dialTime);
        cdr.ivrDuration = Math.round((dialTime.getTime() - answerTime.getTime()) / 1000);
        if (callData.connectTime) {
            let connectTime = new Date(callData.connectTime);
            cdr.conversationDuration = Math.round((endTime.getTime() - connectTime.getTime()) / 1000);
            cdr.ringDuration = Math.round((connectTime.getTime() - dialTime.getTime()) / 1000);
            cdr.calleeStatus = 'Success';
            cdr.status = 'Answered';
            cdr.answeredBy = callData.callee;
            cdr.callRecordUrl = `https://s3.ap-south-1.amazonaws.com/${global.calls[callId].dealer.callrecord_bucket}/${callId}.mp3`;
            Utils.moveCallRec(callId);
            // cdr.AnsweredAgentLegGatewayId = 0;
        } else {
            cdr.ringDuration = Math.round((endTime.getTime() - dialTime.getTime()) / 1000);
        }
        if (global.calls[callId].dialLegRec && global.calls[callId].agentRecordings) {
            cdr.agentRecords = {};
            let recArr;
            for (let [number, recordings] of Object.entries(global.calls[callId].agentRecordings)) {
                recArr = [];
                for (let rec of recordings) {
                    rec = rec.replace(global.calls[callId].dealer.dialleg_record_bucket+'--', '');
                    rec = `https://s3.ap-south-1.amazonaws.com/${global.calls[callId].dealer.dialleg_record_bucket}/${rec}.mp3`;
                    recArr.push(rec);
                }
                console.log(recArr);
                cdr.agentRecords[number] = recArr;
            }
        }
    } else {
        cdr.ivrDuration = Math.round((endTime.getTime() - answerTime.getTime()) / 1000);
    }

    console.log(cdr);
    Utils.writeCallReportFile(cdr,callData);
    return cdr;
};

DealerUtils.getDealerDetails = async (virtualNumber) => {
    let query = "SELECT c.callflow,c.app,app.app_name,app.stasis_app_name,app.callback_conf,callrecord_bucket,primary_gateway," +
                "backup_gateway,dial_type,primary_callerid,backup_callerid,primary_sip,backup_sip,dialleg_record_bucket" +
                " FROM callflow as c" +
                ' LEFT JOIN app ON app.id = c.app_id' +
                ` WHERE c.sim_number = '${virtualNumber}'` +
                `and c.deleted_at is null and app.deleted_at is null`;
    let result = await DB.execute(query);
    return result[0];
};


DealerUtils.isWorkingHour = (callId) => {
    return true;
    // return Utils.isWorkingHour(callId, Constants.dealerWorkingHours);
};

module.exports = DealerUtils;