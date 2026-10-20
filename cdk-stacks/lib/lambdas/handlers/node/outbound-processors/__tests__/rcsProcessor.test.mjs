/**
 * Property-based tests for rcsProcessor Lambda
 * Feature: rcs-channel-support (Phase 1 MVP)
 *
 * Uses fast-check to verify correctness properties of the RCS outbound processor.
 */

import fc from 'fast-check';

// Mock the PinpointService module before requiring the handler
const mockSendRCS = jest.fn();

jest.mock('../../services/PinpointService.mjs', () => ({
  sendRCS: (...args) => mockSendRCS(...args)
}), { virtual: true });

const { handler } = require('../rcsProcessor.mjs');

function invokeHandler(event) {
  return new Promise((resolve, reject) => {
    handler(event, {}, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function buildEvent({ destinationAddress, outboundMessage }) {
  return {
    recipient: {
      destinationAddress: destinationAddress || '+15551234567'
    },
    outboundMessage: outboundMessage === undefined ? 'Hello from RCS' : outboundMessage
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSendRCS.mockResolvedValue({ MessageId: 'default-message-id' });
});

/**
 * Property 1: Forwards destinationAddress and outboundMessage to sendRCS unmodified.
 *
 * For any destinationAddress and outboundMessage, the handler SHALL call
 * PinpointService.sendRCS with exactly those two values, in that order.
 */
describe('Property 1: Arguments forwarded to sendRCS unmodified', () => {
  it('should call sendRCS(destinationAddress, outboundMessage)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 2 }).map(s => '+' + s.replace(/\+/g, '')),
        fc.string({ minLength: 1 }),
        async (destinationAddress, outboundMessage) => {
          // fast-check runs many iterations inside a single `it`, so clear the
          // mock per iteration to make the call-count assertion reliable.
          mockSendRCS.mockClear();
          mockSendRCS.mockResolvedValue({ MessageId: 'id' });

          const event = buildEvent({ destinationAddress, outboundMessage });
          await invokeHandler(event);

          expect(mockSendRCS).toHaveBeenCalledTimes(1);
          expect(mockSendRCS).toHaveBeenCalledWith(destinationAddress, outboundMessage);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Property 2: Returns the MessageId from the sendRCS response.
 *
 * For any MessageId returned by sendRCS, the handler SHALL return
 * { messageId: <MessageId> } via the callback.
 */
describe('Property 2: Returns MessageId from sendRCS response', () => {
  it('should return { messageId } matching the sendRCS response', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        async (messageId) => {
          mockSendRCS.mockResolvedValue({ MessageId: messageId });

          const result = await invokeHandler(buildEvent({}));

          expect(result).toEqual({ messageId });
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Property 3: Errors from sendRCS are surfaced via the callback.
 *
 * If sendRCS rejects, the handler SHALL invoke the callback with the error
 * and SHALL NOT resolve with a messageId.
 */
describe('Property 3: sendRCS errors propagate to callback', () => {
  it('should reject when sendRCS throws', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        async (message) => {
          mockSendRCS.mockRejectedValue(new Error(message));

          await expect(invokeHandler(buildEvent({}))).rejects.toThrow(message);
        }
      ),
      { numRuns: 50 }
    );
  });
});

/**
 * Property 4: Undefined MessageId yields messageId: undefined (no throw).
 *
 * If sendRCS resolves without a MessageId, the handler SHALL still succeed and
 * return { messageId: undefined } rather than throwing.
 */
describe('Property 4: Missing MessageId handled gracefully', () => {
  it('should return messageId undefined when response has no MessageId', async () => {
    mockSendRCS.mockResolvedValue({});
    const result = await invokeHandler(buildEvent({}));
    expect(result).toEqual({ messageId: undefined });
  });
});
