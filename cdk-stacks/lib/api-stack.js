"use strict";
// Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
Object.defineProperty(exports, "__esModule", { value: true });
exports.APIStack = void 0;
const cdk = require("aws-cdk-lib");
const iam = require("aws-cdk-lib/aws-iam");
const apigw = require("aws-cdk-lib/aws-apigateway");
const apigw2 = require("aws-cdk-lib/aws-apigatewayv2");
const apigw2Integrations = require("aws-cdk-lib/aws-apigatewayv2-integrations");
const apigw2Authorizers = require("aws-cdk-lib/aws-apigatewayv2-authorizers");
const logs = require("aws-cdk-lib/aws-logs");
const configParams = require('../config.params.json');
class APIStack extends cdk.NestedStack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const api = new apigw2.HttpApi(this, 'MessagingAPI', {
            defaultAuthorizer: new apigw2Authorizers.HttpIamAuthorizer(),
            corsPreflight: {
                allowOrigins: props.SSMParams.apiAllowedOrigins.split(',').map((item) => item.trim()),
                allowMethods: [apigw2.CorsHttpMethod.POST],
                allowHeaders: apigw.Cors.DEFAULT_HEADERS,
            },
        });
        // Enable throttling
        const defaultStage = api.defaultStage.node.defaultChild;
        defaultStage.defaultRouteSettings = {
            throttlingBurstLimit: 10,
            throttlingRateLimit: 10,
        };
        // Setup the access log for APIGWv2
        const stage = api.defaultStage.node.defaultChild;
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
        };
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
exports.APIStack = APIStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXBpLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQSwwRUFBMEU7QUFDMUUsaUNBQWlDOzs7QUFFakMsbUNBQW1DO0FBSW5DLDJDQUEyQztBQUMzQyxvREFBb0Q7QUFDcEQsdURBQXVEO0FBQ3ZELGdGQUFnRjtBQUNoRiw4RUFBOEU7QUFFOUUsNkNBQTRDO0FBRzVDLE1BQU0sWUFBWSxHQUFHLE9BQU8sQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDO0FBT3RELE1BQWEsUUFBUyxTQUFRLEdBQUcsQ0FBQyxXQUFXO0lBTXpDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBb0I7UUFDMUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFekIsTUFBTSxHQUFHLEdBQUcsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7WUFDaEQsaUJBQWlCLEVBQUUsSUFBSSxpQkFBaUIsQ0FBQyxpQkFBaUIsRUFBRTtZQUM1RCxhQUFhLEVBQUU7Z0JBQ1gsWUFBWSxFQUFFLEtBQUssQ0FBQyxTQUFTLENBQUMsaUJBQWlCLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQVksRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO2dCQUM3RixZQUFZLEVBQUUsQ0FBQyxNQUFNLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQztnQkFDMUMsWUFBWSxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsZUFBZTthQUMzQztTQUVKLENBQUMsQ0FBQztRQUVILG9CQUFvQjtRQUNwQixNQUFNLFlBQVksR0FBRyxHQUFHLENBQUMsWUFBYSxDQUFDLElBQUksQ0FBQyxZQUF3QixDQUFDO1FBQ3JFLFlBQVksQ0FBQyxvQkFBb0IsR0FBRztZQUNoQyxvQkFBb0IsRUFBRSxFQUFFO1lBQ3hCLG1CQUFtQixFQUFFLEVBQUU7U0FDMUIsQ0FBQztRQUVELG1DQUFtQztRQUNuQyxNQUFNLEtBQUssR0FBRyxHQUFHLENBQUMsWUFBYSxDQUFDLElBQUksQ0FBQyxZQUF3QixDQUFDO1FBRTlELE1BQU0sUUFBUSxHQUFHLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLEVBQUUsWUFBWSxFQUFFO1lBQ2xELFNBQVMsRUFBRSxFQUFFLEVBQUUsd0JBQXdCO1NBQzFDLENBQUMsQ0FBQztRQUVILEtBQUssQ0FBQyxpQkFBaUIsR0FBRztZQUN0QixjQUFjLEVBQUUsUUFBUSxDQUFDLFdBQVc7WUFDcEMsTUFBTSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ25CLFNBQVMsRUFBRSxvQkFBb0I7Z0JBQy9CLFNBQVMsRUFBRSw2QkFBNkI7Z0JBQ3hDLFFBQVEsRUFBRSw0QkFBNEI7Z0JBQ3RDLFdBQVcsRUFBRSxzQkFBc0I7Z0JBQ25DLFVBQVUsRUFBRSxxQkFBcUI7Z0JBQ2pDLElBQUksRUFBRSxlQUFlO2dCQUNyQixNQUFNLEVBQUUsaUJBQWlCO2dCQUN6QixjQUFjLEVBQUUseUJBQXlCO2FBQzFDLENBQUM7U0FDUCxDQUFBO1FBRUQsUUFBUSxDQUFDLFVBQVUsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQywwQkFBMEIsQ0FBQyxDQUFDLENBQUM7UUFFM0UsR0FBRyxDQUFDLFNBQVMsQ0FBQztZQUNWLFdBQVcsRUFBRSxJQUFJLGtCQUFrQixDQUFDLHFCQUFxQixDQUFDLGtCQUFrQixFQUFFLEtBQUssQ0FBQyxzQkFBc0IsQ0FBQztZQUMzRyxJQUFJLEVBQUUsZUFBZTtZQUNyQixPQUFPLEVBQUUsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQztTQUNwQyxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQztRQUVmLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUM1RCxRQUFRLEVBQUUsR0FBRyxZQUFZLENBQUMsVUFBVSxVQUFVO1NBQ2pELENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxnQkFBZ0IsQ0FBQztRQUV6QyxNQUFNLGVBQWUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLDBCQUEwQixFQUFFO1lBQ3JFLFVBQVUsRUFBRSwwQkFBMEI7WUFDdEMsVUFBVSxFQUFFO2dCQUNWLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztvQkFDdEIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztvQkFDeEIsT0FBTyxFQUFFO3dCQUNMLG9CQUFvQjtxQkFDdkI7b0JBQ0QsU0FBUyxFQUFFO3dCQUNQLHVCQUF1QixJQUFJLENBQUMsTUFBTSxJQUFJLElBQUksQ0FBQyxPQUFPLElBQUksR0FBRyxDQUFDLFNBQVMsc0JBQXNCO3FCQUM1RjtpQkFDRixDQUFDO2FBQ0g7U0FDRixDQUFDLENBQUM7UUFFTCxJQUFJLENBQUMsZUFBZSxHQUFHLGVBQWUsQ0FBQztRQUN2QyxlQUFlLENBQUMsWUFBWSxDQUFDLGdCQUFnQixDQUFDLENBQUM7SUFDbkQsQ0FBQztDQUNKO0FBakZELDRCQWlGQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIENvcHlyaWdodCAyMDIxIEFtYXpvbi5jb20sIEluYy4gb3IgaXRzIGFmZmlsaWF0ZXMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4vLyBTUERYLUxpY2Vuc2UtSWRlbnRpZmllcjogTUlULTBcblxuaW1wb3J0ICogYXMgY2RrIGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHtDb25zdHJ1Y3R9IGZyb20gXCJjb25zdHJ1Y3RzXCI7XG5cbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJ1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgYXBpZ3cgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xuaW1wb3J0ICogYXMgYXBpZ3cyIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheXYyXCI7XG5pbXBvcnQgKiBhcyBhcGlndzJJbnRlZ3JhdGlvbnMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5djItaW50ZWdyYXRpb25zXCI7XG5pbXBvcnQgKiBhcyBhcGlndzJBdXRob3JpemVycyBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXl2Mi1hdXRob3JpemVyc1wiO1xuaW1wb3J0IHtDZm5TdGFnZX0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5djJcIjtcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnXG5pbXBvcnQgeyBOYWdTdXBwcmVzc2lvbnMgfSBmcm9tICdjZGstbmFnJ1xuXG5jb25zdCBjb25maWdQYXJhbXMgPSByZXF1aXJlKCcuLi9jb25maWcucGFyYW1zLmpzb24nKTtcblxuZXhwb3J0IGludGVyZmFjZSBBUElTdGFja1Byb3BzIGV4dGVuZHMgY2RrLk5lc3RlZFN0YWNrUHJvcHMge1xuICAgIHJlYWRvbmx5IFNTTVBhcmFtczogYW55O1xuICAgIHJlYWRvbmx5IGNoYXRPcmNoZXN0cmF0b3JMYW1iZGE6IGxhbWJkYS5GdW5jdGlvbjtcbn1cblxuZXhwb3J0IGNsYXNzIEFQSVN0YWNrIGV4dGVuZHMgY2RrLk5lc3RlZFN0YWNrIHtcblxuICAgIHB1YmxpYyByZWFkb25seSBhcGk6IGFwaWd3Mi5JSHR0cEFwaTtcbiAgICBwdWJsaWMgcmVhZG9ubHkgYXBpQWNjZXNzUG9saWN5OiBpYW0uUG9saWN5O1xuICAgIHB1YmxpYyByZWFkb25seSBtZXNzYWdpbmdBUElVc2VyOiBpYW0uVXNlcjtcblxuICAgIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBBUElTdGFja1Byb3BzKSB7XG4gICAgICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgICAgY29uc3QgYXBpID0gbmV3IGFwaWd3Mi5IdHRwQXBpKHRoaXMsICdNZXNzYWdpbmdBUEknLCB7XG4gICAgICAgICAgICBkZWZhdWx0QXV0aG9yaXplcjogbmV3IGFwaWd3MkF1dGhvcml6ZXJzLkh0dHBJYW1BdXRob3JpemVyKCksXG4gICAgICAgICAgICBjb3JzUHJlZmxpZ2h0OiB7XG4gICAgICAgICAgICAgICAgYWxsb3dPcmlnaW5zOiBwcm9wcy5TU01QYXJhbXMuYXBpQWxsb3dlZE9yaWdpbnMuc3BsaXQoJywnKS5tYXAoKGl0ZW06IHN0cmluZykgPT4gaXRlbS50cmltKCkpLFxuICAgICAgICAgICAgICAgIGFsbG93TWV0aG9kczogW2FwaWd3Mi5Db3JzSHR0cE1ldGhvZC5QT1NUXSxcbiAgICAgICAgICAgICAgICBhbGxvd0hlYWRlcnM6IGFwaWd3LkNvcnMuREVGQVVMVF9IRUFERVJTLFxuICAgICAgICAgICAgfSxcblxuICAgICAgICB9KTtcblxuICAgICAgICAvLyBFbmFibGUgdGhyb3R0bGluZ1xuICAgICAgICBjb25zdCBkZWZhdWx0U3RhZ2UgPSBhcGkuZGVmYXVsdFN0YWdlIS5ub2RlLmRlZmF1bHRDaGlsZCBhcyBDZm5TdGFnZTtcbiAgICAgICAgZGVmYXVsdFN0YWdlLmRlZmF1bHRSb3V0ZVNldHRpbmdzID0ge1xuICAgICAgICAgICAgdGhyb3R0bGluZ0J1cnN0TGltaXQ6IDEwLFxuICAgICAgICAgICAgdGhyb3R0bGluZ1JhdGVMaW1pdDogMTAsXG4gICAgICAgIH07XG5cbiAgICAgICAgIC8vIFNldHVwIHRoZSBhY2Nlc3MgbG9nIGZvciBBUElHV3YyXG4gICAgICAgICBjb25zdCBzdGFnZSA9IGFwaS5kZWZhdWx0U3RhZ2UhLm5vZGUuZGVmYXVsdENoaWxkIGFzIENmblN0YWdlO1xuXG4gICAgICAgICBjb25zdCBsb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKGFwaSwgJ0FjY2Vzc0xvZ3MnLCB7XG4gICAgICAgICAgICAgcmV0ZW50aW9uOiA5MCwgLy8gS2VlcCBsb2dzIGZvciA5MCBkYXlzXG4gICAgICAgICB9KTtcbiBcbiAgICAgICAgIHN0YWdlLmFjY2Vzc0xvZ1NldHRpbmdzID0ge1xuICAgICAgICAgICAgIGRlc3RpbmF0aW9uQXJuOiBsb2dHcm91cC5sb2dHcm91cEFybixcbiAgICAgICAgICAgICBmb3JtYXQ6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgICAgICAgcmVxdWVzdElkOiAnJGNvbnRleHQucmVxdWVzdElkJyxcbiAgICAgICAgICAgICAgICAgdXNlckFnZW50OiAnJGNvbnRleHQuaWRlbnRpdHkudXNlckFnZW50JyxcbiAgICAgICAgICAgICAgICAgc291cmNlSXA6ICckY29udGV4dC5pZGVudGl0eS5zb3VyY2VJcCcsXG4gICAgICAgICAgICAgICAgIHJlcXVlc3RUaW1lOiAnJGNvbnRleHQucmVxdWVzdFRpbWUnLFxuICAgICAgICAgICAgICAgICBodHRwTWV0aG9kOiAnJGNvbnRleHQuaHR0cE1ldGhvZCcsXG4gICAgICAgICAgICAgICAgIHBhdGg6ICckY29udGV4dC5wYXRoJyxcbiAgICAgICAgICAgICAgICAgc3RhdHVzOiAnJGNvbnRleHQuc3RhdHVzJyxcbiAgICAgICAgICAgICAgICAgcmVzcG9uc2VMZW5ndGg6ICckY29udGV4dC5yZXNwb25zZUxlbmd0aCcsXG4gICAgICAgICAgICAgICB9KSxcbiAgICAgICAgIH1cbiBcbiAgICAgICAgIGxvZ0dyb3VwLmdyYW50V3JpdGUobmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdhcGlnYXRld2F5LmFtYXpvbmF3cy5jb20nKSk7XG5cbiAgICAgICAgYXBpLmFkZFJvdXRlcyh7XG4gICAgICAgICAgICBpbnRlZ3JhdGlvbjogbmV3IGFwaWd3MkludGVncmF0aW9ucy5IdHRwTGFtYmRhSW50ZWdyYXRpb24oJ2NoYXRPcmNoZXN0cmF0b3InLCBwcm9wcy5jaGF0T3JjaGVzdHJhdG9yTGFtYmRhKSxcbiAgICAgICAgICAgIHBhdGg6ICcvc2VuZE1lc3NhZ2VzJyxcbiAgICAgICAgICAgIG1ldGhvZHM6IFthcGlndzIuSHR0cE1ldGhvZC5QT1NUXSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5hcGkgPSBhcGk7XG5cbiAgICAgICAgY29uc3QgbWVzc2FnaW5nQVBJVXNlciA9IG5ldyBpYW0uVXNlcih0aGlzLCAnbWVzc2FnaW5nQVBJVXNlcicsIHtcbiAgICAgICAgICAgIHVzZXJOYW1lOiBgJHtjb25maWdQYXJhbXMuQ2RrQXBwTmFtZX0tQVBJVXNlcmBcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5tZXNzYWdpbmdBUElVc2VyID0gbWVzc2FnaW5nQVBJVXNlcjtcblxuICAgICAgICBjb25zdCBhcGlBY2Nlc3NQb2xpY3kgPSBuZXcgaWFtLlBvbGljeSh0aGlzLCAnbWVzc2FnaW5nQVBJQWNjZXNzUG9saWN5Jywge1xuICAgICAgICAgICAgcG9saWN5TmFtZTogJ21lc3NhZ2luZ0FQSUFjY2Vzc1BvbGljeScsXG4gICAgICAgICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICAgICAnZXhlY3V0ZS1hcGk6SW52b2tlJ1xuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgICAgICAgICAgIGBhcm46YXdzOmV4ZWN1dGUtYXBpOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fToke2FwaS5odHRwQXBpSWR9LyovUE9TVC9zZW5kTWVzc2FnZXNgXG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy5hcGlBY2Nlc3NQb2xpY3kgPSBhcGlBY2Nlc3NQb2xpY3k7XG4gICAgICAgIGFwaUFjY2Vzc1BvbGljeS5hdHRhY2hUb1VzZXIobWVzc2FnaW5nQVBJVXNlcik7XG4gICAgfVxufVxuIl19