'use strict';

const _ = require('lodash');

class EventQueue {}

EventQueue.setFlow = (flow) => {
    EventQueue.flow = flow;
};

EventQueue._process = async (callId) => {
    if (global.calls[callId]) {
        var data = global.calls[callId].eventQ.shift();
        if (data) {
            global.calls[callId].eventQueueFlag = true;
            var eventMethod = _.camelCase(data.eventName);
            if (EventQueue.flow[eventMethod]) {
                global.logger.info(callId, `<<< Processing Event: ${eventMethod} >>>`);
                try {
                    await EventQueue.flow[eventMethod](callId, data.event, data.eventObj);
                    global.logger.info(callId, '<<< Event execution Completed >>>');
                } catch (e) {
                    global.logger.error(callId, `Processing Event failed: ${eventMethod}`, e);
                }
            } else {
                global.logger.warn(callId, `<<< No Event Method for: ${eventMethod} >>>`);
            }
            await EventQueue._process(callId);
        } else {
            global.calls[callId].eventQueueFlag = false;
            global.logger.info(callId, '<<< EventQ is empty >>>');
        }
    }
};

// EventQueue.setProcessingFlag = (callId) => {
//     global.calls[callId].eventQueueFlag = true;
// };

EventQueue.add = async (callId, data) => {
    if (global.calls[callId]) {
        EventQueue._queueChannelEvent(callId, data);
        if (!global.calls[callId].eventQueueFlag) {
            await EventQueue._process(callId);
        } else {
            global.logger.info(callId, '<<< Queue Processing Flag; Skipped >>>');
        }
    } else {
        global.logger.warn(callId, 'global.calls[callId] is not available');
        global.logger.warn(callId, data);
    }
};

// EventQueue.process = (callId) => {
//     EventQueue._process(callId);
// };

EventQueue.clear = (callId) => {
    global.calls[callId].eventQ = [];
    global.logger.info(callId, '<<< EventQ Cleared >>>');
};

EventQueue._queueChannelEvent = (callId, data) => {
    global.logger.info(callId, '<<< Adding event to Queue >>>' + data.eventName);
    global.calls[callId].eventQ.push(data);
};


module.exports = EventQueue;