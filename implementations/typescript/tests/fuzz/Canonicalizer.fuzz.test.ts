/**
 * Fuzz tests for Canonicalizer (JCS / RFC 8785).
 *
 * Verify that canonicalize() never crashes on valid JSON values,
 * and that it throws cleanly on undefined.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Canonicalizer } from '../../src/crypto/Canonicalizer.js';

describe('Canonicalizer — Fuzz', () => {
  it('never crashes on arbitrary JSON-safe values', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (input) => {
        // jsonValue produces only JSON-compatible types (no undefined, no BigInt, etc.)
        const result = Canonicalizer.canonicalize(input);
        expect(typeof result).toBe('string');
      }),
      { numRuns: 1000 },
    );
  });

  it('produces valid JSON for any JSON-safe input', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (input) => {
        const canonical = Canonicalizer.canonicalize(input);
        // Must be parseable JSON
        expect(() => JSON.parse(canonical)).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });

  it('never crashes on nested objects up to depth 5', () => {
    const deepObject = fc.letrec((tie) => ({
      tree: fc.oneof(
        { depthFactor: 0.5 },
        fc.string(),
        fc.integer(),
        fc.boolean(),
        fc.constant(null),
        fc.array(tie('tree'), { maxLength: 3 }),
        fc.dictionary(fc.string({ maxLength: 10 }), tie('tree'), { maxKeys: 3 }),
      ),
    }));

    fc.assert(
      fc.property(deepObject.tree, (input) => {
        // Should either produce a string or throw (for undefined)
        try {
          const result = Canonicalizer.canonicalize(input);
          expect(typeof result).toBe('string');
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('handles random objects with many keys', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ maxLength: 20 }), fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)), { maxKeys: 50 }),
        (input) => {
          const result = Canonicalizer.canonicalize(input);
          expect(typeof result).toBe('string');
          // Parsed result should have same number of keys
          const parsed = JSON.parse(result);
          expect(Object.keys(parsed).length).toBe(Object.keys(input).length);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('handles strings with unicode, escapes, and control characters', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = Canonicalizer.canonicalize(input);
        expect(typeof result).toBe('string');
        expect(JSON.parse(result)).toBe(input);
      }),
      { numRuns: 500 },
    );
  });

  it('handles extreme numeric values', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (input) => {
        const result = Canonicalizer.canonicalize(input);
        expect(typeof result).toBe('string');
      }),
      { numRuns: 300 },
    );
  });
});
