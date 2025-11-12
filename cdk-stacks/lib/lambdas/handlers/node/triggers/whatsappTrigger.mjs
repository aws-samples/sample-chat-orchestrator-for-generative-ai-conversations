const LambdaService = require('../services/LambdaService.mjs');

exports.handler = async (event, context, callback) => {

    try {
        console.info("App Version:", process.env.APPLICATION_VERSION)
        console.trace(`Event: `, JSON.stringify(event,null,2));

        let recipients = []
        for (const record of event.Records) {
            console.trace(`Record: `, record);
            let snsMessage = JSON.parse(record.Sns.Message)
            console.trace(`Message: `, snsMessage);

            let recipient = {}

            let whatsappMessage = JSON.parse(snsMessage.whatsAppWebhookEntry)
            try {
                if (whatsappMessage.changes[0]?.value?.messages[0]?.text?.body) { //We have an inbound message
                    recipient.destinationAddress = '+' + whatsappMessage.changes[0].value?.messages[0]?.from
                    recipient.serviceAddress = '+' + whatsappMessage.changes[0].value.metadata.display_phone_number
                    recipient.messageBody = whatsappMessage.changes[0].value?.messages[0]?.text?.body
                    recipient.inboundMessageId = whatsappMessage.changes[0].value?.messages[0]?.id
                    recipient.previousPublishedMessageId = whatsappMessage.changes[0]?.value?.messages[0]?.id 
                    recipient.senderName = whatsappMessage.changes[0]?.value?.contacts[0]?.profile?.name
                    recipient.action = 'process'
                    recipient.replyExpected = true
                    recipient.channel = 'whatsapp'
                    recipients.push(recipient)
                } else {
                    //TODO: Still working to add an SNS Filter Policy to only trigger on messages from users, but the webpayload is also json encoded and SNS Filter Policies don't suport regexes or decoding a JSON payload within the message
                    console.warn('No message found.')
                }
            }
            catch (error) {
                console.error(error)
                console.warn('No message found.')
            }
        }

        if (recipients.length > 0) {        
            //Execute the Chat Orchestrator Lambda
            const result = await LambdaService.invoke(process.env.CHAT_ORCHESTRATOR_LAMBDA_NAME, { recipients })
            console.trace('result', result)
        }

        callback(null, 'Success')
    }
    catch (error) {
        console.error(error);
        callback(error)
    }
}