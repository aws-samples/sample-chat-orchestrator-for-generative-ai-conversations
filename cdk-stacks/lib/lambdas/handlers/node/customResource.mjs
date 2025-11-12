import { configure, sendSuccess, sendFailure, sendResponse, LOG_VERBOSE, SUCCESS } from 'cfn-custom-resource';
import { PinpointSMSVoiceV2Client, UpdatePhoneNumberCommand } from "@aws-sdk/client-pinpoint-sms-voice-v2"; // ES Modules import
import {SocialMessagingClient, PutWhatsAppBusinessAccountEventDestinationsCommand, ListLinkedWhatsAppBusinessAccountsCommand} from "@aws-sdk/client-socialmessaging";

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocument } = require("@aws-sdk/lib-dynamodb");
const dynamoDBClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const ddbDocClient = DynamoDBDocument.from(dynamoDBClient);

import crypto from 'crypto';
const pinpointClient = new PinpointSMSVoiceV2Client({});
const socialMessagingClient = new SocialMessagingClient({});

/****************
 * Helper Functions
****************/
const setWhatsAppEventDestination = async (wabAccountId, snsTopicArn, roleArn) => {
  // Prepare the command input
  const input = {
    id: wabAccountId,
    eventDestinations: [
      {
        eventDestinationArn: snsTopicArn,
      }
    ]
  };

  console.trace(input)

  // Create the command
  const command = new PutWhatsAppBusinessAccountEventDestinationsCommand(input);

  try {
    // Send the command
    const response = await socialMessagingClient.send(command);
    console.log("Event destination set successfully:", response);
    return response;
  } catch (error) {
    console.error("Error setting event destination:", error);
    throw error;
  }
}

const whatsAppEventDestinationExists = async (wabaId) => {
  const input = {
    maxResults: 100,
  }
  
  try {
    const command = new ListLinkedWhatsAppBusinessAccountsCommand(input);
    const response = await socialMessagingClient.send(command);
    console.log("WhatsApp business accounts listed successfully:", response);
    for (const waba of response.linkedAccounts) {
      if (waba.id === wabaId) {
        if (waba.eventDestinations.length > 0) {
          return waba.eventDestinations[0].eventDestinationArn; //Currently only one event destination is supported
        } else {
          return false;
        }
      }
    }
    return false;
  } catch (error) {
    console.error("Error listing WhatsApp business accounts:", error);
    throw error;
  }
}

const updatePhoneNumber = async (props) => {
  try {
    const input = { 
      PhoneNumberId: props.SMSOriginationNumberId, 
      TwoWayEnabled: true,
      TwoWayChannelArn: props.ChatSNSTopicARN,
      TwoWayChannelRole: props.SNSRoleARN,
      SelfManagedOptOutsEnabled: false,
      DeletionProtectionEnabled: false,
    };
    console.trace(input)
    const command = new UpdatePhoneNumberCommand(input);
    const response = await pinpointClient.send(command);
    console.trace(response);
    return response
  }
  catch (error) {
      console.error(error);
      return false
  }
}

const putDynamoDBItem = async (tableName, item) => {
  const params = {
    TableName : tableName,
    Item: item
  }

  try {
    const results = await ddbDocClient.put(params);
    return results
  } catch (error) {
    console.error(error);
    return false
  }
}

/****************
 * Main
****************/
export const handler = async (event, context, callback) => {
    console.log('Received event:', JSON.stringify(event, null, 2));

    const props = event.ResourceProperties
    const requestType = event.RequestType
    let physicalId = event.PhysicalResourceId

    if (requestType === 'Create') {
        physicalId = `vce.eum-config.${crypto.randomUUID()}`
    } else if(!physicalId) {
        sendResponse(event, context.logStreamName, 'FAILED', `invalid request: request type is '${requestType}' but 'PhysicalResourceId' is not defined`)
    }

    try{
      switch (event.ResourceType){
        case 'Custom::EUMConfig':
          if (requestType === 'Create' || requestType === 'Update'){
            //Create or Update Stuff
            await updatePhoneNumber(props);

            const result = await sendSuccess(physicalId, { }, event);
            return result
          } else if(requestType === 'Delete'){
            //Delete Stuff
            const result = await sendSuccess(physicalId, { }, event);
            return result
          } else {
            const result = await sendSuccess(physicalId, { }, event);
            return result
          }

        case 'Custom::SetWhatsAppEventDestination':
          if (requestType === 'Create' || requestType === 'Update'){
            let eventDestinationExists = await whatsAppEventDestinationExists(props.WhatsAppBusinessAccountId)
            if (!eventDestinationExists) { //If the WhatsApp Business Account does not have an event destination, create one
              await setWhatsAppEventDestination(props.WhatsAppBusinessAccountId, props.SNSTopicARN, props.SNSRoleARN)
            }
            const result = await sendSuccess(physicalId, { }, event);
            return result
          } else {
            const result = await sendSuccess(physicalId, { }, event);
            return result
          }

        case 'Custom::PutDynamoDBData':
          if (requestType === 'Create' || requestType === 'Update'){
            await putDynamoDBItem(props.UseCaseTableName, JSON.parse(props.Data))
            const result = await sendSuccess(physicalId, { }, event);
            return result
          } else {
            const result = await sendSuccess(physicalId, { }, event);
            return result
          }

        default:
          const result = await sendSuccess(physicalId, { }, event);
          return result
      }
    }
    catch (ex){
      console.log(ex);
      const result = await sendSuccess(physicalId, { }, event);
      return result
    }
};

