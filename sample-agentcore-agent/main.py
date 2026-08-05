import sys
import os
import json
from datetime import datetime, timezone

# Add bundled dependencies to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'lib'))

from strands import Agent, tool
from bedrock_agentcore.runtime import BedrockAgentCoreApp


@tool
def get_current_time() -> str:
    """Get the current date and time in UTC.

    Returns the current UTC timestamp, useful for time-related questions.
    """
    now = datetime.now(timezone.utc)
    return json.dumps({
        "datetime": now.isoformat(),
        "date": now.strftime("%B %d, %Y"),
        "time": now.strftime("%H:%M:%S UTC"),
    })


@tool
def lookup_order_status(order_id: str) -> str:
    """Look up the status of a customer order.

    Args:
        order_id: The order identifier (e.g., ORD-12345)
    """
    # Sample mock data for demonstration purposes
    mock_orders = {
        "ORD-12345": {"status": "Shipped", "eta": "2 business days"},
        "ORD-67890": {"status": "Processing", "eta": "3-5 business days"},
    }
    order = mock_orders.get(order_id.upper().strip())
    if order:
        return json.dumps({"order_id": order_id, **order})
    return json.dumps({"error": f"Order {order_id} not found."})


# System prompt for the demo agent
SYSTEM_PROMPT = """You are a helpful customer service assistant deployed via Amazon Bedrock AgentCore Runtime.
You assist customers via SMS and WhatsApp messaging.

Your capabilities:
- Check the current time
- Look up order status

Important guidelines:
- Keep responses SHORT and concise (they are delivered via SMS/WhatsApp)
- The caller's phone number is provided at the start of each message in [Caller phone: +1XXXXXXXXXX] format
- Be friendly and helpful
- Use plain text without markdown formatting
"""

# Initialize the BedrockAgentCoreApp and Strands agent
app = BedrockAgentCoreApp()
agent = Agent(
    system_prompt=SYSTEM_PROMPT,
    tools=[get_current_time, lookup_order_status],
)


@app.entrypoint
def invoke(payload):
    """Handle incoming invocations from AgentCore Runtime.

    Extracts the user prompt and phone number from the payload,
    prepends caller context to the prompt, and returns the agent response.
    """
    prompt = payload.get("prompt", "Hello")
    phone_number = payload.get("phone_number", "unknown")

    # Prepend phone number context so the agent knows who is calling
    contextualized_prompt = f"[Caller phone: {phone_number}] {prompt}"

    result = agent(contextualized_prompt)
    return result.message


if __name__ == "__main__":
    app.run()
