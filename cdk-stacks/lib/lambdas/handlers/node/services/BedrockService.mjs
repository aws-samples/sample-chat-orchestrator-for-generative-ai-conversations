// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { BedrockRuntimeClient, InvokeModelCommand, ConverseCommand, Trace } from "@aws-sdk/client-bedrock-runtime";
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

import { BedrockAgentRuntimeClient, InvokeAgentCommand, RetrieveAndGenerateCommand } from "@aws-sdk/client-bedrock-agent-runtime";
const agentRuntime = new BedrockAgentRuntimeClient({ region: process.env.AWS_REGION });

const { BedrockAgentClient, StartIngestionJobCommand } = require("@aws-sdk/client-bedrock-agent");
const agent = new BedrockAgentClient({ region: process.env.AWS_REGION });

const AGENT_RETRY_MAX_ATTEMPTS = parseInt(process.env.BEDROCK_AGENT_RETRY_MAX_ATTEMPTS || '3', 10)
const AGENT_RETRY_BASE_DELAY_MS = parseInt(process.env.BEDROCK_AGENT_RETRY_BASE_DELAY_MS || '500', 10)

const RETRYABLE_AGENT_ERROR_NAMES = new Set([
  'DependencyFailedException',
  'InternalServerException',
  'ServiceUnavailableException',
  'ThrottlingException',
  'TooManyRequestsException'
])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const isRetryableAgentError = (error) => {
  const message = (error?.message || '').toLowerCase()
  return Boolean(
    error?.$retryable ||
    RETRYABLE_AGENT_ERROR_NAMES.has(error?.name) ||
    message.includes('timeout') ||
    message.includes('try the request again') ||
    message.includes('temporarily unavailable')
  )
}

const buildAgentRetryMessage = (error) => {
  if (error?.name === 'ThrottlingException' || error?.name === 'TooManyRequestsException') {
    return 'Le service reçoit trop de demandes pour le moment. Merci de réessayer dans une minute.'
  }

  return "Le service met trop de temps à répondre pour le moment. Merci de réessayer dans quelques instants."
}

export async function invokeModel (promptEnvelope, useCase) {
  console.trace('invokeModel')
  console.trace(useCase)
  console.trace(promptEnvelope)

  const input = { // InvokeModelRequest
    body: JSON.stringify(promptEnvelope),
    contentType: "application/json",
    accept: "application/json",
    modelId: useCase.modelId,
  };

  if (useCase.guardrailId){
    input.guardrailIdentifier = useCase.guardrailId
    input.guardrailVersion = useCase.guardrailVersion
    input.guardrailMode = useCase.guardrailMode
  }

  console.trace(input)

  try {
    const bedrockCommand = new InvokeModelCommand(input);
    const bedrockResponse = await bedrock.send(bedrockCommand);
    console.trace(bedrockResponse)
    const response = new TextDecoder().decode(bedrockResponse.body)
    return JSON.parse(response)
  } catch (error) {
    console.error('Bedrock.invokeModel: ', error);
    throw new Error(error.message);
  }
}

export async function converse (promptEnvelope, useCase) {
  console.trace('converse')
  console.trace(useCase)
  console.trace(promptEnvelope)


  if (useCase.guardrailId){
    promptEnvelope.guardrailConfig = {
      guardrailIdentifier: useCase.guardrailId,
      guardrailVersion: useCase.guardrailVersion,
    }
  }

  console.trace(promptEnvelope)

  try {
    const bedrockCommand = new ConverseCommand(promptEnvelope);
    const bedrockResponse = await bedrock.send(bedrockCommand);
    console.trace(bedrockResponse)
    const response = new TextDecoder().decode(bedrockResponse.body)
    return bedrockResponse.output.message.content[0].text
  } catch (error) {
    console.error('Bedrock.converse: ', error);
    throw new Error(error.message);
  }
}

export async function invokeAgent (prompt, useCase, sessionId, sessionState=undefined) {

  const agentId = useCase.agentId;
  const agentAliasId = useCase.agentAliasId;

  for (let attempt = 1; attempt <= AGENT_RETRY_MAX_ATTEMPTS; attempt++) {
    const command = new InvokeAgentCommand({
      agentId,
      agentAliasId,
      sessionId,
      inputText: prompt,
      sessionState
    });

    console.trace(command)

    try {

      let completion = "";
      let returnControl = undefined;
      const response = await agentRuntime.send(command);

      if (response.completion === undefined) {
        throw new Error("Completion is undefined");
      }

      for await (const chunkEvent of response.completion) {
        if (chunkEvent.returnControl) {
          console.log('returnControl: ', chunkEvent.returnControl);
          returnControl = chunkEvent.returnControl;
        }

        const chunk = chunkEvent.chunk;
        if (chunk?.bytes) {
          const decodedResponse = new TextDecoder("utf-8").decode(chunk.bytes);
          console.log('chunk decoded', { byteLength: chunk.bytes.length, textLength: decodedResponse.length });
          completion += decodedResponse;
        }
      }

      return { completion, returnControl };

    } catch (error) {
      const retryable = isRetryableAgentError(error)
      const attemptsRemaining = attempt < AGENT_RETRY_MAX_ATTEMPTS

      console.error('InvokeAgent error: ', {
        name: error?.name,
        message: error?.message,
        attempt,
        retryable,
        attemptsRemaining,
        stack: error?.stack
      });

      if (retryable && attemptsRemaining) {
        const delayMs = AGENT_RETRY_BASE_DELAY_MS * attempt
        await sleep(delayMs)
        continue
      }

      if (retryable) {
        const completion = buildAgentRetryMessage(error)
        return { completion, output: { text: completion } }
      }

      throw error;
    }
  }
}

export async function retrieveAndGenerate (prompt, useCase, sessionId=undefined) {
  console.trace('retrieveAndGenerate')
  let modelArn = ''
  let isAmazonModel = useCase.modelId.includes('amazon')
  if (isAmazonModel){
    modelArn = `arn:aws:bedrock:${process.env.AWS_REGION}::foundation-model/${useCase.modelId}`
  } else {
    modelArn = `arn:aws:bedrock:${process.env.AWS_REGION}:${process.env.AWS_ACCOUNT_ID}:inference-profile/${useCase.modelId}`
  }
  const input = {
    input: {
      text: prompt,
    },
    retrieveAndGenerateConfiguration: {
      type: "KNOWLEDGE_BASE",
      knowledgeBaseConfiguration: {
        knowledgeBaseId: useCase.knowledgeBaseId,
        modelArn: modelArn,
        generationConfiguration: {
          inferenceConfig: {
            textInferenceConfig: {
              maxTokens: parseInt(useCase.llmMaxTokens),
              temperature: parseFloat(useCase.llmTemperature)
            }
          },
        },
      },
    },
  };

  if (useCase.guardrailId){
    input.retrieveAndGenerateConfiguration.knowledgeBaseConfiguration.generationConfiguration.guardrailConfiguration = {
      guardrailId: useCase.guardrailId,
      guardrailVersion: useCase.guardrailVersion,
    }
  }

  //Override defaults
  if (sessionId) input.sessionId = sessionId

  if (useCase.promptTemplate){
    input.retrieveAndGenerateConfiguration.knowledgeBaseConfiguration.generationConfiguration.promptTemplate = {
      textPromptTemplate: useCase.promptTemplate
    }
  }

  if (useCase.retrievalFilter) {
    input.retrieveAndGenerateConfiguration.knowledgeBaseConfiguration.retrievalConfiguration = {
      vectorSearchConfiguration: {
        filter: useCase.retrievalFilter
      }
    }
  }

  console.trace(input)

  try {
    const command = new RetrieveAndGenerateCommand(input);
    const response = await agentRuntime.send(command);
    console.trace(response)
    return response
  } catch (error) {
    console.error('Bedrock.retrieveAndGenerate: ', error);
    if (error.name == "ThrottlingException"){
      return {output:{text:'Request Rate exceeded, please wait a minute and try again'}}
    } else {
      throw new Error(error.message);
    }
  }
}

export async function startIngestionJob (context) {

  const input = {
    knowledgeBaseId: process.env.KNOWLEDGE_BASE_ID,
    dataSourceId: process.env.DATA_SOURCE_ID,
    clientToken: context.awsRequestId,
  };
  console.trace(input)

  try {
    const command = new StartIngestionJobCommand(input);
    const response = await agent.send(command);
    console.trace(response)
    return response
  } catch (error) {
    console.error('Bedrock.startIngestionJob: ', error);
    throw new Error(error.message);
  }
}
