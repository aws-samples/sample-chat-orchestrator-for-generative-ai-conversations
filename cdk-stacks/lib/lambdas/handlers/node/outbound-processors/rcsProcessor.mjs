
const PinpointService = require('../services/PinpointService.mjs');

exports.handler = async (event, context, callback) => {
    try {
        console.info("App Version:", process.env.APPLICATION_VERSION)
        console.trace(`Event: `, JSON.stringify(event,null,2));

        let recipient = event.recipient

        // Phase 1: plain text RCS only. Rich content (cards, carousels,
        // suggestions) will be added in Phase 2 via SendRcsMessage.
        let pinpointResponse = await PinpointService.sendRCS(recipient.destinationAddress, event.outboundMessage);
        callback(null, {messageId: pinpointResponse?.MessageId})
    }
    catch (error) {
        console.error(error);
        callback(error)
    }
}
