/**
 * Property-based tests for agentCoreResponseGenerator Lambda
 * Feature: agentcore-runtime-support
 *
 * Uses fast-check to verify correctness properties of the Lambda handler.
 */

import fc from 'fast-check';

// Mock the SDK module before requiring the handler
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-bedrock-agentcore', () => ({
  BedrockAgentCoreClient: jest.fn().mockImplementation(() => ({
    send: mockSend
  })),
  InvokeAgentRuntimeCommand: jest.fn().mockImplementation((input) => ({ input }))
}), { virtual: true });

const { InvokeAgentRuntimeCommand } = require('@aws-sdk/client-bedrock-agentcore');
const { handler } = require('../agentCoreResponseGenerator.mjs');

/**
 * Helper to invoke the Lambda handler as a promise
 */
function invokeHandler(event) {
  return new Promise((resolve, reject) => {
    handler(event, {}, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Helper to build a valid event object
 */
function buildEvent({ messageBody, destinationAddress, sessionId, agentRuntimeArn }) {
  return {
    useCase: {
      agentRuntimeArn: agentRuntimeArn || 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/test-id'
    },
    recipient: {
      destinationAddress: destinationAddress || '+15551234567',
      messageBody: messageBody || 'Hello'
    },
    sessionVariables: {
      sessionId: sessionId || 'test-session-id'
    },
    conversation: []
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockResolvedValue({
    response: {
      transformToString: () => Promise.resolve('test response')
    }
  });
});

/**
 * Feature: agentcore-runtime-support, Property 1: Payload construction preserves message and phone number
 *
 * For any valid messageBody string and destinationAddress phone number,
 * the JSON payload sent to AgentCore SHALL contain the messageBody as the
 * `prompt` field and the destinationAddress as the `phone_number` field, both unmodified.
 *
 * **Validates: Requirements 4.2, 4.3**
 */
describe('Property 1: Payload construction preserves message and phone number', () => {
  it('should pass messageBody as prompt and destinationAddress as phone_number unmodified', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 2 }).map(s => '+' + s.replace(/\+/g, '')),
        async (messageBody, destinationAddress) => {
          mockSend.mockResolvedValue({
            response: {
              transformToString: () => Promise.resolve('ok')
            }
          });

          const event = buildEvent({ messageBody, destinationAddress });
          await invokeHandler(event);

          // Verify InvokeAgentRuntimeCommand was called with correct payload
          const commandCall = InvokeAgentRuntimeCommand.mock.calls[
            InvokeAgentRuntimeCommand.mock.calls.length - 1
          ][0];

          const payloadStr = commandCall.payload.toString();
          const payload = JSON.parse(payloadStr);

          expect(payload.prompt).toBe(messageBody);
          expect(payload.phone_number).toBe(destinationAddress);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: agentcore-runtime-support, Property 2: User ID derivation strips leading plus
 *
 * For any phone number string starting with `+`, the derived runtimeUserId
 * SHALL equal `actor-id-` concatenated with the phone number minus the leading `+` character.
 *
 * **Validates: Requirements 4.5**
 */
describe('Property 2: User ID derivation strips leading plus', () => {
  it('should derive runtimeUserId as actor-id-{phoneWithoutPlus}', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(/^[0-9]{7,15}$/),
        async (digits) => {
          const destinationAddress = '+' + digits;

          mockSend.mockResolvedValue({
            response: {
              transformToString: () => Promise.resolve('ok')
            }
          });

          const event = buildEvent({ destinationAddress });
          await invokeHandler(event);

          const commandCall = InvokeAgentRuntimeCommand.mock.calls[
            InvokeAgentRuntimeCommand.mock.calls.length - 1
          ][0];

          expect(commandCall.runtimeUserId).toBe(`actor-id-${digits}`);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: agentcore-runtime-support, Property 3: Structured response text extraction
 *
 * For any AgentCore response containing a `content` array with one or more objects
 * having a `text` field, the Lambda SHALL return a `response` string equal to the
 * concatenation of all `text` values joined by newline characters.
 *
 * **Validates: Requirements 5.1, 5.3**
 */
describe('Property 3: Structured response text extraction', () => {
  it('should join all text blocks with newline', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ text: fc.string() }), { minLength: 1, maxLength: 10 }),
        async (contentArray) => {
          const structuredResponse = JSON.stringify({
            role: 'assistant',
            content: contentArray
          });

          mockSend.mockResolvedValue({
            response: {
              transformToString: () => Promise.resolve(structuredResponse)
            }
          });

          const event = buildEvent({});
          const result = await invokeHandler(event);

          const expectedResponse = contentArray.map(block => block.text).join('\n');
          expect(result.response).toBe(expectedResponse);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: agentcore-runtime-support, Property 4: Plain string passthrough
 *
 * For any AgentCore response that is a plain string (not parseable as JSON with a
 * `content` array), the Lambda SHALL return that string unmodified as the `response` field.
 *
 * **Validates: Requirements 5.2, 7.3**
 */
describe('Property 4: Plain string passthrough', () => {
  it('should return non-JSON strings unmodified', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }).filter(s => {
          // Ensure the string is NOT parseable as JSON with a content array
          try {
            const parsed = JSON.parse(s);
            return !(parsed && parsed.content && Array.isArray(parsed.content));
          } catch {
            return true; // Not valid JSON, which is what we want
          }
        }),
        async (rawString) => {
          mockSend.mockResolvedValue({
            response: {
              transformToString: () => Promise.resolve(rawString)
            }
          });

          const event = buildEvent({});
          const result = await invokeHandler(event);

          expect(result.response).toBe(rawString);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: agentcore-runtime-support, Property 5: Session ID round-trip
 *
 * For any session ID provided in event.sessionVariables.sessionId, the Lambda SHALL
 * pass it as `runtimeSessionId` in the SDK command input AND return it as `llmSessionId`
 * in the response payload.
 *
 * **Validates: Requirements 4.4, 5.5**
 */
describe('Property 5: Session ID round-trip', () => {
  it('should pass sessionId as runtimeSessionId and return it as llmSessionId', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (sessionId) => {
          mockSend.mockResolvedValue({
            response: {
              transformToString: () => Promise.resolve('ok')
            }
          });

          const event = buildEvent({ sessionId });
          const result = await invokeHandler(event);

          // Verify the session ID was passed to the SDK command
          const commandCall = InvokeAgentRuntimeCommand.mock.calls[
            InvokeAgentRuntimeCommand.mock.calls.length - 1
          ][0];
          expect(commandCall.runtimeSessionId).toBe(sessionId);

          // Verify the session ID is returned in the response
          expect(result.llmSessionId).toBe(sessionId);
        }
      ),
      { numRuns: 100 }
    );
  });
});
