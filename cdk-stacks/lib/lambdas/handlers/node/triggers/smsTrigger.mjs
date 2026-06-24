const LambdaService = require('../services/LambdaService.mjs');

exports.handler = async (event, context, callback) => {

    try {
        console.info('App Version: ', process.env.APPLICATION_VERSION)
        console.trace('Event: ', JSON.stringify(event,null,2));

        for (const record of event.Records) {

            console.trace('Record: ', JSON.stringify(record,null,2));

            let inboundMessage = JSON.parse(record.Sns.Message)
            inboundMessage.action = 'process'
            inboundMessage.replyExpected = true
            inboundMessage.channel = 'sms'
            inboundMessage.destinationAddress = inboundMessage.originationNumber

            console.trace('Inbound Message: ', JSON.stringify(inboundMessage,null,2));
            
            //Execute the Chat Orchestrator Lambda
            const response = await LambdaService.invoke(process.env.CHAT_ORCHESTRATOR_LAMBDA_NAME, { inboundMessage: inboundMessage })
            console.trace('Response: ', JSON.stringify(response,null,2))

        }

        callback(null, 'Success')
    }
    catch (error) {
        console.error(error);
        callback(error)
    }
}