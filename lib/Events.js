/**
 * Utils calls for Stasis App
 * 
 * @author Anees Sadeek <aneessadeek@gmail.com>
 * 
 * @todo log rotate, 
 */


'use strict';

const {
    nanoid
} = require("nanoid/async"),
    DB = require('./DB'),
    DealerFlow = require('./callflows/DealerFlow'),
    EventQueue = require('./EventQueue'),
    Utils = require('./Utils');

class Events {}

Events.register = () => {
    let logger = global.logger;

    global.ari.on('StasisStart', async(event, channel) => {
        logger.info('event', event);

        if (event.args[0] == 'incoming') {
            await Events._processIncomingCall(event, channel);
        }
    });

    global.ari.on('StasisEnd', async(event, channel) => {
        logger.info('event', event);

        let callId = global.channelCallMap[channel.id];
        if (global.calls[callId]) {
            await EventQueue.add(callId, {
                eventName: 'StasisEnd',
                event: event,
                eventObj: channel
            });
        }
    });

    global.ari.on('Dial', async(event, channel) => {
        logger.info('event', event);

        let callId = global.channelCallMap[channel.id];
        if (global.calls[callId]) {
            let dialEvents = ['ANSWER', 'BUSY', 'CONGESTION', 'CHANUNAVAIL', 'NOANSWER', 'CANCEL'];
            if (dialEvents.indexOf(event.dialstatus) > -1) {
                await EventQueue.add(callId, {
                    eventName: 'dialStatus',
                    event: event,
                    eventObj: channel
                });
            }
        }
    });

    global.ari.on('ChannelDtmfReceived', async(event, channel) => {
        logger.info('event', event);

        let callId = global.channelCallMap[channel.id];
        if (global.calls[callId]) {
            await EventQueue.add(callId, {
                eventName: 'ChannelDtmfReceived',
                event: event,
                eventObj: channel
            });
        }
    });

    global.ari.on('PlaybackStarted', async(event, playback) => {
        logger.info('event', event);
        let channelId = event.playback.target_uri.replace('channel:', '');
        let callId = global.channelCallMap[channelId];
        if (global.calls[callId]) {
            global.calls[callId].playbackId = playback.id;
        }
    });

    global.ari.on('PlaybackFinished', async(event, playback) => {
        logger.info('event', event);

        let channelId = event.playback.target_uri.replace('channel:', '');
        let callId = global.channelCallMap[channelId];
        if (global.calls[callId]) {
            delete global.calls[callId].playbackId;
            await EventQueue.add(callId, {
                eventName: 'PlaybackFinished',
                event: event,
                eventObj: playback
            });
        }
    });

    global.ari.on('ChannelDestroyed', async(event, channel) => {
        logger.info('event', event);
        
        let callId = global.channelCallMap[channel.id];
        if (global.calls[callId].originate) {
            if (global.calls[callId] &&
                (!global.calls[callId].connectTime || global.calls[callId].calleeChannelId != channel.id)) {
                EventQueue.add(callId, {
                    eventName: 'StasisEnd',
                    event: event,
                    eventObj: channel
                });
            }
        }
    });

    global.ari.on('ChannelHangupRequest', async(event, channel) => {
        logger.info('event', event);

        let callId = global.channelCallMap[channel.id];
        if (global.calls[callId] && global.calls[callId].callerChannelId == channel.id) {
            // clear call flow
            global.calls[callId].callFlow = [];
            console.log('Callflow cleared');
        }
    });

    global.ari.on('ChannelEnteredBridge', async(event, channel) => {
        logger.info('event', event);
    });

    global.ari.on('ChannelLeftBridge', async(event, channel) => {
        logger.info('event', event);
    });

    global.ari.on('ChannelDialplan', async(event, channel) => {
        logger.info('event', event);
    });

    global.ari.on('ChannelStateChange', async(event, channel) => {
        logger.info('event', event);

        if ('Up' === channel.state) {
            let callId = global.channelCallMap[channel.id];
            if (global.calls[callId] && channel.id == global.calls[callId].callerChannelId) {
                global.calls[callId].answerTime = event.timestamp;
            }
        }
    });

    global.ari.on('RecordingStarted', async(event, channel) => {
        logger.info('event', event);
    });

    global.ari.on('RecordingFinished', async(event, channel) => {
        logger.info('event', event);
    });

    global.ari.on('BridgeDestroyed', async(event, channel) => {
        logger.info('event', event);
    });

    global.ari.on('ChannelUserevent', async(event, channel) => {
        logger.info('event', event);
    });

    // global.ari.on('ChannelVarset', (event, channel) => {
    //     logger.info('event', event);
    // });

};

Events._processIncomingCall = async(event, incoming) => {

    try {
        let channelId = incoming.id;
        let callId = await nanoid();
        global.channelCallMap[channelId] = callId;
        console.log(callId);

        let callDetails = {
            'id': callId,
            'channel': channelId,
            'callerChannelId': channelId,
            'startTime': incoming.creationtime,
            'caller': Utils.e164Formater(incoming.caller.number),
            'virtualNumber': Utils.e164Formater(event.args[1]),
            'busycallees': [],
            'ivrLog': []
        };
        global.calls[callId] = callDetails;

        global.calls[callId].eventQ = [];
        global.calls[callId].eventQueueFlag = false;

        EventQueue.setFlow(DealerFlow);
        await EventQueue.add(callId, {
            eventName: 'execute',
            event: event,
            eventObj: incoming
        });

    } catch (e) {
        console.log(e);
    }
};

module.exports = Events;