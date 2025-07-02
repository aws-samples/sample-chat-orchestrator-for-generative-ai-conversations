const LambdaService = require('../services/LambdaService.mjs');

exports.handler = async (event, context, callback) => {

    try {
        console.info("App Version:", process.env.APPLICATION_VERSION)
        console.trace(`Event: `, JSON.stringify(event,null,2));

        let recipients = []
        for (const record of event.Records) {
            console.trace(`Record: `, record);
            let recipient = JSON.parse(record.Sns.Message)
            console.trace(`Message: `, recipient);

            recipient.action = 'process'
            recipient.replyExpected = true
            recipient.channel = 'sms'
            recipient.destinationAddress = recipient.originationNumber

            console.trace(`Recipient: `, recipient);
            recipients.push(recipient)
        }

        //Execute the Chat Orchestrator Lambda
        const result = await LambdaService.invoke(process.env.CHAT_ORCHESTRATOR_LAMBDA_NAME, { recipients })
        console.trace('result', result)

        callback(null, 'Success')
    }
    catch (error) {
        console.error(error);
        callback(error)
    }
}