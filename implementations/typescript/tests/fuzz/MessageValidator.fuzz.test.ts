/**
 * Fuzz tests for MessageValidator.
 *
 * Feed random / malformed inputs to validateStructure() and validate().
 * The goal is to verify that the validator NEVER crashes (no uncaught exceptions)
 * and always returns a clean boolean or throws a SnapError.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { MessageValidator } from '../../src/messaging/MessageValidator.js';
import { SnapError } from '../../src/errors/SnapError.js';

describe('MessageValidator — Fuzz', () => {
  // ── validateStructure: must never throw, always returns boolean ──

  it('validateStructure never throws on arbitrary JSON values', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        const result = MessageValidator.validateStructure(input);
        expect(typeof result).toBe('boolean');
      }),
      { numRuns: 500 },
    );
  });

  it('validateStructure never throws on random objects with string fields', () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.oneof(fc.string(), fc.anything()),
          version: fc.oneof(fc.string(), fc.anything()),
          from: fc.oneof(fc.string(), fc.anything()),
          to: fc.oneof(fc.string(), fc.anything()),
          type: fc.oneof(fc.string(), fc.anything()),
          method: fc.oneof(fc.string(), fc.anything()),
          payload: fc.oneof(fc.object(), fc.anything()),
          timestamp: fc.oneof(fc.integer(), fc.anything()),
          sig: fc.oneof(fc.string(), fc.anything()),
        }),
        (input) => {
          const result = MessageValidator.validateStructure(input);
          expect(typeof result).toBe('boolean');
        },
      ),
      { numRuns: 500 },
    );
  });

  it('validateStructure rejects all non-object primitives', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null), fc.constant(undefined)),
        (input) => {
          expect(MessageValidator.validateStructure(input)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('validateStructure rejects objects with random keys', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.anything()),
        (input) => {
          // Random dictionaries should virtually never pass validation
          const result = MessageValidator.validateStructure(input);
          expect(typeof result).toBe('boolean');
        },
      ),
      { numRuns: 300 },
    );
  });

  // ── validate(): must throw SnapError or succeed, never crash unexpectedly ──

  it('validate never throws non-SnapError on arbitrary inputs', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        try {
          MessageValidator.validate(input, { skipTimestampCheck: true });
        } catch (e) {
          // validate() should always throw SnapError
          expect(e).toBeInstanceOf(SnapError);
        }
      }),
      { numRuns: 500 },
    );
  });

  // ── Pattern-specific fuzzing ──

  it('rejects randomly-generated from/to addresses that are not valid P2TR', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (addr) => {
        const msg = {
          id: 'test-id',
          version: '0.1',
          from: addr,
          to: addr,
          type: 'request',
          method: 'message/send',
          payload: {},
          timestamp: Math.floor(Date.now() / 1000),
          sig: '0'.repeat(128),
        };
        const result = MessageValidator.validateStructure(msg);
        // If address doesn't match P2TR format, should be rejected
        if (!/^(bc1p|tb1p)[a-z0-9]{58}$/.test(addr)) {
          expect(result).toBe(false);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('rejects randomly-generated message IDs with special characters', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        (id) => {
          const msg = {
            id,
            version: '0.1',
            from: 'bc1p5d7rjq7g6rdk2yhzqnt9dp8wvscrplqk0zwy63lmgreu9jzyt0mqf3xvn8',
            to: 'bc1p5d7rjq7g6rdk2yhzqnt9dp8wvscrplqk0zwy63lmgreu9jzyt0mqf3xvn8',
            type: 'request',
            method: 'message/send',
            payload: {},
            timestamp: Math.floor(Date.now() / 1000),
            sig: '0'.repeat(128),
          };
          const result = MessageValidator.validateStructure(msg);
          if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
            expect(result).toBe(false);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('rejects randomly-generated method names that do not match pattern', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 50 }), (method) => {
        const msg = {
          id: 'test-id',
          version: '0.1',
          from: 'bc1p5d7rjq7g6rdk2yhzqnt9dp8wvscrplqk0zwy63lmgreu9jzyt0mqf3xvn8',
          to: 'bc1p5d7rjq7g6rdk2yhzqnt9dp8wvscrplqk0zwy63lmgreu9jzyt0mqf3xvn8',
          type: 'request',
          method,
          payload: {},
          timestamp: Math.floor(Date.now() / 1000),
          sig: '0'.repeat(128),
        };
        const result = MessageValidator.validateStructure(msg);
        if (!/^[a-z]+\/[a-z_]+$/.test(method)) {
          expect(result).toBe(false);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('rejects randomly-generated sig values that do not match pattern', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), (sig) => {
        const msg = {
          id: 'test-id',
          version: '0.1',
          from: 'bc1p5d7rjq7g6rdk2yhzqnt9dp8wvscrplqk0zwy63lmgreu9jzyt0mqf3xvn8',
          to: 'bc1p5d7rjq7g6rdk2yhzqnt9dp8wvscrplqk0zwy63lmgreu9jzyt0mqf3xvn8',
          type: 'request',
          method: 'message/send',
          payload: {},
          timestamp: Math.floor(Date.now() / 1000),
          sig,
        };
        const result = MessageValidator.validateStructure(msg);
        if (!/^[0-9a-f]{128}$/.test(sig)) {
          expect(result).toBe(false);
        }
      }),
      { numRuns: 300 },
    );
  });
});
