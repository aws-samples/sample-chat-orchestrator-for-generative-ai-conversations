# Change Log
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.2] - 2026-11-18
### Added
- Property-based tests (fast-check) for the session id the chat orchestrator passes to the response generator
- Unit tests for the chat orchestrator's keyword, duplicate and expired-conversation handling

### Fixed
- Replies now reuse the session id stored with the conversation instead of creating a new one for every message. Since 2.1.0, every reply on every channel started a new session, so the AgentCore Runtime and Bedrock Agents response generators had no context from earlier messages.
- A reply after the session window (`SESSION_SECONDS`, 600 seconds) now starts a new agent session without the expired history, but keeps the conversation's use case. DynamoDB deletes expired items in the background, sometimes days later, so expired messages could otherwise be reused and resume an old session.
- Inbound messages that are only a keyword configured on the phone number or RCS agent (such as STOP or HELP) are no longer sent to the response generator. End User Messaging already sends the keyword's response, so the customer got two replies. The RCS inbound payload has no `messageKeyword` field, so the orchestrator reads the configured keywords with `DescribeKeywords` (cached for 5 minutes) and also skips the required opt-out keywords (STOP, CANCEL, ...) sent on their own. The orchestrator role gets `sms-voice:DescribeKeywords` on the stack's SMS number and RCS agent.
- An inbound message whose `inboundMessageId` is already stored is skipped, so a message delivered twice by SNS no longer gets two agent runs and two replies.
- The SMS configuration set (`sms-configuration-set`) is now applied to outbound SMS and MMS. The stack set `DEFAULT_CONFIGURATION_SET` on the SMS processor, but the code reads `CONFIGURATION_SET`, so the setting was ignored. The SMS processor role is also granted `SendTextMessage`/`SendMediaMessage` on the configuration set, which the API authorizes when one is named in the request.
## [3.1.1] - 2026-11-17
### Changed
- Dependency maintenance (no functional changes):
  - Bumped `aws-cdk-lib` from 2.247.0 to 2.263.0 in `cdk-stacks`
  - Bumped `esbuild` from 0.25.0 to 0.28.1 in `cdk-stacks/lib/lambdas/handlers/node`
  - Bumped `js-yaml` from 3.14.2 to 3.15.2 in `cdk-stacks`
  - Bumped `brace-expansion` from 1.1.18 to 1.1.21 in `cdk-stacks`
  - Bumped `handlebars` from 4.7.9 to 4.7.10 in `cdk-stacks`
  - Picked up `browserslist` 4.28.x transitively via the CDK update

## [3.1.0] - 2026-08-06
### Added
- RCS (Rich Communication Services) as a new messaging channel via AWS End User Messaging SMS
- Inbound RCS messages received through an SNS topic and processed by a dedicated RCS trigger Lambda
- Outbound RCS text replies sent with `SendTextMessage` using the AWS RCS Agent as the origination identity
- `rcsEnabled`, `rcsAgentId`, and `rcsSNSTopicArn` configuration parameters
- Custom resource that enables two-way messaging on the AWS RCS Agent during deployment
- Documentation and a link to the sample RCS agent setup for creating an RCS Agent in minutes
- Unit tests (fast-check) for the SMS and RCS outbound processors and the RCS send path
- Synth-time guard that prevents sharing one two-way SNS topic between the SMS and RCS channels
- Updated architecture diagram (`architecture.png`) reflecting the RCS channel, AgentCore Runtime response generator, and grouped Channel Triggers / Outbound Processors, with an editable draw.io source (`architecture.drawio`, also embedded in the PNG)

### Fixed
- Chore: corrected the AgentCore response generator property-based tests to account for the handler's final `.trim()`/`<thinking>`-strip normalization (the suite failed on empty/whitespace-only text blocks)

## [3.0.0] - 2026-08-04
### Added
- AgentCore Runtime as a third response generator option. CDK automatically uploads agent source code to S3 and creates the runtime — no Docker or ECR required.
- `useAgentCoreRuntime` configuration parameter to enable AgentCore Runtime deployment
- Sample Strands agent in `sample-agentcore-agent/` with tools for time and order lookup
- Property-based tests (fast-check) for AgentCore response generator handler

## [2.1.0] - 2025-12-04
### Added
- Allow specifying "api" as the channel to receive generated responses
- Allow for passing the use case on API calls

### Changed
- Triggers and API now send single inbound messages instead of an array of inbound messages
- Updated documentation

## [2.0.0] - 2025-07-02

### Added
- Optional API Endpoint for sending messages
- Support for Amazon Nova Models
- Support for newer Anthropic Models
- Configurable Use Cases to support multiple business units and sending/receiving scenarios

### Changed
- Decomposed Chat Handler into multiple Lambda functions
- Decomposed architecture to support future customer built channels and/or LLM Agents
- Updated dependencies
- Updated documentation

## [1.2.2] - 2025-02-19

### Changed
- Documentation updated

## [1.2.1] - 2025-02-18

### Changed
- Dependencies updated
- Bug fixes

## [1.2.0] - 2025-01-27

### Changed
- Added support for Amazon Bedrock Agents
- Added option to push conversation history to an Amazon Data Firehose Stream

## [1.1.0] - 2024-10-24

### Changed
- Adding support for WhatsApp

## [1.0.0] - 2024-09-30

### Changed
- Initial Release