// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { SESv2Client, SendEmailCommand, SendBulkEmailCommand } from "@aws-sdk/client-sesv2";
const sesv2 = new SESv2Client({ region: process.env.AWS_REGION });


export async function sendEmail(destination, subject, body, fromAddress, configurationSet = null) {
  const sesInput = {
    Destination: { ToAddresses: [destination] },
    Content: {
      Simple: {
        Subject: { Data: subject },
        Body: { Html: { Data: body } }
      }
    },
    FromEmailAddress: fromAddress
  };

  if (configurationSet) {
    sesInput.ConfigurationSet = configurationSet;
  }

  console.trace(sesInput);
  try {
    const sesCommand = new SendEmailCommand(sesInput);
    const sesResponse = await sesv2.send(sesCommand);
    return sesResponse;
  } catch (error) {
    console.error('SES.SendEmailCommand: ', error);
    throw new Error(error.message);
  }
}

export async function sendBulkEmail(destinations, subject, body, fromAddress) {
  const sesInput = {
    BulkEmailEntries: destinations.map(dest => ({
      Destination: { ToAddresses: [dest] }
    })),
    Content: {
      Simple: {
        Subject: { Data: subject },
        Body: { Html: { Data: body } }
      }
    },
    FromEmailAddress: fromAddress
  };
  console.trace(sesInput);
  try {
    const sesCommand = new SendBulkEmailCommand(sesInput);
    const sesResponse = await sesv2.send(sesCommand);
    return sesResponse;
  } catch (error) {
    console.error('SES.SendBulkEmailCommand: ', error);
    throw new Error(error.message);
  }
}

