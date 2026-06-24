// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {CfnOutput, Stack, StackProps, Duration, CustomResource, RemovalPolicy} from "aws-cdk-lib";
import {Construct} from "constructs";
import * as nodeLambda from "aws-cdk-lib/aws-lambda-nodejs";
import {Runtime} from "aws-cdk-lib/aws-lambda";
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from "aws-cdk-lib/aws-kms"
import * as logs from "aws-cdk-lib/aws-logs"
import { loadSSMParams } from '../lib/infrastructure/ssm-params-util';
import { NagSuppressions } from 'cdk-nag'
import path = require('path');
import { CfnGuardrail } from "aws-cdk-lib/aws-bedrock";

import { APIStack } from './api-stack';

const configParams = require('../config.params.json');

export class CdkBackendStack extends Stack {

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const ssmParams = loadSSMParams(this);

    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'This is the default Lambda Execution Policy which just grants writes to CloudWatch.'
      }
    ])

    //Log bucket
    const accessLogsBucket = new s3.Bucket(this, "accessLogsBucket", {
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      removalPolicy: RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL
    });

    NagSuppressions.addResourceSuppressions(accessLogsBucket, [
      {
        id: 'AwsSolutions-S1',
        reason: 'This is the Log Bucket.'
      },
    ])

    //Default Bedrock Guardrail
    const guardrail = new CfnGuardrail(this, 'Bedrock Guardrail', {
      blockedInputMessaging: 'Guardrail applied based on the input.',
      blockedOutputsMessaging: 'Guardrail applied based on output.',
      name: `${configParams.CdkAppName}-Guardrail`,
      contentPolicyConfig: {
        filtersConfig: [{
          inputStrength: 'HIGH',
          outputStrength: 'HIGH',
          type: 'SEXUAL'
        },
          {
            inputStrength: 'HIGH',
            outputStrength: 'HIGH',
            type: 'VIOLENCE'
          },
          {
            inputStrength: 'HIGH',
            outputStrength: 'HIGH',
            type: 'HATE'
          },
          {
            inputStrength: 'HIGH',
            outputStrength: 'HIGH',
            type: 'INSULTS'
          },
          {
            inputStrength: 'HIGH',
            outputStrength: 'HIGH',
            type: 'MISCONDUCT'
          },
          {
            inputStrength: 'NONE',
            outputStrength: 'NONE',
            type: 'PROMPT_ATTACK'
          }],
      },
      description: `${configParams.CdkAppName} Guardrail`,
      // sensitiveInformationPolicyConfig: {
      //   piiEntitiesConfig: [],
      //   regexesConfig: [],
      // },
      // topicPolicyConfig: {
      //   topicsConfig: [],
      // },
      wordPolicyConfig: {
        managedWordListsConfig: [
          {
            type: 'PROFANITY'
          }
        ],
      },
    });

    //Chat Context Table
    const contextTable = new dynamodb.Table(this, 'ChatContext', {
      partitionKey: { name: 'phoneNumber', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'messageId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.RETAIN
    });

    contextTable.addGlobalSecondaryIndex({
      indexName: 'PhoneIndex',
      partitionKey: {
        name: 'phoneNumber',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.NUMBER,
      },
      projectionType: dynamodb.ProjectionType.ALL
    });

    //UseCase Config Table
    const useCaseTable = new dynamodb.Table(this, 'UseCaseConfig', {
      partitionKey: { name: 'useCase', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN
    });

    //Custom Resource Lambda
    const configLambda = new nodeLambda.NodejsFunction(this, 'ConfigLambda', {
      runtime: Runtime.NODEJS_22_X,
      entry: path.join(__dirname, 'lambdas/handlers/node/customResource.mjs'),
      timeout: Duration.seconds(30),
      memorySize: 512,
      logFormat: 'JSON',
      applicationLogLevel: 'TRACE',
      initialPolicy:
        [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "sms-voice:UpdatePhoneNumber",
            ],
            resources: [
              `arn:aws:sms-voice:${this.region}:${this.account}:phone-number/*`
            ]
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "iam:PassRole",
            ],
            resources: [
              `arn:aws:iam::${this.account}:role/*`
            ]
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "dynamodb:PutItem",
            ],
            resources: [useCaseTable.tableArn]
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "social-messaging:PutWhatsAppBusinessAccountEventDestinations",
              "social-messaging:ListLinkedWhatsAppBusinessAccounts",
            ],
            resources: [
              `arn:aws:social-messaging:*:${this.account}:waba/*}`
            ]
          }), new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "social-messaging:ListLinkedWhatsAppBusinessAccounts",
          ],
          resources: [
            `*`
          ]
        }),
        ]
    });

    //Custom Log Group so we can add Metric Filters
    const logGroup = new logs.LogGroup(this, 'ChatProcessorLambdaLogGroup',{
      retention: logs.RetentionDays.THREE_MONTHS
    });

    //ChannelFinder Lambda
    const channelFinderLambda = new nodeLambda.NodejsFunction(this, 'channelFinderLambda', {
      runtime: Runtime.NODEJS_22_X,
      entry: path.join(__dirname, 'lambdas/handlers/node/channelFinder.mjs'),
      timeout: Duration.seconds(30),
      memorySize: 512,
      logFormat: 'JSON',
      applicationLogLevel: 'INFO',
      environment: {
        "APPLICATION_VERSION": `v${this.node.tryGetContext('application_version')} (${new Date().toISOString()})`,
      },
      initialPolicy: [
        //Update this to use the correct permissions
      ]
    })

    //Chat Orchestrator Lambda
    const chatOrchestratorLambda = new nodeLambda.NodejsFunction(this, 'chatOrchestratorLambda', {
      runtime: Runtime.NODEJS_22_X,
      entry: path.join(__dirname, 'lambdas/handlers/node/chatOrchestrator.mjs'),
      timeout: Duration.seconds(30),
      memorySize: 512,
      logFormat: 'JSON',
      applicationLogLevel: 'INFO',
      environment: {
        "APPLICATION_VERSION": `v${this.node.tryGetContext('application_version')} (${new Date().toISOString()})`,
        "CONTEXT_DYNAMODB_TABLE": contextTable.tableName,
        "USECASE_DYNAMODB_TABLE": useCaseTable.tableName,
        "PHONE_NUMBER_ID": ssmParams.originationNumberId,
        "SESSION_SECONDS": "86400",
        "LLM_MAX_TOKENS": "300",
        "LLM_TEMPERATURE": "0.3",
        "SMS_CONFIGURATION_SET": ssmParams.smsConfigurationSet == 'not-defined' ? undefined : ssmParams.smsConfigurationSet,
        "ACCOUNT_ID": `${this.account}`,
        "ORGANIZATION_ID": '', //Update this if you need more granularity in your Firehose Stream for things like brands or other organizational units
        "CONVERSATION_FIREHOSE_STREAM": ssmParams.conversationFirehoseStream == 'not-defined' ? undefined : ssmParams.conversationFirehoseStream,
        "PURCHASE_INTENT_ALERT_LAMBDA_NAME": ssmParams.purchaseIntentAlertLambdaName == 'not-defined' ? undefined : ssmParams.purchaseIntentAlertLambdaName,
        "CHANNEL_FINDER_LAMBDA_NAME": channelFinderLambda.functionName
      },
      initialPolicy: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['bedrock:ApplyGuardrail'],
          resources: [guardrail.attrGuardrailArn],
        }),
      ]
    });

    //Policy for Lambda
    chatOrchestratorLambda.role?.attachInlinePolicy(new iam.Policy(this, 'chatOrchestratorPolicy', {
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "dynamodb:GetItem",
            "dynamodb:Query",
            "dynamodb:Scan",
            "dynamodb:PutItem",
            "dynamodb:BatchWriteItem",
            "dynamodb:DeleteItem"
          ],
          resources: [
            contextTable.tableArn,
            `${contextTable.tableArn}/*`,
            useCaseTable.tableArn,
            `${useCaseTable.tableArn}/*`
          ]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "firehose:PutRecord",
            "firehose:PutRecordBatch"
          ],
          resources: [`arn:aws:firehose:${this.region}:${this.account}:deliverystream/${ssmParams.conversationFirehoseStream}`]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "lambda:InvokeFunction"
          ],
          resources: [
            `arn:aws:lambda:${this.region}:${this.account}:function:${chatOrchestratorLambda.functionName}`,
          ]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [`arn:aws:lambda:${this.region}:${this.account}:function:${channelFinderLambda.functionName}`]
        }),
        ...(ssmParams.purchaseIntentAlertLambdaName == 'not-defined' ? [] : [new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [`arn:aws:lambda:${this.region}:${this.account}:function:${ssmParams.purchaseIntentAlertLambdaName}`]
        })]),
      ]
    }));

    const aws_sns_kms = kms.Alias.fromAliasName(
      this,
      "aws-managed-sns-kms-key",
      "alias/aws/sns",
    )

    let targetChannels = [];

    //SMS Configuration
    if (ssmParams.smsEnabled) {
      let chatTopic: sns.ITopic;
      //SNS Topic for 2-way SMS
      if (ssmParams.smsSNSTopicArn == 'not-defined') {
        chatTopic = new sns.Topic(this,'notification', {
          displayName: `${configParams.CdkAppName}-NotificationTopic`,
          masterKey: aws_sns_kms
        })
      } else {
        chatTopic = sns.Topic.fromTopicArn(this, 'smsTopic', ssmParams.smsSNSTopicArn)
      }

      const snsRole = new iam.Role(this, 'snsRole', {
        assumedBy: new iam.ServicePrincipal('sms-voice.amazonaws.com')
      });

      snsRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "sns:Publish",
          ],
          resources: [
            chatTopic.topicArn
          ]
        })
      )

      //SMS Trigger Lambda
      const smsTriggerLambda = new nodeLambda.NodejsFunction(this, 'smsTriggerLambda', {
        runtime: Runtime.NODEJS_22_X,
        entry: path.join(__dirname, 'lambdas/handlers/node/triggers/smsTrigger.mjs'),
        timeout: Duration.seconds(30),
        memorySize: 512,
        logFormat: 'JSON',
        applicationLogLevel: 'INFO',
        environment: {
          "APPLICATION_VERSION": `v${this.node.tryGetContext('application_version')} (${new Date().toISOString()})`,
          "CHAT_ORCHESTRATOR_LAMBDA_NAME": chatOrchestratorLambda.functionName
        },
        initialPolicy: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['lambda:InvokeFunction'],
            resources: [
              `arn:aws:lambda:${this.region}:${this.account}:function:${chatOrchestratorLambda.functionName}`,
            ]
          })
        ]
      });

      // subscribe an Lambda to SMS SNS topic
      chatTopic.addSubscription(new subscriptions.LambdaSubscription(smsTriggerLambda));

      //SMS Processor Lambda
      const smsProcessorLambda = new nodeLambda.NodejsFunction(this, 'smsProcessorLambda', {
        runtime: Runtime.NODEJS_22_X,
        entry: path.join(__dirname, 'lambdas/handlers/node/outbound-processors/smsProcessor.mjs'),
        timeout: Duration.seconds(30),
        memorySize: 512,
        logFormat: 'JSON',
        applicationLogLevel: 'INFO',
        environment: {
          "APPLICATION_VERSION": `v${this.node.tryGetContext('application_version')} (${new Date().toISOString()})`,
          "ORIGINATION_NUMBER_ID": ssmParams.smsOriginationNumberId,
          "DEFAULT_CONFIGURATION_SET": ssmParams.smsConfigurationSet == 'not-defined' ? undefined : ssmParams.smsConfigurationSet,
        },
        initialPolicy: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "sms-voice:SendTextMessage",
              "sms-voice:SendMediaMessage"
            ],
            resources: [
              `arn:aws:sms-voice:${this.region}:${this.account}:phone-number/${ssmParams.smsOriginationNumberId}`
            ]
          }),
        ]
      })

      chatOrchestratorLambda.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "lambda:InvokeFunction"
          ],
          resources: [
            `arn:aws:lambda:${this.region}:${this.account}:function:${smsProcessorLambda.functionName}`,
          ]
        }),
      );

      const smsConfigCustomResource = new CustomResource(this, `${configParams.CdkAppName}-SMSConfigCustomResource`, {
        resourceType: 'Custom::EUMConfig',
        serviceToken: configLambda.functionArn,
        serviceTimeout: Duration.seconds(30),
        properties: {
          SMSOriginationNumberId: ssmParams.smsOriginationNumberId,
          ChatSNSTopicARN: chatTopic.topicArn,
          SNSRoleARN: snsRole.roleArn,
          Random: Date.now().toString()
        }
      });

      targetChannels.push({
        channel: 'sms',
        processorLambdaName: smsProcessorLambda.functionName,
        phoneNumberId: ssmParams.smsOriginationNumberId,
        configurationSet: ssmParams.smsConfigurationSet == 'not-defined' ? undefined : ssmParams.smsConfigurationSet,
        enabled: true,
      })
    }

    //WhatsApp Configuration
    if (ssmParams.whatsappEnabled) {
      let whatsappTopic: sns.ITopic;
      if (ssmParams.whatsappSNSTopicArn == 'not-defined') { //Create a new SNS topic for WhatsApp if it doesn't exist

        whatsappTopic = new sns.Topic(this,'whatsappTopic', {
          displayName: `${configParams.CdkAppName}-WhatsAppTopic`,
        })

        whatsappTopic.addToResourcePolicy(
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['sns:Publish'],
            principals: [new iam.ServicePrincipal('social-messaging.amazonaws.com')],
            resources: [whatsappTopic.topicArn]
          })
        )

        //Update WhatsApp Origination Number to use the new SNS Topic
        const whatsappSNSRole = new iam.Role(this, 'whatsappSNSRole', {
          assumedBy: new iam.ServicePrincipal('social-messaging.amazonaws.com')
        });

        whatsappSNSRole.addToPolicy(
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['sns:Publish'],
            resources: [whatsappTopic.topicArn]
          })
        )

        const setWhatsAppEventDestinationCustomResource = new CustomResource(this, `${configParams.CdkAppName}-SetWhatsAppEventDestinationCustomResource`, {
          resourceType: 'Custom::SetWhatsAppEventDestination',
          serviceToken: configLambda.functionArn,
          serviceTimeout: Duration.seconds(30),
          properties: {
            WhatsAppBusinessAccountId: ssmParams.whatsAppBusinessAccountId,
            SNSTopicARN: whatsappTopic.topicArn,
            SNSRoleARN: whatsappSNSRole.roleArn,
            Random: Date.now().toString()
          }
        });

      } else {
        whatsappTopic = sns.Topic.fromTopicArn(this, 'whatsappTopic', ssmParams.whatsappSNSTopicArn)
      }

      //WhatsApp Trigger Lambda
      const whatsappTriggerLambda = new nodeLambda.NodejsFunction(this, 'whatsappTriggerLambda', {
        runtime: Runtime.NODEJS_22_X,
        entry: path.join(__dirname, 'lambdas/handlers/node/triggers/whatsappTrigger.mjs'),
        timeout: Duration.seconds(30),
        memorySize: 512,
        logFormat: 'JSON',
        applicationLogLevel: 'INFO',
        environment: {
          "APPLICATION_VERSION": `v${this.node.tryGetContext('application_version')} (${new Date().toISOString()})`,
          "CHAT_ORCHESTRATOR_LAMBDA_NAME": chatOrchestratorLambda.functionName
        },
        initialPolicy: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['lambda:InvokeFunction'],
            resources: [
              `arn:aws:lambda:${this.region}:${this.account}:function:${chatOrchestratorLambda.functionName}`,
            ]
          })
        ]
      });

      whatsappTopic.addSubscription(new subscriptions.LambdaSubscription(whatsappTriggerLambda))

      //WhatsApp Processor Lambda
      const whatsappProcessorLambda = new nodeLambda.NodejsFunction(this, 'whatsappProcessorLambda', {
        runtime: Runtime.NODEJS_22_X,
        entry: path.join(__dirname, 'lambdas/handlers/node/outbound-processors/whatsappProcessor.mjs'),
        timeout: Duration.seconds(30),
        memorySize: 512,
        logFormat: 'JSON',
        applicationLogLevel: 'INFO',
        environment: {
          "APPLICATION_VERSION": `v${this.node.tryGetContext('application_version')} (${new Date().toISOString()})`,
          "WHATSAPP_PHONE_NUMBER_ID": ssmParams.whatsappOriginationNumberId,
        },
        initialPolicy: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "social-messaging:DeleteWhatsAppMessageMedia",
              "social-messaging:SendWhatsAppMessage",
              "social-messaging:PostWhatsAppMessageMedia",
              "social-messaging:GetWhatsAppMessageMedia"
            ],
            resources: [`arn:aws:social-messaging:${this.region}:${this.account}:phone-number-id/${ssmParams.whatsappOriginationNumberId.replace('phone-number-id-', '')}`]
          }),
        ]
      })

      chatOrchestratorLambda.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [`arn:aws:lambda:${this.region}:${this.account}:function:${whatsappProcessorLambda.functionName}`]
        }),
      );

      targetChannels.push({
        channel: 'whatsapp',
        processorLambdaName: whatsappProcessorLambda.functionName,
        phoneNumberId: ssmParams.whatsappOriginationNumberId,
        enabled: true,
        imageEnabled: false,
      })
    }

    //Email Configuration
    if (ssmParams.emailEnabled) {
      const emailProcessorLambda = new nodeLambda.NodejsFunction(this, 'emailProcessorLambda', {
        runtime: Runtime.NODEJS_22_X,
        entry: path.join(__dirname, 'lambdas/handlers/node/outbound-processors/emailProcessor.mjs'),
        timeout: Duration.seconds(30),
        memorySize: 512,
        logFormat: 'JSON',
        applicationLogLevel: 'INFO',
        environment: {
          "APPLICATION_VERSION": `v${this.node.tryGetContext('application_version')} (${new Date().toISOString()})`,
        },
        initialPolicy: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "ses:SendEmail",
              "ses:SendBulkEmail"
            ],
            resources: [`*`]
          }),
        ]
      })

      //Add Lambda to Chat Orchestrator Role
      chatOrchestratorLambda.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [`arn:aws:lambda:${this.region}:${this.account}:function:${emailProcessorLambda.functionName}`]
        }),
      );

      targetChannels.push({
        channel: 'email',
        processorLambdaName: emailProcessorLambda.functionName,
        enabled: true,
      })

      NagSuppressions.addResourceSuppressionsByPath(this, '/MultiChannelGenAI2/emailProcessorLambda/Resource', [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'The function needs to call the SendEmail and SendBulkEmail APIs.  We would like customers to be able to send emails from any address configured in SES.'
        },
      ])
    }


    //Knowledge Base Configuration
    if (ssmParams.useBedrockKnowledgeBase) {
      const knowledgeBaseProcessorLambda = new nodeLambda.NodejsFunction(this, 'kbResponseProcessorLambda', {
        runtime: Runtime.NODEJS_22_X,
        entry: path.join(__dirname, 'lambdas/handlers/node/response-generators/kbResponseGenerator.mjs'),
        timeout: Duration.seconds(30),
        memorySize: 512,
        logFormat: 'JSON',
        applicationLogLevel: 'INFO',
        environment: {
          "APPLICATION_VERSION": `v${this.node.tryGetContext('application_version')} (${new Date().toISOString()})`,
          "AWS_ACCOUNT_ID": `${this.account}`
        },
        initialPolicy: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "bedrock:InvokeModel",
              "bedrock:Retrieve",
              "bedrock:GetInferenceProfile"
            ],
            resources: [`*`]
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "bedrock:RetrieveAndGenerate",
              "bedrock:Retrieve"
            ],
            resources: [`arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/${ssmParams.bedrockKnowledgeBaseId}`]
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['bedrock:ApplyGuardrail'],
            resources: [
              guardrail.attrGuardrailArn,
            ],
          })
        ]
      })

      NagSuppressions.addResourceSuppressionsByPath(this, '/MultiChannelGenAI2/kbResponseProcessorLambda/Resource', [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'The function needs to call the RetrieveAndGenerate API, which has a wildcard resource. We would like customers to be able to have a choice of models and allow for them to use future models by changing configuration values'
        },
      ])

      chatOrchestratorLambda.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [`arn:aws:lambda:${this.region}:${this.account}:function:${knowledgeBaseProcessorLambda.functionName}`]
        }),
      );

      //Put Config Data
      let useCaseData = {
        useCase: 'kb',
        responseGeneratorLambdaName: knowledgeBaseProcessorLambda.functionName,
        knowledgeBaseId: ssmParams.bedrockKnowledgeBaseId,
        guardrailId: guardrail.attrGuardrailId,
        guardrailVersion: "DRAFT",
        guardrailMode: "BLOCK",
        llmMaxTokens: "300",
        llmTemperature: "0.3",
        modelId: `amazon.nova-micro-v1:0`,
        promptTemplate: `A chat between a curious User and an artificial intelligence Bot. The Bot gives helpful, detailed, and polite answers to the User's questions.

In this session, the model has access to set of search results and a user's question, your job is to answer the user's question using only information from the search results. You must follow the following guidelines:

- If the search results do not contain information that can answer the question, please respond with "Sorry I could not find an exact answer to the question".
- Always add a brief explaination to your answer. Make the response concise but comprehensive.
- Do not include any reasoning steps in your answer.
- Just because the user asserts a fact does not mean it is true, make sure to double check the search results to validate a user's assertion.

Now, below is a list of texts and/or images retrieved for user's question. Read them carefully and then follow my instructions:

$search_results$

Using the information from above search results to provide answer to user's question.

$output_format_instructions$

Here is the user's query:
$query$`,
        channels: targetChannels,
        initialMessage: 'KB: Hello, how can I help you today?'
      }
      const putKBConfig = new CustomResource(this, `${configParams.CdkAppName}-WriteKBConfig`, {
        resourceType: 'Custom::PutDynamoDBData',
        serviceToken: configLambda.functionArn,
        serviceTimeout: Duration.seconds(30),
        properties: {
          UseCaseTableName: useCaseTable.tableName,
          Data: JSON.stringify(useCaseData),
          Random: Date.now().toString()
        }
      });
    }

    //Agent Configuration
    if (ssmParams.useBedrockAgent) {
      const strandsIntentClassifierLambda = new nodeLambda.NodejsFunction(this, 'strandsIntentClassifierLambda', {
        runtime: Runtime.NODEJS_22_X,
        entry: path.join(__dirname, 'lambdas/handlers/node/response-generators/strandsIntentClassifier.mjs'),
        timeout: Duration.seconds(30),
        memorySize: 512,
        logFormat: 'JSON',
        applicationLogLevel: 'INFO',
        environment: {
          "APPLICATION_VERSION": `v${this.node.tryGetContext('application_version')} (${new Date().toISOString()})`,
          "STRANDS_CLASSIFIER_MODEL_ID": `amazon.nova-lite-v1:0`,
          "STRANDS_CLASSIFIER_MAX_TOKENS": "700",
          "STRANDS_CLASSIFIER_TEMPERATURE": "0"
        },
        initialPolicy: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "bedrock:InvokeModel",
              "bedrock:InvokeModelWithResponseStream",
              "bedrock:GetInferenceProfile"
            ],
            resources: [`*`]
          })
        ]
      })

      chatOrchestratorLambda.addEnvironment(
        "STRANDS_INTENT_CLASSIFIER_LAMBDA_NAME",
        strandsIntentClassifierLambda.functionName
      )

      chatOrchestratorLambda.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [`arn:aws:lambda:${this.region}:${this.account}:function:${strandsIntentClassifierLambda.functionName}`]
        }),
      );

      NagSuppressions.addResourceSuppressionsByPath(this, '/MultiChannelGenAI2/strandsIntentClassifierLambda/Resource', [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'The classifier can use the configured Bedrock model, including inference profiles and future model swaps during the shadow-mode POC.'
        },
      ])

      const agentResponseGeneratorLambda = new nodeLambda.NodejsFunction(this, 'agentResponseGeneratorLambda', {
        runtime: Runtime.NODEJS_22_X,
        entry: path.join(__dirname, 'lambdas/handlers/node/response-generators/agentResponseGenerator.mjs'),
        timeout: Duration.seconds(30),
        memorySize: 512,
        logFormat: 'JSON',
        applicationLogLevel: 'INFO',
        environment: {
          "APPLICATION_VERSION": `v${this.node.tryGetContext('application_version')} (${new Date().toISOString()})`,
          "AGENT_PRELOAD_MESSAGE": "Another system has sent an outbound message to a user and the user may have some follow up questions.  Here is the message that was sent so you have context of previous messages if the user asks about them:\n\n",
          "WHATSAPP_PHONE_NUMBER_ID": ssmParams.whatsappOriginationNumberId,
          "MIIRACELL_PRODUCT_IMAGE_URLS": ssmParams.miiracellProductImageUrls == 'not-defined' ? undefined : ssmParams.miiracellProductImageUrls,
          "MIIRACELL_TREATMENT_IMAGE_URL": ssmParams.miiracellTreatmentImageUrl == 'not-defined' ? undefined : ssmParams.miiracellTreatmentImageUrl,
          "MIIRACELL_TESTIMONIAL_VIDEO_URLS": ssmParams.miiracellTestimonialVideoUrls == 'not-defined' ? undefined : ssmParams.miiracellTestimonialVideoUrls,
          "MIIRACELL_POSOLOGY_VIDEO_URLS": ssmParams.miiracellPosologyVideoUrls == 'not-defined' ? undefined : ssmParams.miiracellPosologyVideoUrls,
          "MIIRACELL_AUDIO_URLS": ssmParams.miiracellAudioUrls == 'not-defined' ? undefined : ssmParams.miiracellAudioUrls,
          "MIIRACELL_PRESENTATION_DOCUMENT_URLS": ssmParams.miiracellPresentationDocumentUrls == 'not-defined' ? undefined : ssmParams.miiracellPresentationDocumentUrls,
          "MIIRACELL_INGREDIENT_KNOWLEDGE_BASE_ID": ssmParams.bedrockKnowledgeBaseId == 'not-defined' ? undefined : ssmParams.bedrockKnowledgeBaseId,
          "MIIRACELL_INGREDIENT_KB_MODEL_ID": `amazon.nova-lite-v1:0`,
          "MIIRACELL_INGREDIENT_SOURCE_FILENAME_TOKEN": "REVOOBIT",
          "AWS_ACCOUNT_ID": `${this.account}`
        },
        initialPolicy: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['bedrock:ApplyGuardrail'],
            resources: [
              guardrail.attrGuardrailArn,
            ],
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "bedrock:InvokeAgent"
            ],
            resources: [`arn:aws:bedrock:${this.region}:${this.account}:agent-alias/${ssmParams.bedrockAgentId}/${ssmParams.bedrockAgentAliasId}`]
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "bedrock:InvokeModel",
              "bedrock:Retrieve",
              "bedrock:RetrieveAndGenerate",
              "bedrock:GetInferenceProfile"
            ],
            resources: [`*`]
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "social-messaging:SendWhatsAppMessage"
            ],
            resources: [`arn:aws:social-messaging:${this.region}:${this.account}:phone-number-id/${ssmParams.whatsappOriginationNumberId.replace('phone-number-id-', '')}`]
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "firehose:PutRecord",
              "firehose:PutRecordBatch"
            ],
            resources: [`arn:aws:firehose:${this.region}:${this.account}:deliverystream/${ssmParams.conversationFirehoseStream}`]
          })
        ]
      })

      chatOrchestratorLambda.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [`arn:aws:lambda:${this.region}:${this.account}:function:${agentResponseGeneratorLambda.functionName}`]
        }),
      );

      //Put Config Data
      let useCaseData = {
        useCase: 'agent',
        agentId: ssmParams.bedrockAgentId,
        agentAliasId: ssmParams.bedrockAgentAliasId,
        knowledgeBaseId: ssmParams.bedrockKnowledgeBaseId == 'not-defined' ? undefined : ssmParams.bedrockKnowledgeBaseId,
        llmMaxTokens: "300",
        llmTemperature: "0",
        modelId: `amazon.nova-lite-v1:0`,
        responseGeneratorLambdaName: agentResponseGeneratorLambda.functionName,
        channels: targetChannels,
        initialMessage: 'Salut, souhaitez-vous commander le complément alimentaire Miira-Cell+ ?'
      }
      const putAgentConfig = new CustomResource(this, `${configParams.CdkAppName}-PutAgentConfig`, {
        resourceType: 'Custom::PutDynamoDBData',
        serviceToken: configLambda.functionArn,
        serviceTimeout: Duration.seconds(30),
        properties: {
          UseCaseTableName: useCaseTable.tableName,
          Data: JSON.stringify(useCaseData),
          Random: Date.now().toString()
        }
      });
    }

    NagSuppressions.addResourceSuppressionsByPath(this, '/MultiChannelGenAI2/chatOrchestratorPolicy/Resource', [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'The function needs to call the RetrieveAndGenerate API, which has a wildcard resource. There is no way to scope this down based on: https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonbedrock.html#amazonbedrock-RetrieveAndGenerate'
      },
    ])

    //Deploy Optional API Stack
    if (ssmParams.deployAPIStack) {
      const apiStack = new APIStack(this, 'APIStack', {
        SSMParams: ssmParams,
        chatOrchestratorLambda: chatOrchestratorLambda
      });
      //Put API Config Data
      let apiConfigData = {
        useCase: 'api',
        channels: targetChannels,
      }
      const putAPIConfig = new CustomResource(this, `${configParams.CdkAppName}-PutAPIConfig`, {
        resourceType: 'Custom::PutDynamoDBData',
        serviceToken: configLambda.functionArn,
        serviceTimeout: Duration.seconds(30),
        properties: {
          UseCaseTableName: useCaseTable.tableName,
          Data: JSON.stringify(apiConfigData),
          Random: Date.now().toString()
        }
      });

      new CfnOutput(this, "APIEndpointURL", {
        value: apiStack.api.apiEndpoint
      });

      new CfnOutput(this, "APIAccessPolicyName", {
        value: apiStack.apiAccessPolicy.policyName
      });

      new CfnOutput(this, "APIIAMUserName", {
        value: apiStack.messagingAPIUser.userName
      });
    }

    /**************************************************************************************************************
     * CDK Outputs *
     **************************************************************************************************************/

    new CfnOutput(this, "chatOrchestratorLambdaName", {
      value: chatOrchestratorLambda.functionName
    });

    new CfnOutput(this, "chatOrchestratorLambdaARN", {
      value: chatOrchestratorLambda.functionArn
    });

    new CfnOutput(this, "GuardrailArn", {
      value: guardrail.attrGuardrailArn,
    });

    new CfnOutput(this, "ChannelFinderLambdaName", {
      value: channelFinderLambda.functionName
    });

    new CfnOutput(this, "ChannelFinderLambdaARN", {
      value: channelFinderLambda.functionArn
    });

    new CfnOutput(this, "UseCaseTable", {
      value: useCaseTable.tableName
    });

  }
}
