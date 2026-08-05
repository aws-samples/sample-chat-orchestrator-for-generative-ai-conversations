# Change Log
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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