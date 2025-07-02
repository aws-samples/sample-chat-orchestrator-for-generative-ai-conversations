#!/usr/bin/env node

// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import 'source-map-support/register';
import {App, Tags} from 'aws-cdk-lib'
import { CdkBackendStack } from '../lib/cdk-backend-stack';
import { AwsSolutionsChecks } from 'cdk-nag'
import { Aspects } from 'aws-cdk-lib';

const configParams = require('../config.params.json');

const app = new App();
//Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true })) 

const application_version = app.node.tryGetContext('application_version')
console.log("VERSION: ",application_version)

const tags = configParams['tags']
Object.entries(tags).forEach(([key, value]) => {
    if (typeof value === "string") {
        Tags.of(app).add(key, value);
    }
})

console.log("Running in stack mode...");
const cdkBackendStack = new CdkBackendStack(app, configParams['CdkBackendStack'], {
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
});

   