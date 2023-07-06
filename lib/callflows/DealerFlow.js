/**
 * Outbound Call Logic
 * 
 * @author Anjima Shaji <anjimashaji97@gmail.com>
 * 
 */

'use strict';

const CallFlow = require('../CallFlow'),
    Constants = require('../Constants'),
    DealerUtils = require('../DealerUtils'),
    EventQueue = require('../EventQueue'),
    Utils = require('../Utils'),
    _ = require('lodash');

class DealerFlow {}

DealerFlow.execute = async (callId, event, incoming) => {

    global.calls[callId].dealer = await DealerUtils.getDealerDetails(global.calls[callId].virtualNumber);
    if (global.calls[callId].dealer) {

        global.logger.info(callId, 'Answering');
        await incoming.answer();
        let callFlow;
        callFlow = await DealerFlow.setOnlineIvr(callId);
        await DealerFlow.setGateway(callId);
        // Set call-flow of this call
        global.calls[callId].callFlow = callFlow;
        await CallFlow.process(callId);

    } else {
        global.logger.warn(callId, 'Call to unassaigned number:', global.calls[callId].virtualNumber);
        CallFlow.hangup(callId, {});
        delete global.calls[callId];
    }

};

DealerFlow.setOnlineIvr = async (callId) => {
    let callFlow;
    callFlow = global.calls[callId].dealer.callflow;
    callFlow = JSON.parse(callFlow);
    return callFlow;
};

DealerFlow.setGateway = async (callId) => {
    if(global.calls[callId].dealer.primary_gateway == 'VOD' || global.calls[callId].dealer.backup_gateway == 'VOD') {
        global.calls[callId].primaryGatewayId = global.calls[callId].backupGatewayId = 1;
    } else if(global.calls[callId].dealer.primary_gateway == 'Tata' || global.calls[callId].dealer.backup_gateway == 'Tata') {
        global.calls[callId].primaryGatewayId = global.calls[callId].backupGatewayId = 2;
    }
};

DealerFlow.processNext = async (callId, event, incoming) => {
    await CallFlow.process(callId);
};

DealerFlow.playbackFinished = async(callId, event, playback) => {

    if (global.calls[callId]) {
        if (playback.id.indexOf('menu_prompt_') > -1) {
            if (global.calls[callId].menu && global.calls[callId].menu.isWaitingForDtmf) {
                let menu = global.calls[callId].menu;
                global.calls[callId].menu.timeoutObj = setTimeout(async() => {
                    await EventQueue.add(callId, {
                        eventName: 'dtmfTimeout',
                        event: [],
                        eventObj: menu
                    });
                }, global.calls[callId].menu.timeout);
            }

        } else if (playback.id.indexOf('menu_no_input_') > -1 || playback.id.indexOf('menu_invalid_input_') > -1) {
            if (global.calls[callId].menu) {
                if (global.calls[callId].menu.repeat) {
                    global.calls[callId].menu.repeat--;
                    global.calls[callId].menu.isWaitingForDtmf = true;
                    CallFlow.playMenuPrompt(callId);
                } else {
                    await CallFlow.processDtmfFailure(callId);
                }
            }

        } else if (playback.id.indexOf('moh_') > -1) {
            if (!global.calls[callId].channel2EndTime && !global.calls[callId].connectTime) {
                CallFlow.playMoh(callId);
            }
        } else {
            await CallFlow.process(callId);
        }
    }
};

DealerFlow.dialStatus = async(callId, event, outgoing) => {

    if ('ANSWER' === event.dialstatus) {

        if (global.calls[callId].simultaneousChannels && global.calls[callId].simultaneousChannels[outgoing.id]) {
            let simultaneousChannels = global.calls[callId].simultaneousChannels;
            global.calls[callId].calleeChannelId = outgoing.id;
            global.calls[callId].agent = simultaneousChannels[outgoing.id];
            console.log(simultaneousChannels);
            if (global.constants.createAndDial) {
                let agent = simultaneousChannels[outgoing.id];
                global.calls[callId].agent = agent;
                global.calls[callId].snoopChannelId = agent.snoopChannelId;
                let agentNumber = agent.number.replace('+91', '');
                global.calls[callId].dialRecName = global.calls[callId].agentRecordings[agentNumber].slice(-1).pop();
            }

            delete simultaneousChannels[outgoing.id];
            delete global.calls[callId].simultaneousChannels[outgoing.id];
            console.log(simultaneousChannels);

            Object.keys(simultaneousChannels).map(async(channelId) => {
                global.ari.channels.hangup({
                    channelId: channelId
                }).catch((err) => {
                    let error = JSON.parse(err.message);
                    if ('Channel not found' !== error.message) {
                        global.logger.error(callId, 'Simultaneous channel hangup failed', err);
                    } else {
                        global.logger.warn(callId, 'Simultaneous channel hangup failed: channel not found',
                            simultaneousChannels[channelId]);
                    }
                });
            });
        }
        console.log('sec answer');
        global.calls[callId].connectTime = event.timestamp;
        global.calls[callId].callee = global.calls[callId].agent.number;
        // await outgoing.answer();
        CallFlow.stopMoh(callId);

        if (global.constants.createAndDial) {
            try {
                // Discard agent rec
                await global.ari.recordings.cancel({
                    recordingName: global.calls[callId].dialRecName
                });
            } catch (e) {}

            // hangup snoop channel
            if (global.calls[callId].snoopChannelId) {
                global.ari.channels.hangup({
                    channelId: global.calls[callId].snoopChannelId
                }).catch((err) => {
                    global.logger.warn(callId, 'snoop channel hangup failed ' + global.calls[callId].snoopChannelId, err);
                });
            }

            // update agent records
            let number = global.calls[callId].agent.number.replace('+91', '');
            let numberRec = global.calls[callId].agentRecordings[number];
            if (numberRec) {
                numberRec = numberRec.filter((rec) => rec !== global.calls[callId].dialRecName);
                if (!numberRec.length) {
                    delete global.calls[callId].agentRecordings[number];
                } else {
                    global.calls[callId].agentRecordings[number] = numberRec;
                }
            }
        }

        try {
            var bridge = global.ari.Bridge();
            global.calls[callId].bridgeId = bridge.id;

            await bridge.create({
                type: 'mixing'
            });
        } catch (err) {
            global.logger.error(callId, 'bridge creation failed', err);
        }

        // Add channel to bridge
        let bridgeChannels = global.calls[callId].callerChannelId + ',' + global.calls[callId].calleeChannelId;
        await global.ari.bridges.addChannel({
            bridgeId: global.calls[callId].bridgeId,
            channel: bridgeChannels
        });
        //  Record conversation
        await global.ari.bridges.record({
            bridgeId: global.calls[callId].bridgeId,
            format: 'wav',
            name: global.constants.recordBucketName + '--' + callId
        });

    } else {
        try {
            await outgoing.hangup();
        } catch (err) {
            let error = JSON.parse(err.message);
            if ('Channel not found' !== error.message) {
                global.logger.error(callId, 'Channel hangup failed', err);
            } else {
                global.logger.warn(callId, 'Channel hangup failed; channel not found', outgoing.id);
            }
        }

        // backup dial
        let agent = global.calls[callId].agent;
        if (_.isEmpty(global.calls[callId].simultaneousChannels) && agent.gatewayId != global.constants.backupGatewayId) {
            let backupDialStatuses = ['CONGESTION', 'CHANUNAVAIL'];
            if (backupDialStatuses.indexOf(event.dialstatus) > -1) {
                agent.gatewayId = global.constants.backupGatewayId;
                global.calls[callId].dialFailure = true;
            }
        }
    }
};

DealerFlow.stasisEnd = async(callId, event, channel) => {

    console.log('stasisEnd');

    // Handle simultaneos channels
    if (global.calls[callId].simultaneousChannels && global.calls[callId].simultaneousChannels[channel.id]) {
        let agent = global.calls[callId].simultaneousChannels[channel.id];
        delete global.calls[callId].simultaneousChannels[channel.id];
        if (!global.calls[callId].connectTime) {
            if (!global.calls[callId].channel1EndTime) {
                if (global.calls[callId].busycallees.indexOf(agent.number) === -1) {
                    global.calls[callId].busycallees.push(agent.number);
                }
            }
            if (_.isEmpty(global.calls[callId].simultaneousChannels)) {
                global.calls[callId].channel2EndTime = event.timestamp;
                delete global.calls[callId].simultaneousChannels;
                if (!global.calls[callId].channel1EndTime) {
                    CallFlow.process(callId);
                } else {
                    await DealerFlow._callEnd(event, callId);
                }
            }
        }
        return;
    }

    if (global.calls[callId].callerChannelId === channel.id) {
        global.calls[callId].channel1EndTime = event.timestamp;

        if (global.calls[callId].dialTime && !global.calls[callId].channel2EndTime) {
            global.calls[callId].hangupLeg = 'Visitor';
            try {
                if (!_.isEmpty(global.calls[callId].simultaneousChannels)) {
                    let simultaneousChannels = global.calls[callId].simultaneousChannels;
                    await Promise.all(Object.keys(simultaneousChannels).map(async(channelId) => {
                        global.ari.channels.hangup({
                            channelId: channelId
                        }).catch((err) => {
                            let error = JSON.parse(err.message);
                            if ('Channel not found' !== error.message) {
                                global.logger.error(callId, 'Simultaneous channel hangup failed', err);
                            } else {
                                global.logger.warn(callId, 'Simultaneous channel hangup failed: channel not found',
                                    simultaneousChannels[channelId]);
                            }
                        });
                    }));
                } else {
                    try {
                        await global.ari.channels.hangup({
                            channelId: global.calls[callId].calleeChannelId
                        });
                    } catch (err) {
                        let error = JSON.parse(err.message);
                        if ('Channel not found' !== error.message) {
                            global.logger.error(callId, 'Channel hangup failed', err);
                        } else {
                            global.logger.warn(callId, 'Channel hangup failed; channel not found',
                                global.calls[callId].calleeChannelId);
                        }
                    }
                }
            } catch (e) {
                global.logger.error(callId, 'channel2 hangup error', e);
                // global.logger.warn(callId, 'Treating as call end since channe1 hangup failed, This may result in duplicate calllogs');
                // await DealerFlow._callEnd(event, callId);
            }
        } else {
            await DealerFlow._callEnd(event, callId);
        }

    } else {

        if (!global.calls[callId].channel1EndTime) {
            global.calls[callId].channel2EndTime = event.timestamp;
            if (global.calls[callId].connectTime) {
                global.calls[callId].hangupLeg = 'Agent';
                try {
                    await global.ari.channels.hangup({
                        channelId: global.calls[callId].callerChannelId
                    });
                } catch (err) {
                    let error = JSON.parse(err.message);
                    if ('Channel not found' !== error.message) {
                        global.logger.error(callId, 'Channel hangup failed', err);
                    } else {
                        global.logger.warn(callId, 'Channel hangup failed; channel not found',
                            global.calls[callId].callerChannelId);
                    }
                }
            } else {
                if (global.calls[callId].dialFailure) {
                    delete global.calls[callId].dialFailure;
                    let agent = global.calls[callId].agent;
                    await CallFlow.connect(callId, agent);
                } else {
                    if (global.calls[callId].busycallees.indexOf(global.calls[callId].agent.number) === -1) {
                        global.calls[callId].busycallees.push(global.calls[callId].agent.number);
                    }
                    await CallFlow.process(callId);
                }
            }
        } else {
            await DealerFlow._callEnd(event, callId);
        }
    }
};


DealerFlow._callEnd = async(event, callId) => {
    global.calls[callId].callEndTime = event.timestamp;

    // delete channel call mapping
    delete global.channelCallMap[global.calls[callId].callerChannelId];
    if (global.calls[callId].channel2) {
        delete global.channelCallMap[global.calls[callId].calleeChannelId];
    }
    if (global.calls[callId].dtmfConf && global.calls[callId].dtmfConf.timeout) {
        clearTimeout(global.calls[callId].dtmfConf.timeout);
        delete global.calls[callId].dtmfConf.timeout;
    }
    // remove bridge
    if (global.calls[callId].bridge) {
        global.ari.bridges.destroy({
            bridgeId: global.calls[callId].bridge.id
        });
    }
    // @todo fix this bug
    // clear pending events
    // EventQueue.clear(callId);

    // skip log and sms for virtual-number-test calls
    if (global.calls[callId].caller != "+912262604747") {
        // generate CDR
        let cdr = DealerUtils.generateCDR(global.calls[callId]);
        // Send SMS
        // SMS.sendCallAlerts(cdr, global.calls[callId].agentList);
    }
    // delete call datails variable
    delete global.calls[callId];
};

DealerFlow.dtmfTimeout = async(callId, x, menu) => {
    if (global.calls[callId].menu && global.calls[callId].menu.id == menu.id) {
        global.calls[callId].menu.isWaitingForDtmf = false;
        await CallFlow.playMenuNoInputPrompt(callId);
    }
};

DealerFlow.channelDtmfReceived = async(callId, event, channel) => {
    if (global.calls[callId].menu && global.calls[callId].menu.isWaitingForDtmf) {

        global.calls[callId].menu.isWaitingForDtmf = false;
        // Stop current playback
        if (global.calls[callId].playbackId) {
            global.ari.playbacks.stop({
                playbackId: global.calls[callId].playbackId
            });
        }
        // Stop dtmf timeout, if exists
        if (global.calls[callId].menu.timeoutObj) {
            clearTimeout(global.calls[callId].menu.timeoutObj);
        }

        if (global.calls[callId].menu.dtmf_logic[event.digit]) {
            await CallFlow.processDtmf(callId, event.digit);
        } else {
            await CallFlow.playMenuInvalidInputPrompt(callId);
        }
    }
};

module.exports = DealerFlow;