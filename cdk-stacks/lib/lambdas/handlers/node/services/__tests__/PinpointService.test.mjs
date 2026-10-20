/**
 * Property-based tests for PinpointService.sendRCS
 * Feature: rcs-channel-support (Phase 1 MVP)
 *
 * Uses fast-check to verify the RCS send path builds the correct
 * SendTextMessage command using the RCS Agent ARN as origination identity.
 */

import fc from 'fast-check';

// Mock the AWS SDK before importing the service
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-pinpoint-sms-voice-v2', () => ({
  PinpointSMSVoiceV2Client: jest.fn().mockImplementation(() => ({
    send: mockSend
  })),
  SendTextMessageCommand: jest.fn().mockImplementation((input) => ({ input })),
  SendMediaMessageCommand: jest.fn().mockImplementation((input) => ({ input }))
}), { virtual: true });

const { SendTextMessageCommand } = require('@aws-sdk/client-pinpoint-sms-voice-v2');

const RCS_AGENT_ARN = 'arn:aws:sms-voice:us-west-2:123456789012:rcs-agent/rcs-abc123';

beforeAll(() => {
  process.env.RCS_AGENT_ARN = RCS_AGENT_ARN;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockResolvedValue({ MessageId: 'default-id' });
});

// Re-import the module fresh so it picks up env at module-eval time if needed.
const { sendRCS } = require('../PinpointService.mjs');

/**
 * Property 1: sendRCS uses the RCS Agent ARN as OriginationIdentity and
 * forwards destinationAddress + message unmodified into the command input.
 */
describe('Property 1: Command built with RCS Agent ARN and provided fields', () => {
  it('should set OriginationIdentity to RCS_AGENT_ARN, with correct destination and body', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 2 }).map(s => '+' + s.replace(/\+/g, '')),
        fc.string({ minLength: 1 }),
        async (destinationAddress, message) => {
          mockSend.mockResolvedValue({ MessageId: 'id' });

          await sendRCS(destinationAddress, message);

          const input = SendTextMessageCommand.mock.calls[
            SendTextMessageCommand.mock.calls.length - 1
          ][0];

          expect(input.OriginationIdentity).toBe(RCS_AGENT_ARN);
          expect(input.DestinationPhoneNumber).toBe(destinationAddress);
          expect(input.MessageBody).toBe(message);
          expect(input.DryRun).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Property 2: When a sessionId is provided, it is passed through as Context.sessionId;
 * when omitted, no Context is set.
 */
describe('Property 2: sessionId round-trips into Context', () => {
  it('should include Context.sessionId only when a sessionId is provided', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.option(fc.uuid(), { nil: undefined }),
        async (sessionId) => {
          mockSend.mockResolvedValue({ MessageId: 'id' });

          await sendRCS('+15551234567', 'hi', sessionId);

          const input = SendTextMessageCommand.mock.calls[
            SendTextMessageCommand.mock.calls.length - 1
          ][0];

          if (sessionId) {
            expect(input.Context).toEqual({ sessionId });
          } else {
            expect(input.Context).toBeUndefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Property 3: sendRCS returns the SDK response (including MessageId) to the caller.
 */
describe('Property 3: Returns the SDK response', () => {
  it('should return the response object from the SDK send call', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        async (messageId) => {
          const response = { MessageId: messageId };
          mockSend.mockResolvedValue(response);

          const result = await sendRCS('+15551234567', 'hi');

          expect(result).toEqual(response);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Property 4: SDK errors are rethrown (as an Error with the SDK message).
 */
describe('Property 4: SDK errors are rethrown', () => {
  it('should throw when the SDK send call rejects', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        async (message) => {
          mockSend.mockRejectedValue(new Error(message));

          await expect(sendRCS('+15551234567', 'hi')).rejects.toThrow(message);
        }
      ),
      { numRuns: 50 }
    );
  });
});
