const LambdaService = require('../services/LambdaService.mjs');
const WhatsAppInteractive = require('../services/whatsappInteractive.mjs');

const PROSPECT_SESSION_FIELDS = [
    'ctwa_clid'
]

const getProspectFields = (...sources) => {
    return PROSPECT_SESSION_FIELDS.reduce((fields, field) => {
        const value = sources.filter(Boolean).find(source => source[field] !== undefined && source[field] !== null)?.[field]
        if (value !== undefined && value !== null && String(value).trim()) {
            fields[field] = String(value)
        }
        return fields
    }, {})
}

const getClickToWhatsAppFields = (referral = {}) => {
    return {
        ...(referral.ctwa_clid ? { ctwa_clid: String(referral.ctwa_clid) } : {})
    }
}

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
                const whatsappInboundMessage = whatsappMessage.changes[0]?.value?.messages?.[0]
                // A tapped reply/list button arrives as an interactive message; translate it into the
                // canonical phrase the classifier already understands so the rest of the flow is unchanged.
                const interactiveReply = whatsappInboundMessage?.interactive?.button_reply
                    || whatsappInboundMessage?.interactive?.list_reply
                const messageBody = whatsappInboundMessage?.text?.body
                    || (interactiveReply ? WhatsAppInteractive.mapButtonReplyToText(interactiveReply.id, interactiveReply.title) : undefined)

                if (messageBody) { //We have an inbound message

                    const referral = whatsappInboundMessage?.referral || {}

                    inboundMessage.destinationAddress = '+' + whatsappInboundMessage?.from
                    inboundMessage.serviceAddress = '+' + whatsappMessage.changes[0].value.metadata.display_phone_number
                    inboundMessage.messageBody = messageBody
                    inboundMessage.inboundMessageId = whatsappInboundMessage?.id
                    inboundMessage.previousPublishedMessageId = whatsappInboundMessage?.id
                    inboundMessage.senderName = whatsappMessage.changes[0]?.value?.contacts[0]?.profile?.name
                    inboundMessage.action = 'process'
                    inboundMessage.replyExpected = true
                    inboundMessage.channel = 'whatsapp'
                    if (interactiveReply?.id) {
                        inboundMessage.interactiveButtonId = interactiveReply.id
                    }
                    Object.assign(
                        inboundMessage,
                        getProspectFields(snsMessage, snsMessage.prospect, snsMessage.metadata, snsMessage.tracking),
                        getClickToWhatsAppFields(referral)
                    )

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
