import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const canonicalizeFn = require('canonicalize') as (input: unknown) => string | undefined;

export class Canonicalizer {
  /**
   * Canonicalize a JSON-serializable object per RFC 8785 (JCS).
   * Returns the canonical JSON string.
   * @throws if input cannot be serialized.
   */
  static canonicalize(obj: unknown): string {
    const result = canonicalizeFn(obj);
    if (result === undefined) {
      throw new Error('Cannot canonicalize input: result is undefined');
    }
    return result;
  }
}
