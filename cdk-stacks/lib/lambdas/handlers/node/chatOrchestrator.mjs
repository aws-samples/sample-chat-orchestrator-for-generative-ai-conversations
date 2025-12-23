// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.

import { randomUUID } from 'crypto';

// SPDX-License-Identifier: MIT-0
const DynamoDBService = require('./services/DynamoDBService.mjs');
const FirehoseService = require('./services/FirehoseService.mjs');
const LambdaService = require('./services/LambdaService.mjs');
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
        let conversation = await getConversation(recipient.destinationAddress, recipient.channel)

        let sessionVariables = {}

        // Use passed-in useCaseId if provided, otherwise fall back to conversation history
        sessionVariables.useCaseId = recipient.useCaseId || conversation[conversation.length - 1]?.sessionVariables?.useCaseId
        // set random sessionId if no previous conversation
        sessionVariables.sessionId =  randomUUID() || conversation[conversation.length - 1]?.sessionVariables?.sessionId

        if (conversation[conversation.length - 1]?.sessionVariables?.llmSessionId) sessionVariables.llmSessionId = conversation[conversation.length - 1].sessionVariables.llmSessionId
        if (conversation[conversation.length - 1]?.sessionVariables?.channel) sessionVariables.channel = conversation[conversation.length - 1].sessionVariables.channel
        
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
