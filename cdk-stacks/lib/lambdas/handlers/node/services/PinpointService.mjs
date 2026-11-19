// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { PinpointSMSVoiceV2Client, SendTextMessageCommand, SendMediaMessageCommand, DescribeKeywordsCommand } from "@aws-sdk/client-pinpoint-sms-voice-v2"; 
const pinpoint = new PinpointSMSVoiceV2Client({ region: process.env.AWS_REGION });

export async function sendSMS (destinationAddress, message, sessionId=undefined) {
  let configurationSet = process.env.CONFIGURATION_SET
  const pinpointInput = { 
    DestinationPhoneNumber: destinationAddress, 
    OriginationIdentity: process.env.ORIGINATION_NUMBER_ID,
    MessageBody: message, 
    DryRun: false,
  };
  if(process.env.CONFIGURATION_SET) pinpointInput.ConfigurationSetName = process.env.CONFIGURATION_SET
  if(sessionId) {
    pinpointInput.Context = {
      sessionId: sessionId
    }
  }
  console.trace(pinpointInput)

  try {
    const pinpointCommand = new SendTextMessageCommand(pinpointInput);
    const pinpointResponse = await pinpoint.send(pinpointCommand);
    return pinpointResponse
  } catch (error) {
      console.error('Pinpoint.SendTextMessageCommand: ', error);
      throw new Error(error.message);
  }
}

export async function sendRCS (destinationAddress, message, sessionId=undefined) {
  // Phase 1: plain text RCS via SendTextMessage using the RCS Agent ARN as the
  // origination identity (direct send, RCS-only, no SMS fallback).
  const pinpointInput = {
    DestinationPhoneNumber: destinationAddress,
    OriginationIdentity: process.env.RCS_AGENT_ARN,
    MessageBody: message,
    DryRun: false,
  };
  if(sessionId) {
    pinpointInput.Context = {
      sessionId: sessionId
    }
  }
  console.trace(pinpointInput)

  try {
    const pinpointCommand = new SendTextMessageCommand(pinpointInput);
    const pinpointResponse = await pinpoint.send(pinpointCommand);
    return pinpointResponse
  } catch (error) {
      console.error('Pinpoint.SendTextMessageCommand (RCS): ', error);
      throw new Error(error.message);
  }
}

export async function sendMMS (destinationAddress, s3URI, message) {
  const pinpointInput = { 
    DestinationPhoneNumber: destinationAddress, 
    OriginationIdentity: process.env.ORIGINATION_NUMBER_ID,
    MessageBody: message, 
    DryRun: false,
  };
  if(process.env.CONFIGURATION_SET) pinpointInput.ConfigurationSetName = process.env.CONFIGURATION_SET
  //Add Optional Items
  if(s3URI) pinpointInput.MediaUrls = [s3URI]

  console.trace(pinpointInput)

  try {
    const pinpointCommand = new SendMediaMessageCommand(pinpointInput);
    const pinpointResponse = await pinpoint.send(pinpointCommand);
    console.trace(`Pinpoint Response: `, JSON.stringify(pinpointResponse,null,2));
    return pinpointResponse
  } catch (error) {
      console.error('Pinpoint.SendMediaMessageCommand: ', error);
      throw new Error(error.message);
  }
}
// Returns the keywords configured on a phone number ID, pool ID or RCS agent ID,
// in upper case. DescribeKeywords does not accept an E.164 phone number.
export async function describeKeywords (originationIdentity) {
  const keywords = []
  let nextToken = undefined
  try {
    do {
      const response = await pinpoint.send(new DescribeKeywordsCommand({
        OriginationIdentity: originationIdentity,
        NextToken: nextToken
      }));
      for (const item of response.Keywords || []) {
        if (item.Keyword) keywords.push(item.Keyword.trim().toUpperCase())
      }
      nextToken = response.NextToken
    } while (nextToken)
    return keywords
  } catch (error) {
      console.error('Pinpoint.DescribeKeywordsCommand: ', error);
      throw new Error(error.message);
  }
}
