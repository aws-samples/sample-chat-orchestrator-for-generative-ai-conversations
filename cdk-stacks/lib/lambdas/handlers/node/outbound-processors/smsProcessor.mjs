
const PinpointService = require('../services/PinpointService.mjs');

exports.handler = async (event, context, callback) => {
    try {
        console.info("App Version:", process.env.APPLICATION_VERSION)
        console.trace(`Event: `, JSON.stringify(event,null,2));

        let recipient = event.recipient
        let pinpointResponse = null
        if(event.imageId){
            let pinpointResponse = await PinpointService.sendMMS(recipient.destinationAddress, event.imageId, event.outboundMessage);
            callback(null, {messageId: pinpointResponse?.MessageId})   
        } else {
            let pinpointResponse = await PinpointService.sendSMS(recipient.destinationAddress, event.outboundMessage);
            callback(null, {messageId: pinpointResponse?.MessageId})
        }
        
    }
    catch (error) {
        console.error(error);
        callback(error)
    }
}