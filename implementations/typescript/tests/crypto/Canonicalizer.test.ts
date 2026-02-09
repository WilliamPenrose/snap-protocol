import { describe, it, expect } from 'vitest';
import { Canonicalizer } from '../../src/crypto/Canonicalizer.js';
import { loadJcsVectors } from '../helpers/loadVectors.js';

const { vectors } = loadJcsVectors();

describe('Canonicalizer', () => {
  describe.each(vectors)('$description', (v: { input: unknown; expected: string }) => {
    it('canonicalizes to expected output', () => {
      expect(Canonicalizer.canonicalize(v.input)).toBe(v.expected);
    });
  });

  // --- Edge cases ---

  it('canonicalizes null', () => {
    expect(Canonicalizer.canonicalize(null)).toBe('null');
  });

  it('canonicalizes boolean true', () => {
    expect(Canonicalizer.canonicalize(true)).toBe('true');
  });

  it('canonicalizes boolean false', () => {
    expect(Canonicalizer.canonicalize(false)).toBe('false');
  });

  it('canonicalizes empty object', () => {
    expect(Canonicalizer.canonicalize({})).toBe('{}');
  });

  it('canonicalizes empty array', () => {
    expect(Canonicalizer.canonicalize([])).toBe('[]');
  });

  it('canonicalizes empty string', () => {
    expect(Canonicalizer.canonicalize('')).toBe('""');
  });

  it('canonicalizes number zero', () => {
    expect(Canonicalizer.canonicalize(0)).toBe('0');
  });

  it('canonicalizes negative number', () => {
    expect(Canonicalizer.canonicalize(-42)).toBe('-42');
  });

  it('canonicalizes floating point number', () => {
    expect(Canonicalizer.canonicalize(3.14)).toBe('3.14');
  });

  it('sorts object keys alphabetically', () => {
    const result = Canonicalizer.canonicalize({ z: 1, a: 2, m: 3 });
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it('handles deeply nested objects', () => {
    const result = Canonicalizer.canonicalize({ b: { d: 1, c: 2 }, a: 3 });
    expect(result).toBe('{"a":3,"b":{"c":2,"d":1}}');
  });

  it('handles arrays with mixed types', () => {
    const result = Canonicalizer.canonicalize([1, 'two', true, null]);
    expect(result).toBe('[1,"two",true,null]');
  });

  it('handles string with special characters', () => {
    const result = Canonicalizer.canonicalize({ key: 'line1\nline2\ttab' });
    expect(result).toBe('{"key":"line1\\nline2\\ttab"}');
  });

  it('handles string with unicode', () => {
    const result = Canonicalizer.canonicalize({ emoji: '😀' });
    expect(result).toContain('emoji');
  });

  it('throws on undefined input', () => {
    expect(() => Canonicalizer.canonicalize(undefined)).toThrow('Cannot canonicalize input');
  });

  it('strips undefined values from objects (JSON.stringify behavior)', () => {
    // canonicalize uses JSON-based serialization, undefined properties get stripped
    const result = Canonicalizer.canonicalize({ a: 1, b: undefined });
    expect(result).toBe('{"a":1}');
  });

  it('preserves array element order', () => {
    const result = Canonicalizer.canonicalize([3, 1, 2]);
    expect(result).toBe('[3,1,2]');
  });

  it('returns consistent results across multiple calls', () => {
    const obj = { foo: 'bar', baz: [1, 2] };
    const r1 = Canonicalizer.canonicalize(obj);
    const r2 = Canonicalizer.canonicalize(obj);
    expect(r1).toBe(r2);
  });
});
