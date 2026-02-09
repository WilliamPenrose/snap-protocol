import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS_DIR = resolve(__dirname, '..', '..', '..', '..', 'test-vectors');

export function loadKeyVectors() {
  return JSON.parse(readFileSync(resolve(VECTORS_DIR, 'keys', 'key-encoding.json'), 'utf-8'));
}

export function loadJcsVectors() {
  return JSON.parse(readFileSync(resolve(VECTORS_DIR, 'canonical', 'jcs-payloads.json'), 'utf-8'));
}

export function loadSignatureVectors() {
  return JSON.parse(
    readFileSync(resolve(VECTORS_DIR, 'signatures', 'schnorr-signatures.json'), 'utf-8'),
  );
}
