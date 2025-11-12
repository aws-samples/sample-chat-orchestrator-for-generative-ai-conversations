exports.handler = async (event, context, callback) => {

    try {
        console.info("App Version:", process.env.APPLICATION_VERSION)
        console.trace(`Event: `, JSON.stringify(event,null,2));

        for (const record of event.Records) {
            console.trace(`Record: `, record);
            let snsMessage = JSON.parse(record.Sns.Message)
            let message = {}
            console.trace(`Message: `, snsMessage);

            let channel = 'sqs'
        }
        callback(null, 'Success')
    }
    catch (error) {
        console.error(error);
        callback(error)
    }
}