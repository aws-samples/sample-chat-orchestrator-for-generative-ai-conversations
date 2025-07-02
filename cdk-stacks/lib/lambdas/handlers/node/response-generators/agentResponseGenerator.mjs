const BedrockService = require('../services/BedrockService.mjs')
const Utilities = require('../services/UtilitiesService.mjs')
exports.handler = async (event, context, callback) => {
    try {
        console.info("App Version:", process.env.APPLICATION_VERSION)
        console.trace(`Event: `, JSON.stringify(event,null,2));

        let recipient = event.recipient
        let useCase = event.useCase
        let sessionId = event.sessionVariables.sessionId

        const sessionState = {  
            "promptSessionAttributes": {
                "name": recipient.senderName,
                "phoneNumber": recipient.destinationAddress
            }
        }

        //If the first message is outbound, send message with instructions to the agent but do not send the response
        if(event.conversation.length === 1 && event.conversation[0].direction === 'outbound'){
            let initialMessage = process.env.AGENT_PRELOAD_MESSAGE + event.conversation[0].message
            let agentResponse = await BedrockService.invokeAgent(initialMessage, useCase, sessionId, sessionState)
            console.trace('preloadAgentResponse: ', agentResponse.completion)
        }
        
        let agentResponse = await BedrockService.invokeAgent(recipient.messageBody, useCase, sessionId, sessionState)
        console.trace('agentResponse: ', agentResponse)

        let response = agentResponse.completion
        let source = 'Bedrock Agent'

        callback(null, {'llmSessionId': sessionId, 'response': response, 'source': source})
    }
    catch (error) {
        console.error(error);
        callback(error)
    }
}