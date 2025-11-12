const WhatsAppService = require('../services/WhatsAppService.mjs');

exports.handler = async (event, context, callback) => {
    try {
        console.info("App Version:", process.env.APPLICATION_VERSION)
        console.trace(`Event: `, JSON.stringify(event,null,2));

        let recipient = event.recipient
        let whatsAppResponse = null
        switch(recipient.action){
            case 'forward':
                if(event.imageId){
                    whatsAppResponse = await WhatsAppService.sendWhatsAppImage(recipient.destinationAddress, event.imageId, event.outboundMessage);
                } else {
                    whatsAppResponse = await WhatsAppService.sendWhatsAppMessage(recipient.destinationAddress, event.outboundMessage);
                }
                break;
            case 'process':
                await WhatsAppService.markMessageAsRead(recipient.inboundMessageId)
                if(event.imageId){
                    whatsAppResponse = await WhatsAppService.sendWhatsAppImage(recipient.destinationAddress, event.imageId, event.outboundMessage);
                } else {
                    whatsAppResponse = await WhatsAppService.sendWhatsAppMessage(recipient.destinationAddress, event.outboundMessage);
                }
                break;
            case 'template':
                whatsAppResponse = await WhatsAppService.sendWhatsAppTemplateMessage(recipient.destinationAddress, event.outboundMessage);
                console.trace('whatsAppResponse: ', whatsAppResponse)
                break;
            default:
                break;
        }  
        callback(null, {messageId: whatsAppResponse?.messageId})
    }
    catch (error) {
        console.error(error);
        callback(error)
    }
}