# Sample AgentCore Agent

A reference Strands agent for Amazon Bedrock AgentCore Runtime. This agent demonstrates how to build and deploy an AI agent that integrates with the Chat Orchestrator solution.

No Docker or ECR setup is required. CDK uploads the agent source and bundled dependencies to S3, and AgentCore runs it as a managed container.

The sample agent includes two tools:
- **get_current_time** — returns the current UTC date and time
- **lookup_order_status** — looks up mock order status by order ID

## Prerequisites

- Python 3.12 and pip3 installed (used to bundle dependencies for ARM64 Linux)
- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) installed and configured
- Amazon Bedrock AgentCore enabled in your AWS account

## How It Works

When you set `useAgentCoreRuntime = true` and deploy the CDK stack:

1. The `build:agent` npm script runs `pip3 install` to bundle ARM64 Linux dependencies into `lib/`
2. CDK zips this directory (including `lib/`) and uploads it to S3 via `s3assets.Asset`
3. A `bedrockagentcore.CfnRuntime` resource is created referencing the S3 code
4. A waiter custom resource polls until the runtime reaches READY status
5. The runtime ARN is output and wired into the DynamoDB use case configuration

The `npm run cdk:deploy` script handles all of this automatically.

## Customizing the Agent

To build your own agent based on this sample:

1. Add or modify tools in `main.py` using the `@tool` decorator
2. Update the `SYSTEM_PROMPT` to match your use case
3. Add any new Python dependencies to `requirements.txt`
4. Redeploy the CDK stack — dependencies are re-bundled and the runtime is updated

The agent receives a JSON payload with:
- `prompt` — the user's message text
- `phone_number` — the caller's phone number (E.164 format)

## Project Structure

```
sample-agentcore-agent/
├── main.py             # Strands agent with BedrockAgentCoreApp entrypoint
├── requirements.txt    # Python dependencies
├── lib/                # Bundled ARM64 dependencies (auto-generated, git-ignored)
└── README.md           # This file
```

## Local Testing

You can run the agent locally for development:

```bash
pip install -r requirements.txt
python main.py
```

This starts the agent on port 8080 using the BedrockAgentCoreApp HTTP server.
