exports.handler = async (event, context, callback) => {
    try {
        console.info("App Version:", process.env.APPLICATION_VERSION)
        console.trace(`Event: `, JSON.stringify(event,null,2));
        //Implement customer specific logic to determine the correct channel
        callback(null, {
            channel: event.channel
        })
    }
    catch (error) {
        console.error(error);
        callback(error)
    }
}