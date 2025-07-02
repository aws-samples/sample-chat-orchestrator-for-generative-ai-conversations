const BedrockService = require('../services/BedrockService.mjs')
const Utilities = require('../services/UtilitiesService.mjs')
exports.handler = async (event, context, callback) => {
    try {
        console.info("App Version:", process.env.APPLICATION_VERSION)
        console.trace(`Event: `, JSON.stringify(event,null,2));

        let recipient = event.recipient
        let conversation = event.conversation
        let useCase = event.useCase
        let kbSessionId = event.sessionVariables.kbSessionId

        let retrieveResponse = await BedrockService.retrieveAndGenerate(recipient.messageBody, useCase, kbSessionId)
        console.trace(1)
        console.trace(retrieveResponse)

        let response = `I'm sorry, I couldn't find an answer based on the information available to me.`
        let source = 'Bedrock Knowledge Base'
        if(retrieveResponse.citations[0]?.retrievedReferences.length){ //We have at least one citation
            response = retrieveResponse.output.text
        } else { //Couldn't find and answer in KB, so send conversation to general LLM. Comment out this bit to use only KB responses.
            console.trace(2)
            const isAmazonModel = useCase.modelId.includes('amazon')
            if(isAmazonModel){
                // Format for Amazon models (Nova Micro, Nova Lite)
                let formattedConversation = Utilities.formatAmazonConversation(conversation)
                //Add most recent question to conversation:
                formattedConversation.push({"role": "user", "content": [{"text": recipient.messageBody}]})  

                const request = {
                    modelId: useCase.modelId,
                    messages: formattedConversation,
                    inferenceConfig: {
                        "maxTokens": parseInt(useCase.llmMaxTokens),
                        "temperature": parseFloat(useCase.llmTemperature),
                    },
                  };

                source = "Amazon LLM"
                response = await BedrockService.converse(request, useCase);
                console.trace(response)
            } else {
                console.trace(3)
                let formattedConversation = Utilities.formatAnthropicConversation(conversation)
                //Add most recent question to conversation:
                formattedConversation.push({"role": "user", "content": recipient.messageBody})

                let promptEnvelope = {
                    "messages":formattedConversation,
                    "anthropic_version":"bedrock-2023-05-31",
                    "max_tokens": parseInt(useCase.llmMaxTokens),
                    "temperature": parseFloat(useCase.llmTemperature)
                }

                source = "Anthropic LLM"
                let parsedResponse = await BedrockService.invokeModel(promptEnvelope, useCase);
                console.trace(parsedResponse)
                response = parsedResponse.content[0].text
            }
            
        } 

        if (!kbSessionId) kbSessionId = retrieveResponse.kbSessionId //making sure we carry over kbSessionId across different LLMs


        callback(null, {'llmSessionId': kbSessionId, 'response': response, 'source': source})
    }
    catch (error) {
        console.error(error);
        callback(error)
    }
}