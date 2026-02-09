import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { bech32m } from 'bech32';
import canonicalize from 'canonicalize';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..');

// ============================================================
// Helpers
// ============================================================

function bytesToBigInt(bytes) {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) + BigInt(byte);
  }
  return result;
}

function bigIntToBytes(num, length) {
  const bytes = new Uint8Array(length);
  let n = num;
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return bytes;
}

/**
 * Apply BIP-341 taproot tweak to an internal public key (key-path only, no script tree).
 * Returns the 32-byte x-only tweaked output key.
 */
function taprootTweak(internalPubKey) {
  const t = schnorr.utils.taggedHash('TapTweak', internalPubKey);
  const tScalar = bytesToBigInt(t);
  const n = schnorr.Point.Fn.ORDER;

  if (tScalar >= n) {
    throw new Error('Taproot tweak exceeds curve order');
  }

  const P = schnorr.utils.lift_x(bytesToBigInt(internalPubKey));
  const tG = schnorr.Point.BASE.multiply(tScalar);
  const Q = P.add(tG);
  const Qaff = Q.toAffine();
  return bigIntToBytes(Qaff.x, 32);
}

/**
 * Compute BIP-341 tweaked private key for signing.
 */
function tweakPrivateKey(privateKeyHex) {
  const privBytes = hexToBytes(privateKeyHex);
  let d = bytesToBigInt(privBytes);
  const n = schnorr.Point.Fn.ORDER;

  const P = schnorr.Point.BASE.multiply(d);
  const Paff = P.toAffine();

  if (Paff.y % 2n !== 0n) {
    d = n - d;
  }

  const internalPubKey = bigIntToBytes(Paff.x, 32);
  const t = schnorr.utils.taggedHash('TapTweak', internalPubKey);
  const tScalar = bytesToBigInt(t);

  if (tScalar >= n) {
    throw new Error('Taproot tweak exceeds curve order');
  }

  const tweakedD = (d + tScalar) % n;
  return bytesToHex(bigIntToBytes(tweakedD, 32));
}

/**
 * Encode an internal (untweaked) x-only public key as a P2TR address.
 * Applies BIP-341 taproot tweak before encoding.
 */
function pubkeyToP2TR(internalPubkey, prefix = 'bc') {
  const tweakedKey = taprootTweak(internalPubkey);
  const words = bech32m.toWords(tweakedKey);
  return bech32m.encode(prefix, [1, ...words]); // witness version 1
}

/**
 * Decode a P2TR address to its x-only public key hex (tweaked output key).
 */
function p2trToPubkeyHex(address) {
  const { words } = bech32m.decode(address);
  const data = bech32m.fromWords(words.slice(1));
  return bytesToHex(new Uint8Array(data));
}

function computeSignatureInput(message) {
  const parts = [
    message.id,
    message.from,
    message.to,
    message.type,
    message.method,
    canonicalize(message.payload),
    message.timestamp.toString()
  ];
  return parts.join('\x00');
}

/**
 * Sign a SNAP message using the BIP-341 tweaked private key.
 */
function signMessage(message, privateKey) {
  const tweakedKey = tweakPrivateKey(privateKey);
  const input = computeSignatureInput(message);
  const inputBytes = new TextEncoder().encode(input);
  const hash = sha256(inputBytes);
  const sig = schnorr.sign(hash, hexToBytes(tweakedKey), new Uint8Array(32));
  return {
    canonicalPayload: canonicalize(message.payload),
    signatureInput: input,
    signatureInputHex: bytesToHex(inputBytes),
    sha256Hash: bytesToHex(hash),
    signature: bytesToHex(sig)
  };
}

/**
 * Verify a SNAP message signature using the tweaked output key from the P2TR address.
 */
function verifyMessage(message, sig) {
  const input = computeSignatureInput(message);
  const inputBytes = new TextEncoder().encode(input);
  const hash = sha256(inputBytes);
  // Extract tweaked key from P2TR address
  const tweakedPubkey = hexToBytes(p2trToPubkeyHex(message.from));
  return schnorr.verify(hexToBytes(sig), hash, tweakedPubkey);
}

// ============================================================
// Generate Keys
// ============================================================

// Use deterministic private keys for reproducibility
const privateKeyA = '0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a';
const privateKeyB = '0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b';
const privateKeyC = '0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c';

// Internal (untweaked) x-only public keys
const pubkeyA = schnorr.getPublicKey(hexToBytes(privateKeyA));
const pubkeyB = schnorr.getPublicKey(hexToBytes(privateKeyB));
const pubkeyC = schnorr.getPublicKey(hexToBytes(privateKeyC));

// Tweaked output keys
const tweakedPubkeyA = taprootTweak(pubkeyA);
const tweakedPubkeyB = taprootTweak(pubkeyB);
const tweakedPubkeyC = taprootTweak(pubkeyC);

// P2TR addresses (encode tweaked keys per BIP-341)
const addressA = pubkeyToP2TR(pubkeyA);
const addressB = pubkeyToP2TR(pubkeyB);
const addressC = pubkeyToP2TR(pubkeyC);
const addressTestnet = pubkeyToP2TR(pubkeyC, 'tb');

console.log('Agent A:', addressA);
console.log('Agent B:', addressB);
console.log('Agent C (mainnet):', addressC);
console.log('Agent C (testnet):', addressTestnet);

// ============================================================
// 1. Key Encoding Vectors
// ============================================================

const keyVectors = {
  description: 'Key encoding test vectors for SNAP Protocol v0.1',
  version: '0.1',
  note: 'P2TR addresses encode the BIP-341 tweaked output key, not the internal key.',
  vectors: [
    {
      description: 'Agent A - mainnet',
      privateKey: privateKeyA,
      publicKeyXOnly: bytesToHex(pubkeyA),
      tweakedPublicKey: bytesToHex(tweakedPubkeyA),
      p2trAddress: addressA,
      nostrPubkeyHex: bytesToHex(pubkeyA),
      network: 'mainnet'
    },
    {
      description: 'Agent B - mainnet',
      privateKey: privateKeyB,
      publicKeyXOnly: bytesToHex(pubkeyB),
      tweakedPublicKey: bytesToHex(tweakedPubkeyB),
      p2trAddress: addressB,
      nostrPubkeyHex: bytesToHex(pubkeyB),
      network: 'mainnet'
    },
    {
      description: 'Agent C - mainnet',
      privateKey: privateKeyC,
      publicKeyXOnly: bytesToHex(pubkeyC),
      tweakedPublicKey: bytesToHex(tweakedPubkeyC),
      p2trAddress: addressC,
      nostrPubkeyHex: bytesToHex(pubkeyC),
      network: 'mainnet'
    },
    {
      description: 'Agent C - testnet (same key, different encoding)',
      privateKey: privateKeyC,
      publicKeyXOnly: bytesToHex(pubkeyC),
      tweakedPublicKey: bytesToHex(tweakedPubkeyC),
      p2trAddress: addressTestnet,
      nostrPubkeyHex: bytesToHex(pubkeyC),
      network: 'testnet'
    }
  ]
};

writeFileSync(
  join(outDir, 'keys', 'key-encoding.json'),
  JSON.stringify(keyVectors, null, 2) + '\n'
);
console.log('\n✓ keys/key-encoding.json');

// ============================================================
// 2. JCS Canonicalization Vectors
// ============================================================

const jcsVectors = {
  description: 'JCS (RFC 8785) canonicalization test vectors for SNAP payloads',
  version: '0.1',
  note: 'These test SNAP-specific payloads. For comprehensive JCS testing, see RFC 8785 Appendix B.',
  vectors: [
    {
      description: 'empty payload',
      input: {},
      expected: '{}'
    },
    {
      description: 'key ordering',
      input: { z: 'last', a: 'first', m: 'middle' },
      expected: canonicalize({ z: 'last', a: 'first', m: 'middle' })
    },
    {
      description: 'nested object key ordering',
      input: {
        message: {
          parts: [{ text: 'hello' }],
          role: 'user',
          messageId: 'inner-001'
        }
      },
      expected: canonicalize({
        message: {
          parts: [{ text: 'hello' }],
          role: 'user',
          messageId: 'inner-001'
        }
      })
    },
    {
      description: 'message/send request payload',
      input: {
        message: {
          messageId: 'inner-001',
          role: 'user',
          parts: [{ text: 'Write a login form in React' }]
        }
      },
      expected: canonicalize({
        message: {
          messageId: 'inner-001',
          role: 'user',
          parts: [{ text: 'Write a login form in React' }]
        }
      })
    },
    {
      description: 'payload with taskId (continuing a task)',
      input: {
        taskId: 'task-001',
        message: {
          messageId: 'inner-002',
          role: 'user',
          parts: [{ text: 'Add form validation' }]
        }
      },
      expected: canonicalize({
        taskId: 'task-001',
        message: {
          messageId: 'inner-002',
          role: 'user',
          parts: [{ text: 'Add form validation' }]
        }
      })
    },
    {
      description: 'tasks/get request payload',
      input: { taskId: 'task-001', historyLength: 10 },
      expected: canonicalize({ taskId: 'task-001', historyLength: 10 })
    },
    {
      description: 'unicode content in payload',
      input: {
        message: {
          messageId: 'inner-003',
          role: 'user',
          parts: [{ text: 'Translate to Chinese: 你好世界' }]
        }
      },
      expected: canonicalize({
        message: {
          messageId: 'inner-003',
          role: 'user',
          parts: [{ text: 'Translate to Chinese: 你好世界' }]
        }
      })
    }
  ]
};

writeFileSync(
  join(outDir, 'canonical', 'jcs-payloads.json'),
  JSON.stringify(jcsVectors, null, 2) + '\n'
);
console.log('✓ canonical/jcs-payloads.json');

// ============================================================
// 3. Signature Vectors
// ============================================================

const signatureMessages = [
  {
    description: 'message/send with empty payload',
    message: {
      id: 'msg-001',
      version: '0.1',
      from: addressA,
      to: addressB,
      type: 'request',
      method: 'message/send',
      payload: {},
      timestamp: 1738627200
    },
    privateKey: privateKeyA
  },
  {
    description: 'message/send with text message',
    message: {
      id: 'msg-002',
      version: '0.1',
      from: addressA,
      to: addressB,
      type: 'request',
      method: 'message/send',
      payload: {
        message: {
          messageId: 'inner-001',
          role: 'user',
          parts: [{ text: 'Write a login form in React' }]
        }
      },
      timestamp: 1738627200
    },
    privateKey: privateKeyA
  },
  {
    description: 'tasks/get request',
    message: {
      id: 'msg-003',
      version: '0.1',
      from: addressA,
      to: addressB,
      type: 'request',
      method: 'tasks/get',
      payload: {
        taskId: 'task-001',
        historyLength: 10
      },
      timestamp: 1738627200
    },
    privateKey: privateKeyA
  },
  {
    description: 'tasks/cancel request',
    message: {
      id: 'msg-004',
      version: '0.1',
      from: addressA,
      to: addressB,
      type: 'request',
      method: 'tasks/cancel',
      payload: {
        taskId: 'task-001'
      },
      timestamp: 1738627200
    },
    privateKey: privateKeyA
  },
  {
    description: 'response message (signed)',
    message: {
      id: 'msg-005',
      version: '0.1',
      from: addressB,
      to: addressA,
      type: 'response',
      method: 'message/send',
      payload: {
        task: {
          id: 'task-001',
          status: {
            state: 'completed',
            timestamp: '2025-02-04T10:00:05Z'
          }
        }
      },
      timestamp: 1738627205
    },
    privateKey: privateKeyB
  },
  {
    description: 'message with unicode payload',
    message: {
      id: 'msg-006',
      version: '0.1',
      from: addressA,
      to: addressB,
      type: 'request',
      method: 'message/send',
      payload: {
        message: {
          messageId: 'inner-006',
          role: 'user',
          parts: [{ text: 'Translate: 你好世界 🌍' }]
        }
      },
      timestamp: 1738627200
    },
    privateKey: privateKeyA
  },
  {
    description: 'message/send continuing a task',
    message: {
      id: 'msg-007',
      version: '0.1',
      from: addressA,
      to: addressB,
      type: 'request',
      method: 'message/send',
      payload: {
        taskId: 'task-001',
        message: {
          messageId: 'inner-007',
          role: 'user',
          parts: [{ text: 'Add form validation' }]
        }
      },
      timestamp: 1738627210
    },
    privateKey: privateKeyA
  }
];

const signatureVectors = {
  description: 'Schnorr signature test vectors for SNAP Protocol v0.1',
  version: '0.1',
  algorithm: 'BIP-340 Schnorr over secp256k1',
  note: 'Messages are signed with BIP-341 tweaked private keys. Verification uses the tweaked output key extracted from the P2TR address.',
  canonicalization: 'JCS (RFC 8785) for payload, NULL byte (0x00) separator',
  hashFunction: 'SHA-256',
  valid: [],
  invalid: []
};

// Generate valid signature vectors
for (const v of signatureMessages) {
  const result = signMessage(v.message, v.privateKey);

  // Verify our own signature
  const isValid = verifyMessage(v.message, result.signature);
  if (!isValid) {
    throw new Error(`Self-verification failed for: ${v.description}`);
  }

  const internalPubKey = bytesToHex(schnorr.getPublicKey(hexToBytes(v.privateKey)));
  const tweakedPubKey = bytesToHex(taprootTweak(hexToBytes(internalPubKey)));

  signatureVectors.valid.push({
    description: v.description,
    privateKey: v.privateKey,
    internalPublicKey: internalPubKey,
    tweakedPublicKey: tweakedPubKey,
    message: v.message,
    intermediates: {
      canonicalPayload: result.canonicalPayload,
      signatureInput: result.signatureInput,
      signatureInputHex: result.signatureInputHex,
      sha256Hash: result.sha256Hash
    },
    expectedSignature: result.signature
  });
}

// Generate invalid signature vectors
// 1. Tampered message (changed payload after signing)
{
  const msg = {
    id: 'msg-invalid-001',
    version: '0.1',
    from: addressA,
    to: addressB,
    type: 'request',
    method: 'message/send',
    payload: {
      message: {
        messageId: 'inner-001',
        role: 'user',
        parts: [{ text: 'Original message' }]
      }
    },
    timestamp: 1738627200
  };

  const result = signMessage(msg, privateKeyA);

  // Tamper the payload
  const tamperedMsg = JSON.parse(JSON.stringify(msg));
  tamperedMsg.payload.message.parts[0].text = 'Tampered message';

  signatureVectors.invalid.push({
    description: 'tampered payload (text changed after signing)',
    message: tamperedMsg,
    signature: result.signature,
    tweakedPublicKey: bytesToHex(tweakedPubkeyA),
    reason: 'Payload was modified after signing. Signature was computed over the original payload.'
  });
}

// 2. Wrong sender key
{
  const msg = {
    id: 'msg-invalid-002',
    version: '0.1',
    from: addressA,  // Claims to be from A
    to: addressB,
    type: 'request',
    method: 'message/send',
    payload: {},
    timestamp: 1738627200
  };

  // But signed with B's key
  const result = signMessage(msg, privateKeyB);

  signatureVectors.invalid.push({
    description: 'wrong signing key (from=A but signed with B\'s key)',
    message: msg,
    signature: result.signature,
    tweakedPublicKey: bytesToHex(tweakedPubkeyA),
    reason: 'Message claims from=Agent A but was signed with Agent B\'s tweaked private key. Verification with A\'s tweaked public key fails.'
  });
}

// 3. Tampered timestamp
{
  const msg = {
    id: 'msg-invalid-003',
    version: '0.1',
    from: addressA,
    to: addressB,
    type: 'request',
    method: 'message/send',
    payload: {},
    timestamp: 1738627200
  };

  const result = signMessage(msg, privateKeyA);

  const tamperedMsg = JSON.parse(JSON.stringify(msg));
  tamperedMsg.timestamp = 1738627999;

  signatureVectors.invalid.push({
    description: 'tampered timestamp',
    message: tamperedMsg,
    signature: result.signature,
    tweakedPublicKey: bytesToHex(tweakedPubkeyA),
    reason: 'Timestamp was changed from 1738627200 to 1738627999 after signing.'
  });
}

writeFileSync(
  join(outDir, 'signatures', 'schnorr-signatures.json'),
  JSON.stringify(signatureVectors, null, 2) + '\n'
);
console.log('✓ signatures/schnorr-signatures.json');

// ============================================================
// Summary
// ============================================================

console.log('\n--- Summary ---');
console.log(`Key encoding vectors:    ${keyVectors.vectors.length}`);
console.log(`JCS vectors:             ${jcsVectors.vectors.length}`);
console.log(`Valid signature vectors:  ${signatureVectors.valid.length}`);
console.log(`Invalid signature vectors: ${signatureVectors.invalid.length}`);
console.log(`Total:                   ${keyVectors.vectors.length + jcsVectors.vectors.length + signatureVectors.valid.length + signatureVectors.invalid.length}`);
