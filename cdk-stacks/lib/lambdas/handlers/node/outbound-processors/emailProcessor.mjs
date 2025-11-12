import { sendEmail } from '../services/SESService.mjs';

exports.handler = async (event, context, callback) => {
    try {
        console.info("App Version:", process.env.APPLICATION_VERSION)
        console.trace(`Event: `, JSON.stringify(event,null,2));

        let recipient = event.recipient
        let emailResponse = await sendEmail(recipient.destinationAddress, recipient.subject, recipient.messageBody, recipient.fromAddress, recipient.configurationSet);
        callback(null, {messageId: emailResponse?.MessageId})
        
    }
    catch (error) {
        console.error(error);
        callback(error)
    }
}