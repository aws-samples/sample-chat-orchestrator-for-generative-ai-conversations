// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const { DynamoDBClient, QueryCommand, BatchWriteItemCommand } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocument, paginateScan, DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");
const dynamoDBClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const ddbDocClient = DynamoDBDocument.from(dynamoDBClient,{
  marshallOptions: {
    removeUndefinedValues: true
  }
});

export async function scan (tableName) {
  const config = {
    client: ddbDocClient,
    pageSize: 100
  };
  const input = {
    TableName: tableName
  };

  try {
    const paginator = paginateScan(config, input);
    var Items = []
    for await (const page of paginator) {
        Items.push(...page.Items)
    }
    return {Items}
  } catch (error) {
      console.error('DynamoDb.scan: ', error);
      throw new Error(error.message);
  }
}

export async function get (tableName, key) {
	const params = {
    TableName : tableName,
    Key: key
	}

  try {
    const results = await ddbDocClient.get(params);
    return results
  } catch (error) {
      console.error('DynamoDb.get: ', error);
      throw new Error(error.message);
  }
}

export async function put (tableName, item) {
  const params = {
    TableName : tableName,
    Item: item
  }

  try {
    const results = await ddbDocClient.put(params);
    return results
  } catch (error) {
    console.error('DynamoDb.put: ', error);
    throw new Error(error.message);
  }
}

export async function batchWrite (tableName, batch, startingIndex) {
  try {
    let result = await _batchWrite(tableName, batch, startingIndex)
    if (batch.length > result.index) {
        let nextData = await batchWrite(tableName, batch, result.index)
        return nextData;
    } else {
        return result.data;
    }
  } catch (error) {
    console.error('DynamoDb.batchWrite: ', error);
    throw new Error(error.message);
  }
}

async function _batchWrite (tableName, batch, startingIndex) {
    // DDB has a limit of 25 items at once
    let maxDdbUpdate = 24;
    let endIndex = (batch.length > startingIndex + maxDdbUpdate) ? startingIndex + maxDdbUpdate : batch.length;
    let batchToUpdate = batch.slice(startingIndex, endIndex);

    let batchParam = {
        RequestItems: {
          [tableName]: batchToUpdate
        }
    };
    ddbDocClient.batchWrite(batchParam, (error, data) => {
        if (error) {
            console.log("Any error? " + JSON.stringify(error, null, 2));
            throw new Error(error.message);
        }
        return {'index': startingIndex + maxDdbUpdate, 'data': data};
    });
}

export async function query (queryParams) {
  try {
      const results = await ddbDocClient.query(queryParams); 
      console.log(results)
      return results.Items
  } catch (error) {
      console.error('DynamoDb.query: ', error);
      throw new Error(error.message);
  }
}

export async function del (tableName, key) {
	const params = {
    TableName : tableName,
    Key: key
	}

  try {
    const results = await ddbDocClient.delete(params);
    return results
  } catch (error) {
      console.error('DynamoDb.delete: ', error);
      throw new Error(error.message);
  }
} 

export async function deleteItemsByPartitionKey(tableName, partitionKeyName, partitionKeyValue) {

  try {
    // Retrieve all items with the given partition key
    let lastEvaluatedKey;
    const allItems = [];

    do {
      const params = {
        TableName: tableName,
        KeyConditionExpression: `${partitionKeyName} = :partitionKeyValue`,
        ExpressionAttributeValues: {
          ":partitionKeyValue": { [typeof partitionKeyValue === "string" ? "S" : "N"]: partitionKeyValue },
        },
        Limit: 100, // Adjust the limit as needed
        ExclusiveStartKey: lastEvaluatedKey,
      };
      console.log(params)

      const { Items, LastEvaluatedKey } = await dynamoDBClient.send(new QueryCommand(params));
      allItems.push(...Items);
      lastEvaluatedKey = LastEvaluatedKey;
    } while (lastEvaluatedKey);

    // Delete the retrieved items in batches
    const deletePromises = [];
    const batchSize = 25; // Adjust the batch size as needed

    for (let i = 0; i < allItems.length; i += batchSize) {
      const batch = allItems.slice(i, i + batchSize).map((item) => ({
        DeleteRequest: {
          Key: {
            phoneNumber: item.phoneNumber,
            messageId: item.messageId
          },
        },
      }));

      const deleteParams = {
        RequestItems: {
          [tableName]: batch,
        },
      };

      console.log(deleteParams)

      deletePromises.push(dynamoDBClient.send(new BatchWriteItemCommand(deleteParams)));
    }

    await Promise.all(deletePromises);
    console.log(`Deleted all items with ${partitionKeyName} = ${partitionKeyValue} from the ${tableName} table.`);
    return true;
  } catch (error) {
    console.error("Error deleting items:", error);
    throw new Error(error.message);
  }
}
