/**
 * Unit tests for the inbound filters in chatOrchestrator's 'process' action:
 * the session window, keyword skipping and de-duplication.
 * Session id reuse is covered by the property-based tests in chatOrchestrator.test.mjs.
 */
const mockQuery = jest.fn();
const mockGet = jest.fn();
const mockPut = jest.fn();
const mockScan = jest.fn();
const mockInvoke = jest.fn();

jest.mock('../services/DynamoDBService.mjs', () => ({
  query: (...args) => mockQuery(...args),
  get: (...args) => mockGet(...args),
  put: (...args) => mockPut(...args),
  scan: (...args) => mockScan(...args),
  deleteItemsByPartitionKey: jest.fn()
}));
jest.mock('../services/LambdaService.mjs', () => ({
  invoke: (...args) => mockInvoke(...args)
}));
jest.mock('../services/FirehoseService.mjs', () => ({
  firehoseDirectPut: jest.fn()
}));
const mockDescribeKeywords = jest.fn();
jest.mock('../services/PinpointService.mjs', () => ({
  describeKeywords: (...args) => mockDescribeKeywords(...args)
}));
jest.mock('xss', () => (text) => text, { virtual: true });

const { handler } = require('../chatOrchestrator.mjs');

const USE_CASE = {
  useCase: 'orders',
  responseGeneratorLambdaName: 'agentCoreResponseGenerator',
  channels: [{ channel: 'rcs', processorLambdaName: 'rcsProcessor' }]
};

function invokeHandler(event) {
  return new Promise((resolve, reject) => {
    handler(event, {}, (err, result) => (err ? reject(err) : resolve(result)));
  });
}

function inbound(overrides = {}) {
  return {
    inboundMessage: {
      originationNumber: '+14255550182',
      destinationAddress: '+14255550182',
      serviceAddress: 'rcs-agent-1',
      messageBody: 'ORD-12345',
      messageKeyword: 'KEYWORD_123456789012',
      inboundMessageId: 'in-1',
      action: 'process',
      channel: 'rcs',
      ...overrides
    }
  };
}

// secondsFromNow < 0 makes an item past its ttl that DynamoDB hasn't deleted yet
function storedMessage(sessionId, secondsFromNow = 300, messageId = 'out-0') {
  return {
    phoneNumber: '+14255550182',
    messageId,
    channel: 'rcs',
    direction: 'outbound',
    sessionId,
    sessionVariables: { useCaseId: 'orders', channel: 'rcs', sessionId },
    ttl: Date.now() / 1000 + secondsFromNow
  };
}

function generatorCalls() {
  return mockInvoke.mock.calls.filter(([name]) => name === 'agentCoreResponseGenerator');
}

// The orchestrator caches keywords per origination identity for 5 minutes at
// module level, so each test uses its own RCS agent ID to start uncached.
let agentCounter = 0;

beforeEach(() => {
  jest.clearAllMocks();
  agentCounter += 1;
  process.env.RCS_AGENT_ID = `rcs-test-agent-${agentCounter}`;
  delete process.env.SMS_ORIGINATION_NUMBER_ID;
  mockDescribeKeywords.mockResolvedValue(['HELP', 'STOP']);
  process.env.CONTEXT_DYNAMODB_TABLE = 'ChatContext';
  process.env.SESSION_SECONDS = '600';
  mockScan.mockResolvedValue({ Items: [USE_CASE] });
  mockGet.mockResolvedValue({});
  mockPut.mockResolvedValue({});
  mockInvoke.mockImplementation(async (name) =>
    name === 'agentCoreResponseGenerator'
      ? { response: 'What is that order number for?' }
      : { messageId: 'out-1' }
  );
});

describe('stored conversation and the session window', () => {
  test('reuses the session id while the last message is within its ttl', async () => {
    mockQuery.mockResolvedValue([storedMessage('stored-session', 300)]);
    await invokeHandler(inbound());
    expect(generatorCalls()[0][1].sessionVariables.sessionId).toBe('stored-session');
  });

  test('after the ttl, keeps the use case but starts a new session with no history', async () => {
    mockQuery.mockResolvedValue([storedMessage('old-session', -60)]);
    const result = await invokeHandler(inbound());
    expect(generatorCalls()).toHaveLength(1);
    const payload = generatorCalls()[0][1];
    expect(payload.useCase.useCase).toBe('orders');
    expect(payload.sessionVariables.useCaseId).toBe('orders');
    expect(payload.sessionVariables.sessionId).not.toBe('old-session');
    expect(payload.conversation).toEqual([]);
    expect(result.responseMessage).toBe('What is that order number for?');
  });

  test('passes only unexpired messages as history', async () => {
    mockQuery.mockResolvedValue([
      storedMessage('old-session', -60, 'out-old'),
      storedMessage('new-session', 300, 'out-new')
    ]);
    await invokeHandler(inbound());
    const payload = generatorCalls()[0][1];
    expect(payload.conversation.map((item) => item.messageId)).toEqual(['out-new']);
    expect(payload.sessionVariables.sessionId).toBe('new-session');
  });

  test('treats a stored message without ttl as expired', async () => {
    const item = storedMessage('no-ttl-session');
    delete item.ttl;
    mockQuery.mockResolvedValue([item]);
    await invokeHandler(inbound());
    const payload = generatorCalls()[0][1];
    expect(payload.useCase.useCase).toBe('orders');
    expect(payload.sessionVariables.sessionId).not.toBe('no-ttl-session');
  });

  test('conversation query returns expired items so the use case survives', async () => {
    mockQuery.mockResolvedValue([storedMessage('stored-session')]);
    await invokeHandler(inbound());
    const params = mockQuery.mock.calls[0][0];
    expect(params.FilterExpression).toBe('channel = :channel');
    expect(params.ExpressionAttributeValues).toEqual({ ':phoneNumber': '+14255550182', ':channel': 'rcs' });
  });
});

describe('keyword messages', () => {
  test.each([
    ['STOP', 'STOP'],
    ['HELP', 'help'],
    ['HELP', '  Help me please']
  ])('skips the agent when keyword %s matches body "%s"', async (keyword, body) => {
    const result = await invokeHandler(inbound({ messageKeyword: keyword, messageBody: body }));
    expect(result).toEqual({ responseMessage: null, skipped: 'keyword' });
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockPut).not.toHaveBeenCalled();
  });

  test('processes normally when messageKeyword does not prefix the body', async () => {
    mockQuery.mockResolvedValue([storedMessage('stored-session')]);
    await invokeHandler(inbound({ messageKeyword: 'KEYWORD_123456789012', messageBody: 'Where is my order?' }));
    expect(generatorCalls()).toHaveLength(1);
  });

  test('processes normally when messageKeyword is missing and the body is not a keyword', async () => {
    mockQuery.mockResolvedValue([storedMessage('stored-session')]);
    await invokeHandler(inbound({ messageKeyword: undefined }));
    expect(generatorCalls()).toHaveLength(1);
  });
});

// The RCS inbound payload has no messageKeyword field (seen on a real RCS agent),
// so the body is compared with the keywords configured on the agent.
describe('keyword messages without messageKeyword (RCS payload)', () => {
  const rcsInbound = (messageBody) => inbound({ messageKeyword: undefined, messageBody });

  test.each(['HELP', 'help', '  Stop '])('skips "%s" using the agent keywords', async (body) => {
    const result = await invokeHandler(rcsInbound(body));
    expect(result).toEqual({ responseMessage: null, skipped: 'keyword' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test('reads the keywords from the RCS agent', async () => {
    await invokeHandler(rcsInbound('HELP'));
    expect(mockDescribeKeywords).toHaveBeenCalledWith(process.env.RCS_AGENT_ID);
  });

  // Seen on a real RCS agent: End User Messaging sends the HELP response only
  // when HELP is the whole message, so longer messages must reach the agent.
  test.each(['Help me with my order my number ORD-12345', 'Helpful tips?', 'stop sending promos please'])(
    'sends "%s" to the agent because it is not only a keyword', async (body) => {
      mockQuery.mockResolvedValue([storedMessage('stored-session')]);
      await invokeHandler(rcsInbound(body));
      expect(generatorCalls()).toHaveLength(1);
    });

  test('skips a custom keyword configured on the agent', async () => {
    mockDescribeKeywords.mockResolvedValue(['HELP', 'STOP', 'PROMO']);
    const result = await invokeHandler(rcsInbound('promo'));
    expect(result.skipped).toBe('keyword');
  });

  test('looks up the agent keywords once and caches them', async () => {
    mockQuery.mockResolvedValue([storedMessage('stored-session')]);
    await invokeHandler(rcsInbound('HELP'));
    await invokeHandler(inbound({ messageKeyword: undefined, messageBody: 'Where is my order?', inboundMessageId: 'in-2' }));
    expect(mockDescribeKeywords).toHaveBeenCalledTimes(1);
  });

  test('uses the SMS number ID for SMS messages', async () => {
    process.env.SMS_ORIGINATION_NUMBER_ID = `phone-test-${agentCounter}`;
    const result = await invokeHandler(inbound({ channel: 'sms', messageKeyword: undefined, messageBody: 'HELP' }));
    expect(result.skipped).toBe('keyword');
    expect(mockDescribeKeywords).toHaveBeenCalledWith(`phone-test-${agentCounter}`);
  });

  test('skips a required opt-out keyword sent alone, even if the lookup fails', async () => {
    mockDescribeKeywords.mockRejectedValue(new Error('AccessDenied'));
    const result = await invokeHandler(rcsInbound('Cancel'));
    expect(result.skipped).toBe('keyword');
  });

  test('processes the message when the lookup fails and the body is not an opt-out keyword', async () => {
    mockDescribeKeywords.mockRejectedValue(new Error('AccessDenied'));
    mockQuery.mockResolvedValue([storedMessage('stored-session')]);
    await invokeHandler(rcsInbound('Cancel my order'));
    expect(generatorCalls()).toHaveLength(1);
  });

  test('does not look up keywords for channels without an origination identity', async () => {
    mockQuery.mockResolvedValue([storedMessage('stored-session')]);
    await invokeHandler(inbound({ channel: 'api', messageKeyword: undefined, messageBody: 'HELP' }));
    expect(mockDescribeKeywords).not.toHaveBeenCalled();
    expect(generatorCalls()).toHaveLength(1);
  });
});

describe('de-duplication', () => {
  test('skips an inbound message that is already stored', async () => {
    mockGet.mockResolvedValue({ Item: { messageId: 'in-1' } });
    const result = await invokeHandler(inbound());
    expect(mockGet).toHaveBeenCalledWith('ChatContext', { phoneNumber: '+14255550182', messageId: 'in-1' });
    expect(result).toEqual({ responseMessage: null, skipped: 'duplicate' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test('processes the message when the duplicate check fails', async () => {
    mockGet.mockRejectedValue(new Error('throttled'));
    mockQuery.mockResolvedValue([storedMessage('stored-session')]);
    await invokeHandler(inbound());
    expect(generatorCalls()).toHaveLength(1);
  });

  test('does not check for duplicates when no inboundMessageId is provided', async () => {
    mockQuery.mockResolvedValue([storedMessage('stored-session')]);
    await invokeHandler(inbound({ inboundMessageId: undefined }));
    expect(mockGet).not.toHaveBeenCalled();
    expect(generatorCalls()).toHaveLength(1);
  });
});
