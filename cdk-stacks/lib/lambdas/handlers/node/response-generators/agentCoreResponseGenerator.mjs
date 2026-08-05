const { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } = require("@aws-sdk/client-bedrock-agentcore");

exports.handler = async (event, context, callback) => {
    try {
        console.info("App Version:", process.env.APPLICATION_VERSION)
        console.trace(`Event: `, JSON.stringify(event, null, 2));

        let recipient = event.recipient
        let useCase = event.useCase
        let agentRuntimeArn = useCase.agentRuntimeArn
        let sessionId = event.sessionVariables.sessionId

        // Derive runtimeUserId: actor-id-{phoneNumberWithoutPlus}
        let phoneNumberWithoutPlus = recipient.destinationAddress.replace(/^\+/, '')
        let runtimeUserId = `actor-id-${phoneNumberWithoutPlus}`

        // Build payload with prompt and phone_number
        let payload = {
            prompt: recipient.messageBody,
            phone_number: recipient.destinationAddress
        }

        // Build InvokeAgentRuntimeCommand input
        let commandInput = {
            agentRuntimeArn: agentRuntimeArn,
            runtimeSessionId: sessionId,
            runtimeUserId: runtimeUserId,
            contentType: "application/json",
            payload: Buffer.from(JSON.stringify(payload))
        }

        console.trace(`AgentCore command input: `, JSON.stringify(commandInput, null, 2));

        const client = new BedrockAgentCoreClient({ region: process.env.AWS_REGION });
        const command = new InvokeAgentRuntimeCommand(commandInput);
        const agentResponse = await client.send(command);

        // Parse response
        let rawResponse = await agentResponse.response.transformToString();
        let response

        try {
            let parsed = JSON.parse(rawResponse)
            // If structured JSON with content array containing text blocks, concatenate
            if (parsed.content && Array.isArray(parsed.content)) {
                let textBlocks = parsed.content
                    .filter(block => block.type === 'text' || (block.text !== undefined && block.type !== 'thinking'))
                    .map(block => block.text)
                response = textBlocks.join('\n')
            } else {
                // Parsed JSON but no content array with text blocks, use raw string
                response = rawResponse
            }
        } catch (parseError) {
            // Not valid JSON, use raw string directly
            response = rawResponse
        }

        // Strip any <thinking> tags that may have leaked through
        response = response.replace(/<thinking>[\s\S]*?<\/thinking>\s*/g, '').trim()

        console.trace('agentResponse: ', response)

        callback(null, { llmSessionId: sessionId, response: response, source: 'Bedrock AgentCore Runtime' })
    }
    catch (error) {
        console.error(`AgentCore Runtime error - agentRuntimeArn: ${event?.useCase?.agentRuntimeArn}, sessionId: ${event?.sessionVariables?.sessionId}`, error);
        callback(error)
    }
}
