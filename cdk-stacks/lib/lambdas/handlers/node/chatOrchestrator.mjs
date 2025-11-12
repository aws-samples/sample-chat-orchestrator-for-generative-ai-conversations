// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.

import { randomUUID } from 'crypto';

// SPDX-License-Identifier: MIT-0
const DynamoDBService = require('./services/DynamoDBService.mjs');
const BedrockService = require('./services/BedrockService.mjs');
const PinpointService = require('./services/PinpointService.mjs');
const WhatsAppService = require('./services/WhatsAppService.mjs');
const FirehoseService = require('./services/FirehoseService.mjs');
const LambdaService = require('./services/LambdaService.mjs');
const xss = require("xss") //https://github.com/leizongmin/js-xss
const Cache = require('./services/CacheService.js');
const Utilities = require('./services/UtilitiesService.mjs');

const restartKeywords = ['restart','begin','commence','initiate','launch','commence','start','demo','go','reset', 'clear']
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
    //find the channel in the usecase that matches the recipient channel
    let channel = useCase.channels.find(channel => channel.channel === sessionVariables.channel)

    //Call the channel processor lambda
    let response = null
    if(imageId){
        response = await LambdaService.invoke(channel.processorLambdaName, {recipient, channel, outboundMessage, imageId})
    } else {
        response = await LambdaService.invoke(channel.processorLambdaName, {recipient, channel, outboundMessage})
    }

    console.log('response: ', response)

    // Write inbound message to storage
    await writeMessageToStorage(recipient, 'inbound', channel.channel, inboundMessage, recipient.inboundMessageId, sessionId, sessionVariables);

    // Write outbound message to storage
    await writeMessageToStorage(recipient, 'outbound', channel.channel, outboundMessage, response.messageId, sessionId, sessionVariables);
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
    console.trace(`Response: `, JSON.stringify(response,null,2));

    // Write outbound message to storage
    let sessionId = randomUUID()
    await writeMessageToStorage(recipient, 'outbound', channel.channel, message, response.messageId, sessionId, {useCaseId: useCase.useCase, channel: recipient.channel, sessionId: sessionId});
}

const processMessage = async (useCases, recipient, message) => {
    if(useCases.Items.find(useCase => useCase.useCase.toLowerCase().trim() === recipient.messageBody.toLowerCase().trim())){ 
        //Did we receive a word that matches one of our useCases?
        await DynamoDBService.deleteItemsByPartitionKey(process.env.CONTEXT_DYNAMODB_TABLE, 'phoneNumber', recipient.destinationAddress)
        let useCase = useCases.Items.find(useCase => useCase.useCase.toLowerCase().trim() === recipient.messageBody.toLowerCase().trim())
        console.trace(useCase)
        let sessionId = randomUUID()

        //Send Initial Message
        await sendResponse(useCase, recipient, recipient.messageBody, useCase.initialMessage, useCase.initialImageId, sessionId, {useCaseId: useCase.useCase, channel: recipient.channel, sessionId: sessionId});

    } else {

        //Get Conversation
        let conversation = await getConversation(recipient.destinationAddress, recipient.channel)

        //Set Session and UseCase Ids if we have them.
        let llmSessionId = false
        let sessionVariables = {}
        if (conversation[conversation.length - 1]?.sessionVariables?.llmSessionId) sessionVariables.llmSessionId = conversation[conversation.length - 1].sessionVariables.llmSessionId
        if (conversation[conversation.length - 1]?.sessionId) sessionVariables.sessionId = conversation[conversation.length - 1].sessionVariables.sessionId
        if (conversation[conversation.length - 1]?.sessionVariables?.useCaseId) sessionVariables.useCaseId = conversation[conversation.length - 1].sessionVariables.useCaseId
        if (conversation[conversation.length - 1]?.sessionVariables?.channel) sessionVariables.channel = conversation[conversation.length - 1].sessionVariables.channel

        let useCase = useCases.Items.find(useCase => useCase.useCase.toLowerCase().trim() === sessionVariables.useCaseId)
        //Call the response generator lambda
        let response = await LambdaService.invoke(useCase.responseGeneratorLambdaName, {useCase, recipient, conversation, sessionVariables})

        await sendResponse(useCase, recipient, recipient.messageBody, response.response, null,sessionVariables.sessionId, sessionVariables)
    }
}

const processTemplate = async (useCase, recipient, message) => {

    //find the channel in the usecase that matches the recipient channel
    let channel = useCase.channels.find(channel => channel.channel === recipient.channel)

    if(channel.channel === 'whatsapp'){ 
        //Call the channel processor lambda
        let response = await LambdaService.invoke(channel.processorLambdaName, {recipient, channel, message})

        console.trace('response: ', response)

        // Write outbound message to storage
        let sessionId = randomUUID()
        await writeMessageToStorage(recipient, 'outbound', channel.channel, message, response.messageId, sessionId, {useCaseId: useCase.useCase, channel: recipient.channel, sessionId: sessionId}  );
    } else {
        throw new Error('Unsupported channel: ' + channel.channel)
    }
}

exports.handler = async (event, context, callback) => {
    try {
        console.info("App Version:", process.env.APPLICATION_VERSION)
        console.trace(`Event: `, JSON.stringify(event,null,2));

        let useCases = cache.get('useCases');
        if (!useCases) {
            useCases = await DynamoDBService.scan(process.env.USECASE_DYNAMODB_TABLE);
            cache.set('useCases', useCases, 300); // Cache for 5 minutes
        }

        let recipients = []

        if (event.recipients && event.recipients.length > 0) { //Direct Call
            recipients = event.recipients
        } else if (event.body) { //API Gateway Call
            let body = JSON.parse(event.body)
            console.trace('body: ', body)
            if (body.recipients && body.recipients.length > 0) {
                recipients = body.recipients
            } else {
                throw new Error('No recipients found1')
            }
        } else {
            throw new Error('No recipients found2')
        }

        console.trace('recipients: ', recipients)

        for (const recipient of recipients) {
            console.trace(`Recipient: `, recipient);
            let channel = recipient.channel
            if(!channel) {
                //Call the Channel Finder Lambda to determine the channel
                let channelResponse = await LambdaService.invoke(process.env.CHANNEL_FINDER_LAMBDA_NAME, {recipient})
                channel = channelResponse.channel
            }
            let message = recipient.messageBody 
            let useCase = null

            switch(recipient.action){
                case 'forward':
                    //Forward the message as is to the recipient
                    useCase = useCases.Items.find(useCase => useCase.useCase.toLowerCase().trim() === recipient.useCaseId)
                    await forwardMessage(recipient, message, useCase, recipient.imageId)
                    break;
                case 'process':
                    await processMessage(useCases, recipient, message)
                    break;
                case 'template':
                    useCase = useCases.Items.find(useCase => useCase.useCase.toLowerCase().trim() === recipient.useCaseId)
                    await processTemplate(useCase, recipient, message)
                    break;
                default:
                    break;
            }  
        }
        callback(null,{'processedRecipients': recipients.length})
    }
    catch (error) {
        console.error(error);
        callback(error)
    }
}
