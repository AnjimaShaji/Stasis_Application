/**
 * Utils calls for Stasis App
 * 
 * @author Anees Sadeek <aneessadeek@gmail.com>
 * 
 * @todo log rotate, 
 */


'use strict';

const Constants = require('./Constants'),
    EventQueue = require('./EventQueue'),
    Utils = require('./Utils'),
    DealerUtils = require('./DealerUtils'),
    _ = require('lodash');

class CallFlow {}

CallFlow.process = async(callId) => {
    console.log('process', callId);
    let actionObj = global.calls[callId].callFlow.shift();
    if (actionObj) {
        global.logger.info(callId, 'Processing callFlow block', actionObj);
        let key = Object.keys(actionObj).shift();
        var action = _.camelCase(key);
        var config = actionObj[key];
        if (global.calls[callId].mohFile) {
            if (action != 'connect' || action != 'connectSimultaneously' || action != 'connectGroup') {
                CallFlow.stopMoh(callId);
            }
        }
        global.logger.info(callId, `IVR Action: ${action}`);
        global.logger.info(callId, 'Config: ', config);
        await CallFlow[action](callId, config);
    } else {
        global.logger.info(callId, 'CallFlow empty, execution completed');
        // let channel = global.calls[callId].channel1;
        // try {
        //     await global.ari.channels.hangup({
        //         channelId: channel
        //     });
        // } catch (err) {
        //     global.logger.error(callId, 'Channel hangup error', err);
        // }
    }
};

CallFlow.prompt = async(callId, conf) => {
    console.log('prompt', callId);
    let channelId = global.calls[callId].callerChannelId;
    let playbackId = conf.playbackId ? conf.playbackId : 'playback_' + callId;
    let media = 'sound:' + conf.file;
    CallFlow._play(channelId, media, playbackId);
};

CallFlow.workingHour = async(callId, conf) => {
    if (Utils.isWorkingHour(callId, conf.config)) {
        global.calls[callId].callFlow = conf.true;
    } else {
        global.calls[callId].callFlow = conf.false;
        global.calls[callId].offline = true;
    }

    CallFlow.process(callId);
};

CallFlow.connectGroup = async(callId, conf) => {
    if (!_.isEmpty(conf.dialTune)) {
        let extension = conf.dialTune.file.split('.').pop();
        global.calls[callId].mohFile = conf.dialTune.file.replace('.' + extension, '');
    }
    if (!_.isEmpty(conf.participants)) {
        if ('SIMULTANEOUS' == conf.statergy) {
            CallFlow.connectSimultaneously(callId, conf.participants);
        } else if (!conf.statergy || 'PRIORITY' == conf.statergy) {
            let connectTags = CallFlow._getConnectTags(callId, conf.participants);
            global.calls[callId].callFlow = connectTags.concat(global.calls[callId].callFlow);
            CallFlow.process(callId);
        }
    } else {
        CallFlow.process(callId);
    }

};

CallFlow._getConnectTags = (callId, participants) => {
    let connectTags = [];
    let connectJson = null;

    participants.forEach((agent) => {
        if (!agent.gatewayId) {
            agent.gatewayId = null;
        }
        connectJson = {
            CONNECT: {
                number: agent.number,
                name: agent.name,
                timeout: agent.timeout,
                gatewayId: agent.gatewayId
            }
        };
        connectTags.push(connectJson);
    });

    return connectTags;
};

CallFlow.connect = async(callId, agent) => {

    console.log('connect', callId);
    if (global.calls[callId].channel2EndTime) {
        delete global.calls[callId].channel2EndTime;
    }
    var outgoing = global.ari.Channel();
    global.channelCallMap[outgoing.id] = callId;
    global.calls[callId].calleeChannelId = outgoing.id;

    try {
        if (!agent.gatewayId) {
            agent.gatewayId = global.constants.defaultGatewayId;
        }
        if (!agent.timeout) {
            agent.timeout = global.constants.dialTimeout;
        }
        if (agent.gatewayId == global.constants.backupGatewayId) {
            global.constants.backupGatewayId = global.constants.defaultGatewayId;
        }

        if (global.constants.createAndDial) {
            global.calls[callId].dialLegRec = true;
            await CallFlow.createAndDial(callId, agent, outgoing);
        } else {
            global.calls[callId].originate = true;
            await CallFlow.originate(callId, agent, outgoing);
        }
        console.log('dialed');

    } catch (err) {
        global.logger.error(callId, 'dial failed', err);
    }
};

CallFlow.connectSimultaneously = async(callId, agents) => {

    console.log('connect', callId);
    if (global.calls[callId].channel2EndTime) {
        delete global.calls[callId].channel2EndTime;
    }
    global.calls[callId].simultaneousChannels = {};
    await Promise.all(agents.map(async(agent) => {
        var outgoing = global.ari.Channel();
        global.channelCallMap[outgoing.id] = callId;

        agent.channelId = outgoing.id;
        global.calls[callId].simultaneousChannels[outgoing.id] = agent;

        try {
            if (!agent.gatewayId) {
                agent.gatewayId = global.constants.defaultGatewayId;
            }
            if (!agent.timeout) {
                agent.timeout = global.constants.dialTimeout;
            }
            if (agent.gatewayId == global.constants.backupGatewayId) {
                global.constants.backupGatewayId = global.constants.defaultGatewayId;
            }

            if (global.constants.createAndDial) {
                global.calls[callId].dialLegRec = true;
                await CallFlow.createAndDial(callId, agent, outgoing);
            } else {
                global.calls[callId].originate = true;
                await CallFlow.originate(callId, agent, outgoing);
            }
            console.log('dialed');
        } catch (err) {
            global.logger.error(callId, 'dial failed', err);
        }
    }));
};

CallFlow.hangup = async(callId, conf) => {
    console.log('hangup', callId);
    try {
        let channelId = global.calls[callId].callerChannelId;
        await global.ari.channels.hangup({
            channelId: channelId
        });
    } catch (err) {
        let error = JSON.parse(err.message);
        if ('Channel not found' !== error.message) {
            global.logger.error(callId, 'Channel hangup failed', err);
        } else {
            global.logger.warn(callId, 'Channel hangup failed: channel not found',
                global.calls[callId].callerChannelId);
        }
    }
};

CallFlow.menu = async(callId, conf) => {
    console.log('menu', conf);
    conf.id = Math.floor(Math.random() * 1000000000);
    conf.timeout = conf.timeout ? conf.timeout : 5 * 1000;
    global.calls[callId].menu = conf;
    global.calls[callId].menu.isWaitingForDtmf = true;
    await CallFlow.playMenuPrompt(callId);
};
/////////////////////////////////////

CallFlow.playMenuPrompt = async(callId) => {
    let playbackId = 'menu_prompt_' + callId;
    let media = 'sound:' + global.calls[callId].menu.prompts.menu.file;
    CallFlow._play(global.calls[callId].callerChannelId, media, playbackId);
};

CallFlow.playMenuNoInputPrompt = async(callId) => {
    let playbackId = 'menu_no_input_' + callId;
    let media = 'sound:' + global.calls[callId].menu.prompts.no_input.file;
    CallFlow._play(global.calls[callId].callerChannelId, media, playbackId);
};

CallFlow.playMenuInvalidInputPrompt = async(callId) => {
    let playbackId = 'menu_invalid_input_' + callId;
    let media = 'sound:' + global.calls[callId].menu.prompts.invalid_input.file;
    CallFlow._play(global.calls[callId].callerChannelId, media, playbackId);
};

CallFlow.processDtmf = async(callId, dtmfDigit) => {
    let ivrDigit = {};
    ivrDigit[dtmfDigit] = global.calls[callId].menu.dtmf_logic[dtmfDigit].name;
    global.calls[callId].dtmfDigit = dtmfDigit;
    global.calls[callId].ivrLog.push(ivrDigit);
    global.calls[callId].callFlow = global.calls[callId].menu.dtmf_logic[dtmfDigit].logic
        .concat(global.calls[callId].callFlow);
    delete global.calls[callId].menu;
    CallFlow.process(callId);
};

CallFlow.processDtmfFailure = async(callId) => {
    global.calls[callId].callFlow = global.calls[callId].menu.failure.concat(global.calls[callId].callFlow);
    delete global.calls[callId].menu;
    CallFlow.process(callId);
};

CallFlow._play = async(channelId, sound, playbackId = null) => {
    global.ari.channels.play({
            media: sound,
            channelId: channelId,
            playbackId: playbackId
        })
        .catch(function(err) {
            console.error(channelId, 'Playback error', sound, err);
            global.logger(channelId, `${sound}: Playback error`, err);
        });
};

CallFlow._playSync = (channelId, sound, playbackId = null) => {
    var playback = global.ari.Playback(playbackId);

    return new Promise(function(resolve, reject) {
        playback.once('PlaybackFinished', function(event, playback) {
            resolve(playback);
        });

        global.ari.channels.play({
                media: sound,
                channelId: channelId,
                playbackId: playback.id
            })
            .catch(function(err) {
                reject(err);
            });
    });
};

CallFlow.createAndDial = async(callId, agent, outgoing) => {
    var callerId = Constants.gateways[agent.gatewayId].split("_");
    callerId = callerId[0].split("/");
    global.calls[callId].agent = agent;
    let nationalNumber = agent.number.replace('+91', '0');
    let channelInstance = await outgoing.create({
        endpoint: Constants.gateways[agent.gatewayId] + nationalNumber,
        app: global.appConf.appname,
        appArgs: 'dialed'
    });

    if (!global.calls[callId].agentRecordings) {
        global.calls[callId].agentRecordings = {};
    }
    let number = agent.number.replace('+91', '');
    let dialRecName = global.constants.dialRecordBucketName + '--' + callId + '_' + number + '_' + agent.gatewayId + '_' + Math.floor(Math.random() * 1000);
    console.log(dialRecName);
    if (!global.calls[callId].agentRecordings[number]) {
        global.calls[callId].agentRecordings[number] = [];
    }
    global.calls[callId].agentRecordings[number].push(dialRecName);
    global.calls[callId].dialRecName = dialRecName;

    let snoopChannel = await global.ari.channels.snoopChannel({
        app: global.appConf.appname,
        channelId: outgoing.id,
        spy: 'in'
    });
    global.calls[callId].snoopChannelId = snoopChannel.id;

    snoopChannel.record({
        format: 'wav',
        name: dialRecName
    }).catch(err => {
        global.logger.error(callId, 'Dial leg rec failed' + dialRecName, err);
    });

    await outgoing.dial({
        timeout: agent.timeout,
        caller: global.calls[callId].callerChannelId
    });

    console.log('dialed');
    if (!global.calls[callId].dialTime) {
        global.calls[callId].dialTime = channelInstance.creationtime; // need to check the time
        if (global.calls[callId].mohFile) {
            // global.calls[callId].moh = true;
            CallFlow.playMoh(callId);
        } else {
            global.ari.channels.ring({
                channelId: global.calls[callId].callerChannelId
            });
        }
    }
};


CallFlow.originate = async(callId, agent, outgoing) => {
    var callerId = Constants.gateways[agent.gatewayId].split("_");
    callerId = callerId[0].split("/");
    global.calls[callId].agent = agent;
    let nationalNumber = agent.number.replace('+91', '0');
    let channelInstance = await outgoing.originate({
        endpoint: Constants.gateways[agent.gatewayId] + nationalNumber,
        callerId: Constants.callerIds[callerId[1]],
        app: global.appConf.appname,
        timeout: agent.timeout,
        appArgs: 'dialed'
    });

    console.log('dialed');
    if (!global.calls[callId].dialTime) {
        global.calls[callId].dialTime = channelInstance.creationtime; // need to check the time
        if (global.calls[callId].mohFile) {
            // global.calls[callId].moh = true;
            CallFlow.playMoh(callId);
        } else {
            global.ari.channels.ring({
                channelId: global.calls[callId].callerChannelId
            });
        }
    }
};

CallFlow.playMoh = async(callId) => {
    let playbackId = 'moh_' + callId;
    let media = 'sound:' + global.calls[callId].mohFile;
    CallFlow._play(global.calls[callId].callerChannelId, media, playbackId);
};

CallFlow.stopMoh = async(callId) => {
    let playbackId = 'moh_' + callId;
    CallFlow._stopPlayback(playbackId);
};

CallFlow._stopPlayback = async(playbackId) => {
    global.ari.playbacks.stop({
        playbackId: playbackId
    });
};

CallFlow.tag = async(callId, conf) => {
    global.calls[callId].tag = conf;
    CallFlow.process(callId);
};

module.exports = CallFlow;