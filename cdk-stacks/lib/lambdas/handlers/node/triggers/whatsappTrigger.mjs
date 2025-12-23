const LambdaService = require('../services/LambdaService.mjs');

exports.handler = async (event, context, callback) => {

    try {
        console.info("App Version:", process.env.APPLICATION_VERSION)
        console.trace(`Event: `, JSON.stringify(event,null,2));

        for (const record of event.Records) {

            console.trace(`Record: `, record);
            let snsMessage = JSON.parse(record.Sns.Message)
            console.trace(`Message: `, snsMessage);

            let inboundMessage = {}
            let whatsappMessage = JSON.parse(snsMessage.whatsAppWebhookEntry)
            
            try {
                if (whatsappMessage.changes[0]?.value?.messages[0]?.text?.body) { //We have an inbound message

                    inboundMessage.destinationAddress = '+' + whatsappMessage.changes[0].value?.messages[0]?.from
                    inboundMessage.serviceAddress = '+' + whatsappMessage.changes[0].value.metadata.display_phone_number
                    inboundMessage.messageBody = whatsappMessage.changes[0].value?.messages[0]?.text?.body
                    inboundMessage.inboundMessageId = whatsappMessage.changes[0].value?.messages[0]?.id
                    inboundMessage.previousPublishedMessageId = whatsappMessage.changes[0]?.value?.messages[0]?.id 
                    inboundMessage.senderName = whatsappMessage.changes[0]?.value?.contacts[0]?.profile?.name
                    inboundMessage.action = 'process'
                    inboundMessage.replyExpected = true
                    inboundMessage.channel = 'whatsapp'

                    console.trace('Inbound Message: ', JSON.stringify(inboundMessage,null,2));

                    //Execute the Chat Orchestrator Lambda
                    const response = await LambdaService.invoke(process.env.CHAT_ORCHESTRATOR_LAMBDA_NAME, { inboundMessage: inboundMessage })
                    console.trace('Response: ', JSON.stringify(response,null,2))

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

        callback(null, 'Success')
    }
    catch (error) {
        console.error(error);
        callback(error)
    }
}