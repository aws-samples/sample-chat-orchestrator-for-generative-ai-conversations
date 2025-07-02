// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { BedrockRuntimeClient, InvokeModelCommand, ConverseCommand, Trace } from "@aws-sdk/client-bedrock-runtime";
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

import { BedrockAgentRuntimeClient, InvokeAgentCommand, RetrieveAndGenerateCommand } from "@aws-sdk/client-bedrock-agent-runtime";
const agentRuntime = new BedrockAgentRuntimeClient({ region: process.env.AWS_REGION });

const { BedrockAgentClient, StartIngestionJobCommand } = require("@aws-sdk/client-bedrock-agent"); 
const agent = new BedrockAgentClient({ region: process.env.AWS_REGION });

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
    const response = await agentRuntime.send(command);

    if (response.completion === undefined) {
      throw new Error("Completion is undefined");
    }

    for await (const chunkEvent of response.completion) {
      const chunk = chunkEvent.chunk;
      console.log('chunk: ',chunk);
      const decodedResponse = new TextDecoder("utf-8").decode(chunk.bytes);
      completion += decodedResponse;
    }

    return { completion };

  } catch (error) {
    console.error('InvokeAgent error: ', error);
    if (error.name == "ThrottlingException"){
      return {output:{text:'Request Rate exceeded, please wait a minute and try again'}}
    } else {
      throw new Error(error.message);
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