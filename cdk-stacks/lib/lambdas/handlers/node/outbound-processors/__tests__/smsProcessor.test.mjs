/**
 * Property-based tests for smsProcessor Lambda
 * Feature: rcs-channel-support (adds coverage for the existing SMS processor)
 *
 * Uses fast-check to verify correctness properties of the SMS outbound processor.
 */

import fc from 'fast-check';

// Mock the PinpointService module before requiring the handler
const mockSendSMS = jest.fn();
const mockSendMMS = jest.fn();

jest.mock('../../services/PinpointService.mjs', () => ({
  sendSMS: (...args) => mockSendSMS(...args),
  sendMMS: (...args) => mockSendMMS(...args)
}), { virtual: true });

const { handler } = require('../smsProcessor.mjs');

function invokeHandler(event) {
  return new Promise((resolve, reject) => {
    handler(event, {}, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function buildEvent({ destinationAddress, outboundMessage, imageId }) {
  const event = {
    recipient: {
      destinationAddress: destinationAddress || '+15551234567'
    },
    outboundMessage: outboundMessage === undefined ? 'Hello from SMS' : outboundMessage
  };
  if (imageId !== undefined) event.imageId = imageId;
  return event;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSendSMS.mockResolvedValue({ MessageId: 'sms-id' });
  mockSendMMS.mockResolvedValue({ MessageId: 'mms-id' });
});

/**
 * Property 1: With no imageId, sends SMS (text) with destinationAddress + outboundMessage.
 */
describe('Property 1: No imageId routes to sendSMS', () => {
  it('should call sendSMS(destinationAddress, outboundMessage) and not sendMMS', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 2 }).map(s => '+' + s.replace(/\+/g, '')),
        fc.string({ minLength: 1 }),
        async (destinationAddress, outboundMessage) => {
          mockSendSMS.mockClear();
          mockSendMMS.mockClear();
          mockSendSMS.mockResolvedValue({ MessageId: 'sms-id' });

          const result = await invokeHandler(buildEvent({ destinationAddress, outboundMessage }));

          expect(mockSendSMS).toHaveBeenCalledWith(destinationAddress, outboundMessage);
          expect(mockSendMMS).not.toHaveBeenCalled();
          expect(result).toEqual({ messageId: 'sms-id' });
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Property 2: With an imageId, sends MMS with destinationAddress + imageId + outboundMessage.
 */
describe('Property 2: imageId routes to sendMMS', () => {
  it('should call sendMMS(destinationAddress, imageId, outboundMessage) and not sendSMS', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 2 }).map(s => '+' + s.replace(/\+/g, '')),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        async (destinationAddress, outboundMessage, imageId) => {
          mockSendSMS.mockClear();
          mockSendMMS.mockClear();
          mockSendMMS.mockResolvedValue({ MessageId: 'mms-id' });

          const result = await invokeHandler(buildEvent({ destinationAddress, outboundMessage, imageId }));

          expect(mockSendMMS).toHaveBeenCalledWith(destinationAddress, imageId, outboundMessage);
          expect(mockSendSMS).not.toHaveBeenCalled();
          expect(result).toEqual({ messageId: 'mms-id' });
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Property 3: Returns the MessageId from the underlying send response (SMS path).
 */
describe('Property 3: Returns MessageId from send response', () => {
  it('should return { messageId } matching the sendSMS response', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        async (messageId) => {
          mockSendSMS.mockResolvedValue({ MessageId: messageId });

          const result = await invokeHandler(buildEvent({}));

          expect(result).toEqual({ messageId });
        }
      ),
      { numRuns: 100 }
    );
  });
});
