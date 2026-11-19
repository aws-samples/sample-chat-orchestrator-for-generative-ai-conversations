// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.

import { randomUUID } from 'crypto';

// SPDX-License-Identifier: MIT-0
const DynamoDBService = require('./services/DynamoDBService.mjs');
const FirehoseService = require('./services/FirehoseService.mjs');
const LambdaService = require('./services/LambdaService.mjs');
const PinpointService = require('./services/PinpointService.mjs');
const xss = require("xss") //https://github.com/leizongmin/js-xss
const Cache = require('./services/CacheService.js');
// Initialize cache
const cache = new Cache();

const writeMessageToStorage = async (recipient, direction, channel, messageContent, messageId, sessionId = null, sessionVariables = {}) => {
    // Write to DynamoDB
    const dbParams = {
        phoneNumber: recipient.destinationAddress,
        messageId: messageId,
        channel: channel,
        timestamp: Date.now(),
        message: xss(messageContent),
        serviceAddress: recipient.serviceAddress,
        direction: direction,
        previousPublishedMessageId: recipient.previousPublishedMessageId,
        sessionId: sessionId,
        sessionVariables: sessionVariables,
        ttl: (Date.now() / 1000) + parseInt(process.env.SESSION_SECONDS)
    }
    console.trace(dbParams)
    const putResults = await DynamoDBService.put(process.env.CONTEXT_DYNAMODB_TABLE, dbParams);
    console.debug(`put${direction}Results: `, putResults);

    // Write to Firehose if configured
    if (process.env.CONVERSATION_FIREHOSE_STREAM) {
        const firehoseParams = {
            accountId: process.env.ACCOUNT_ID,
            organizationId: process.env.ORGANIZATION_ID,
            messageId: messageId,
            serviceAddress: recipient.serviceAddress,
            destinationAddress: recipient.destinationAddress,
            channel: channel,
            direction: direction,
            sessionId: sessionId,
            sessionVariables: sessionVariables,
            timestamp: Date.now(),
            tags: {},
            message: messageContent
        }
        await FirehoseService.firehoseDirectPut(process.env.CONVERSATION_FIREHOSE_STREAM, firehoseParams);
    }
}

const sendResponse = async (useCase, recipient, inboundMessage, outboundMessage, imageId = null, sessionId, sessionVariables = {}) => {
    let channel = []
    if (sessionVariables.channel && !sessionVariables.channel.toLowerCase().startsWith('api')) {
        //find the channel in the usecase that matches the recipient channel
        channel = useCase.channels.find(channel => channel.channel === sessionVariables.channel)
    } else {
        channel.channel = sessionVariables.channel || 'API'
    }

    let response = { 'message': 'No channel processor response generated.',
        'messageId': randomUUID()
    }

    if(!channel.channel.toLowerCase().startsWith('api')){
        if(imageId){
            response = await LambdaService.invoke(channel.processorLambdaName, {recipient, channel, outboundMessage, imageId})
        } else {
            response = await LambdaService.invoke(channel.processorLambdaName, {recipient, channel, outboundMessage})
        }
    }

    console.log('Response: ', JSON.stringify(response, null, 2))

    // Return data needed for storage operations in main handler
    return {
        channel: channel.channel,
        response: response,
        inboundMessage: inboundMessage,
        outboundMessage: outboundMessage,
        sessionId: sessionId,
        sessionVariables: sessionVariables
    }
}

const getConversation = async (phoneNumber, channel) => {
    try {
        let params = {
            TableName : process.env.CONTEXT_DYNAMODB_TABLE,
            IndexName: "PhoneIndex",
            KeyConditionExpression: "phoneNumber = :phoneNumber",
            // Expired items are returned on purpose: processMessage still needs
            // the last use case after the session window ends, and it filters on ttl itself.
            FilterExpression: "channel = :channel",
            ExpressionAttributeValues: {
                ":phoneNumber": phoneNumber,
                ":channel": channel
            }
        }
        const getConversationResults = await DynamoDBService.query(params);
        console.debug('Get Conversation Results: ', getConversationResults);
        console.debug(JSON.stringify(getConversationResults, null, 2))
        console.debug(getConversationResults.length)
        return getConversationResults
    }
    catch (error) {
        console.error(error);
        return false
    }

}

// End User Messaging answers keywords (STOP, HELP, or any keyword configured
// with PutKeyword) itself, then still publishes the message to SNS. Skip those
// messages so the customer doesn't also get an agent reply.
//
// The SMS payload names the matched keyword in messageKeyword, but the RCS
// payload has no messageKeyword field, so the body is also compared with the
// keywords configured on the receiving phone number or RCS agent. Only a
// message that is exactly a keyword (ignoring case and surrounding spaces)
// counts: on RCS, "Help me with my order" gets no keyword response, so it
// must reach the agent.

// Opt-out keywords the service handles on every number (keywords-required in the
// End User Messaging SMS User Guide), matched only as the whole message.
const REQUIRED_OPT_OUT_KEYWORDS = ['ARRET', 'CANCEL', 'END', 'OPT-OUT', 'OPTOUT', 'QUIT', 'REMOVE', 'STOP', 'TD', 'UNSUBSCRIBE']

// DescribeKeywords needs the phone number ID or RCS agent ID, which the
// inbound SMS payload doesn't carry, so the stack passes them in.
const keywordIdentityForChannel = (channel) => {
    if (channel === 'sms') return process.env.SMS_ORIGINATION_NUMBER_ID
    if (channel === 'rcs') return process.env.RCS_AGENT_ID
    return undefined
}

const getConfiguredKeywords = async (originationIdentity) => {
    const cacheKey = `keywords:${originationIdentity}`
    let keywords = cache.get(cacheKey)
    if (!keywords) {
        keywords = await PinpointService.describeKeywords(originationIdentity)
        cache.set(cacheKey, keywords, 300) // Cache for 5 minutes, like the use cases
    }
    return keywords
}


const isKeywordMessage = async (inboundMessage, channel) => {
    const body = typeof inboundMessage.messageBody === 'string' ? inboundMessage.messageBody.trim().toUpperCase() : ''
    if (!body) return false

    const payloadKeyword = typeof inboundMessage.messageKeyword === 'string' ? inboundMessage.messageKeyword.trim().toUpperCase() : ''
    if (payloadKeyword && body.startsWith(payloadKeyword)) return true

    const originationIdentity = keywordIdentityForChannel(channel)
    if (!originationIdentity) return false

    if (REQUIRED_OPT_OUT_KEYWORDS.includes(body)) return true

    try {
        const keywords = await getConfiguredKeywords(originationIdentity)
        return keywords.includes(body)
    } catch (error) {
        // Fail open: the opt-out keywords above are still skipped
        console.error('Keyword lookup failed, processing message anyway: ', error)
        return false
    }
}

// SNS delivers at least once, so the same inbound message can arrive twice.
// The inbound message is stored with its inboundMessageId as the sort key,
// so an existing item means this message was already processed.
const isDuplicateInbound = async (inboundMessage) => {
    try {
        const existing = await DynamoDBService.get(process.env.CONTEXT_DYNAMODB_TABLE, {
            phoneNumber: inboundMessage.destinationAddress,
            messageId: inboundMessage.inboundMessageId
        })
        return !!existing?.Item
    } catch (error) {
        // Fail open: answering a rare duplicate is better than dropping a message
        console.error('Duplicate check failed, processing message anyway: ', error)
        return false
    }
}

//Forward the message as is to the recipient
const forwardMessage = async (recipient, message, useCase, imageId = null) => {

    //find the channel in the usecase that matches the recipient channel
    let channel = useCase.channels.find(channel => channel.channel === recipient.channel)

    //Call the channel processor lambda
    let response = null
    if(imageId){    
        response = await LambdaService.invoke(channel.processorLambdaName, {recipient, channel, "outboundMessage": message, "imageId": imageId})
    } else {
        response = await LambdaService.invoke(channel.processorLambdaName, {recipient, channel, "outboundMessage": message})
    }

    console.trace('Response: ', JSON.stringify(response,null,2));

    // Return data needed for storage operations in main handler
    let sessionId = randomUUID()
    return {
        responseMessage: message,
        outboundMessageId: response.messageId,
        sessionId: sessionId,
        sessionVariables: {useCaseId: useCase.useCase, channel: recipient.channel, sessionId: sessionId}
    }
}

const processMessage = async (useCases, recipient, message) => {
    let responseMessage = null

    if(useCases.Items.find(useCase => useCase.useCase.toLowerCase().trim() === recipient.messageBody.toLowerCase().trim())){ 
        //Did we receive a word that matches one of our useCases?
        await DynamoDBService.deleteItemsByPartitionKey(process.env.CONTEXT_DYNAMODB_TABLE, 'phoneNumber', recipient.destinationAddress)
        let useCase = useCases.Items.find(useCase => useCase.useCase.toLowerCase().trim() === recipient.messageBody.toLowerCase().trim())
        console.trace(useCase)
        let sessionId = randomUUID()

        //Send Initial Message
        responseMessage = useCase.initialMessage
        const sendResponseResult = await sendResponse(useCase, recipient, message, responseMessage, useCase.initialImageId, sessionId, {useCaseId: useCase.useCase, channel: recipient.channel, sessionId: sessionId});
        
        return {
            responseMessage: responseMessage,
            outboundMessage: sendResponseResult.outboundMessage,
            outboundMessageId: sendResponseResult.response.messageId,
            sessionId: sendResponseResult.sessionId,
            sessionVariables: sendResponseResult.sessionVariables
        }

    } else {

        //Get Conversation
        const storedMessages = await getConversation(recipient.destinationAddress, recipient.channel) || []
        // DynamoDB deletes expired items in the background, sometimes days later,
        // so check ttl here to keep SESSION_SECONDS authoritative for the session.
        const now = Date.now() / 1000
        const conversation = storedMessages.filter(item => Number(item.ttl) > now)
        const lastStored = storedMessages[storedMessages.length - 1]
        const lastActive = conversation[conversation.length - 1]

        let sessionVariables = {}

        // Use passed-in useCaseId if provided, otherwise fall back to the last stored message,
        // even an expired one, so a customer who comes back after the session window still
        // reaches their use case instead of failing with no use case
        sessionVariables.useCaseId = recipient.useCaseId || lastStored?.sessionVariables?.useCaseId
        // Reuse the session id only within the session window: AgentCore and Bedrock Agents keep
        // conversation context per session id. After it expires, start a new session.
        sessionVariables.sessionId = lastActive?.sessionVariables?.sessionId ?? randomUUID()

        if (lastActive?.sessionVariables?.llmSessionId) sessionVariables.llmSessionId = lastActive.sessionVariables.llmSessionId
        if (lastStored?.sessionVariables?.channel) sessionVariables.channel = lastStored.sessionVariables.channel
        
        let useCase = useCases.Items.find(useCase => useCase.useCase.toLowerCase().trim() === sessionVariables.useCaseId)
        console.trace('Determined Use Case: ', JSON.stringify(useCase, null, 2))

        //Call the response generator lambda
        let response = await LambdaService.invoke(useCase.responseGeneratorLambdaName, {useCase, recipient, conversation, sessionVariables})
        responseMessage = response.response

        const sendResponseResult = await sendResponse(useCase, recipient, message, responseMessage, null, sessionVariables.sessionId, sessionVariables)
        
        return {
            responseMessage: responseMessage,
            outboundMessage: sendResponseResult.outboundMessage,
            outboundMessageId: sendResponseResult.response.messageId,
            sessionId: sendResponseResult.sessionId,
            sessionVariables: sendResponseResult.sessionVariables
        }
    }
}

const processTemplate = async (useCase, recipient, message) => {

    //find the channel in the usecase that matches the recipient channel
    let channel = useCase.channels.find(channel => channel.channel === recipient.channel)

    if(channel.channel === 'whatsapp'){ 
        //Call the channel processor lambda
        let response = await LambdaService.invoke(channel.processorLambdaName, {recipient, channel, message})

        console.trace('response: ', response)

        // Return data needed for storage operations in main handler
        let sessionId = randomUUID()
        return {
            responseMessage: message,
            outboundMessageId: response.messageId,
            sessionId: sessionId,
            sessionVariables: {useCaseId: useCase.useCase, channel: recipient.channel, sessionId: sessionId}
        }
    } else {
        throw new Error('Unsupported channel: ' + channel.channel)
    }

}

exports.handler = async (event, _context, callback) => {
    try {
        console.info("App Version:", process.env.APPLICATION_VERSION)
        console.trace(`Event: `, JSON.stringify(event,null,2));

        let useCases = cache.get('useCases');
        if (!useCases) {
            useCases = await DynamoDBService.scan(process.env.USECASE_DYNAMODB_TABLE);
            cache.set('useCases', useCases, 300); // Cache for 5 minutes
        }

        let inboundMessage = null

        if (event.inboundMessage) { //Direct Call
            inboundMessage = event.inboundMessage
        } else if (event.body) { //API Gateway Call
            let body = JSON.parse(event.body)
            console.trace('body: ', body)
            if (body.inboundMessage) {
                inboundMessage = body.inboundMessage
            } else {
                throw new Error('No inboundMessage found in event.body')
            }
        } else {
            throw new Error('No inboundMessage found in event')
        }

        console.trace('inboundMessage: ', inboundMessage)

        let channel = inboundMessage.channel
        if(!channel) {
            //Call the Channel Finder Lambda to determine the channel
            let channelResponse = await LambdaService.invoke(process.env.CHANNEL_FINDER_LAMBDA_NAME, {recipient: inboundMessage})
            channel = channelResponse.channel
        }

        if (inboundMessage.action === 'process') {
            if (await isKeywordMessage(inboundMessage, channel)) {
                console.info(`Skipping keyword message on ${channel} (${inboundMessage.inboundMessageId}); End User Messaging sends the keyword response.`)
                callback(null, {'responseMessage': null, 'skipped': 'keyword'})
                return
            }
            if (inboundMessage.inboundMessageId && inboundMessage.destinationAddress && await isDuplicateInbound(inboundMessage)) {
                console.info(`Skipping duplicate inbound message ${inboundMessage.inboundMessageId}`)
                callback(null, {'responseMessage': null, 'skipped': 'duplicate'})
                return
            }
        }

        if(!inboundMessage.inboundMessageId) inboundMessage.inboundMessageId = randomUUID();

        let message = inboundMessage.messageBody 
        let useCase = null
        let responseMessage = null
        let actionResult = null
        switch(inboundMessage.action){
            case 'forward':
                //Forward the message as is to the inboundMessage sender
                useCase = useCases.Items.find(useCase => useCase.useCase.toLowerCase().trim() === inboundMessage.useCaseId)
                actionResult = await forwardMessage(inboundMessage, message, useCase, inboundMessage.imageId)
                responseMessage = actionResult.responseMessage
                
                // Write outbound message to storage
                await writeMessageToStorage(inboundMessage, 'outbound', channel, message, actionResult.outboundMessageId, actionResult.sessionId, actionResult.sessionVariables);
                break;
            case 'process':
                actionResult = await processMessage(useCases, inboundMessage, message)
                responseMessage = actionResult.responseMessage
                
                // Write messages to storage
                await writeMessageToStorage(inboundMessage, 'inbound', channel, message, inboundMessage.inboundMessageId, actionResult.sessionId, actionResult.sessionVariables);
                await writeMessageToStorage(inboundMessage, 'outbound', channel, actionResult.outboundMessage, actionResult.outboundMessageId, actionResult.sessionId, actionResult.sessionVariables);
                break;
            case 'template':
                useCase = useCases.Items.find(useCase => useCase.useCase.toLowerCase().trim() === inboundMessage.useCaseId)
                actionResult = await processTemplate(useCase, inboundMessage, message)
                responseMessage = actionResult.responseMessage
                
                // Write outbound message to storage
                await writeMessageToStorage(inboundMessage, 'outbound', channel, message, actionResult.outboundMessageId, actionResult.sessionId, actionResult.sessionVariables);
                break;
            default:
                break;
        }  
        callback(null,{'responseMessage': responseMessage})
    }
    catch (error) {
        console.error(error);
        callback(error)
    }
}
