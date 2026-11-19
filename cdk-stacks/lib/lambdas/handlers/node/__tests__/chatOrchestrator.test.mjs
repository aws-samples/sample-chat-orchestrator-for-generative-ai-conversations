/**
 * Property-based tests for the session id chatOrchestrator passes to the response generator
 *
 * The AgentCore and Bedrock Agents response generators send sessionVariables.sessionId
 * to the service as the session id, and the service keeps the conversation context per
 * session id. Every reply in a conversation therefore has to carry the same id.
 *
 * Uses fast-check to generate the reply texts.
 */

import fc from 'fast-check';

// In-memory stand-in for the ChatContext table. query() returns what getConversation
// asks the PhoneIndex index for: one phone number's items on one channel, oldest first.
const mockTable = [];

// chatOrchestrator.mjs caches the use case list at module level for 5 minutes, so every
// test in this file sees this one use case.
const mockUseCase = {
  useCase: 'agentcore',
  responseGeneratorLambdaName: 'agentCoreResponseGenerator',
  initialMessage: 'Hello! How can I help you today?',
  channels: [{ channel: 'rcs', processorLambdaName: 'rcsProcessor' }]
};

jest.mock('../services/DynamoDBService.mjs', () => ({
  scan: async () => ({ Items: [mockUseCase] }),
  get: async (_tableName, key) => ({
    Item: mockTable.find(item => item.phoneNumber === key.phoneNumber && item.messageId === key.messageId)
  }),
  put: async (_tableName, item) => {
    mockTable.push(JSON.parse(JSON.stringify(item)));
    return {};
  },
  query: async (params) => mockTable
    .filter(item => item.phoneNumber === params.ExpressionAttributeValues[':phoneNumber'])
    .filter(item => item.channel === params.ExpressionAttributeValues[':channel'])
    .sort((a, b) => a.timestamp - b.timestamp),
  deleteItemsByPartitionKey: async (_tableName, _keyName, phoneNumber) => {
    for (let i = mockTable.length - 1; i >= 0; i--) {
      if (mockTable[i].phoneNumber === phoneNumber) mockTable.splice(i, 1);
    }
    return true;
  }
}), { virtual: true });

const mockInvoke = jest.fn();

jest.mock('../services/LambdaService.mjs', () => ({
  invoke: (...args) => mockInvoke(...args)
}), { virtual: true });

jest.mock('../services/FirehoseService.mjs', () => ({
  firehoseDirectPut: jest.fn()
}), { virtual: true });

jest.mock('xss', () => (text) => text, { virtual: true });

const { handler } = require('../chatOrchestrator.mjs');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Message texts that do not match the use case keyword, so each one takes the reply path.
const replyText = fc.string({ minLength: 1 })
  .filter(text => text.toLowerCase().trim() !== mockUseCase.useCase);

function sendInbound(inboundMessage) {
  return new Promise((resolve, reject) => {
    handler({ inboundMessage }, {}, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function rcsMessage(messageBody) {
  return {
    action: 'process',
    channel: 'rcs',
    messageBody,
    destinationAddress: '+15551234567',
    serviceAddress: 'rcs-test-agent'
  };
}

function apiMessage(messageBody) {
  return {
    action: 'process',
    channel: 'api',
    useCaseId: mockUseCase.useCase,
    messageBody,
    destinationAddress: 'api-user-1'
  };
}

function sessionIdsSentToResponseGenerator() {
  return mockInvoke.mock.calls
    .filter(([functionName]) => functionName === mockUseCase.responseGeneratorLambdaName)
    .map(([, payload]) => payload.sessionVariables.sessionId);
}

// fast-check runs many iterations inside a single `it`, so each iteration starts from an
// empty table and a cleared mock.
function startConversation() {
  mockTable.length = 0;
  mockInvoke.mockClear();
}

beforeAll(() => {
  process.env.CONTEXT_DYNAMODB_TABLE = 'ChatContext';
  process.env.USECASE_DYNAMODB_TABLE = 'UseCases';
  process.env.SESSION_SECONDS = '600';
  mockInvoke.mockImplementation(async (functionName, payload) => {
    if (functionName === mockUseCase.responseGeneratorLambdaName) {
      return { response: `reply to: ${payload.recipient.messageBody}`, llmSessionId: payload.sessionVariables.sessionId };
    }
    if (functionName === 'rcsProcessor') {
      return { messageId: `outbound-${mockInvoke.mock.calls.length}` };
    }
    throw new Error(`unexpected Lambda function ${functionName}`);
  });
});

/**
 * Property 1: Every reply after the use case keyword reuses the keyword's session id.
 *
 * For any sequence of replies, the handler SHALL pass the session id created by the
 * keyword message to the response generator for every reply, and store every message
 * of the conversation with that id.
 */
describe('Property 1: Replies reuse the session id created by the use case keyword', () => {
  it('should pass the keyword session id to the response generator for every reply', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(replyText, { minLength: 1, maxLength: 5 }),
        async (replies) => {
          startConversation();

          await sendInbound(rcsMessage(mockUseCase.useCase));
          const keywordSessionId = mockTable[0].sessionId;
          for (const reply of replies) {
            await sendInbound(rcsMessage(reply));
          }

          expect(keywordSessionId).toMatch(UUID_PATTERN);
          expect(sessionIdsSentToResponseGenerator()).toEqual(replies.map(() => keywordSessionId));
          expect(new Set(mockTable.map(item => item.sessionId))).toEqual(new Set([keywordSessionId]));
        }
      ),
      { numRuns: 50 }
    );
  });
});

/**
 * Property 2: A conversation with no stored history gets one new session id.
 *
 * For any sequence of messages sent with a use case id and no stored conversation, the
 * handler SHALL create a session id for the first message and pass that same id to the
 * response generator for every later message.
 */
describe('Property 2: A conversation with no stored history gets one new session id', () => {
  it('should create a session id for the first message and reuse it for the rest', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(replyText, { minLength: 2, maxLength: 5 }),
        async (messages) => {
          startConversation();

          for (const message of messages) {
            await sendInbound(apiMessage(message));
          }

          const sessionIds = sessionIdsSentToResponseGenerator();
          expect(sessionIds[0]).toMatch(UUID_PATTERN);
          expect(sessionIds).toEqual(messages.map(() => sessionIds[0]));
        }
      ),
      { numRuns: 50 }
    );
  });
});
