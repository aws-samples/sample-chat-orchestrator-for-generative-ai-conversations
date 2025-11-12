// Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from "aws-cdk-lib";
import {Construct} from "constructs";

import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as apigw2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigw2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as apigw2Authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import {CfnStage} from "aws-cdk-lib/aws-apigatewayv2";
import * as logs from 'aws-cdk-lib/aws-logs'
import { NagSuppressions } from 'cdk-nag'

const configParams = require('../config.params.json');

export interface APIStackProps extends cdk.NestedStackProps {
    readonly SSMParams: any;
    readonly chatOrchestratorLambda: lambda.Function;
}

export class APIStack extends cdk.NestedStack {

    public readonly api: apigw2.IHttpApi;
    public readonly apiAccessPolicy: iam.Policy;
    public readonly messagingAPIUser: iam.User;

    constructor(scope: Construct, id: string, props: APIStackProps) {
        super(scope, id, props);

       const api = new apigw2.HttpApi(this, 'MessagingAPI', {
            defaultAuthorizer: new apigw2Authorizers.HttpIamAuthorizer(),
            corsPreflight: {
                allowOrigins: props.SSMParams.apiAllowedOrigins.split(',').map((item: string) => item.trim()),
                allowMethods: [apigw2.CorsHttpMethod.POST],
                allowHeaders: apigw.Cors.DEFAULT_HEADERS,
            },

        });

        // Enable throttling
        const defaultStage = api.defaultStage!.node.defaultChild as CfnStage;
        defaultStage.defaultRouteSettings = {
            throttlingBurstLimit: 10,
            throttlingRateLimit: 10,
        };

         // Setup the access log for APIGWv2
         const stage = api.defaultStage!.node.defaultChild as CfnStage;

         const logGroup = new logs.LogGroup(api, 'AccessLogs', {
             retention: 90, // Keep logs for 90 days
         });
 
         stage.accessLogSettings = {
             destinationArn: logGroup.logGroupArn,
             format: JSON.stringify({
                 requestId: '$context.requestId',
                 userAgent: '$context.identity.userAgent',
                 sourceIp: '$context.identity.sourceIp',
                 requestTime: '$context.requestTime',
                 httpMethod: '$context.httpMethod',
                 path: '$context.path',
                 status: '$context.status',
                 responseLength: '$context.responseLength',
               }),
         }
 
         logGroup.grantWrite(new iam.ServicePrincipal('apigateway.amazonaws.com'));

        api.addRoutes({
            integration: new apigw2Integrations.HttpLambdaIntegration('chatOrchestrator', props.chatOrchestratorLambda),
            path: '/sendMessages',
            methods: [apigw2.HttpMethod.POST],
        });

        this.api = api;

        const messagingAPIUser = new iam.User(this, 'messagingAPIUser', {
            userName: `${configParams.CdkAppName}-APIUser`
        });

        this.messagingAPIUser = messagingAPIUser;

        const apiAccessPolicy = new iam.Policy(this, 'messagingAPIAccessPolicy', {
            policyName: 'messagingAPIAccessPolicy',
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    'execute-api:Invoke'
                ],
                resources: [
                    `arn:aws:execute-api:${this.region}:${this.account}:${api.httpApiId}/*/POST/sendMessages`
                ]
              }),
            ],
          });

        this.apiAccessPolicy = apiAccessPolicy;
        apiAccessPolicy.attachToUser(messagingAPIUser);
    }
}
