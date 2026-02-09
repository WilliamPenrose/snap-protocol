import { describe, it, expect } from 'vitest';
import { MessageSigner } from '../../src/messaging/MessageSigner.js';
import { MessageBuilder } from '../../src/messaging/MessageBuilder.js';
import { MessageValidator } from '../../src/messaging/MessageValidator.js';
import { KeyManager } from '../../src/crypto/KeyManager.js';
import { loadSignatureVectors } from '../helpers/loadVectors.js';
import { randomBytes } from 'node:crypto';

const { valid } = loadSignatureVectors();

const TEST_KEY = '0000000000000000000000000000000000000000000000000000000000000001';

function buildTestMessage(signer: MessageSigner) {
  const addr = signer.getAddress();
  const addr2 = new MessageSigner('0000000000000000000000000000000000000000000000000000000000000002').getAddress();
  return new MessageBuilder()
    .id('msg-test')
    .from(addr)
    .to(addr2)
    .method('message/send')
    .payload({ message: { text: 'hi' } })
    .timestamp(Math.floor(Date.now() / 1000))
    .build();
}

describe('MessageSigner', () => {
  it('signs a message and produces correct signature', () => {
    const v = valid[0];
    const signer = new MessageSigner(v.privateKey);
    const signed = signer.sign(v.message);

    expect(signed.sig).toBe(v.expectedSignature);
    expect(signed.id).toBe(v.message.id);
  });

  it('signWithIntermediates returns both message and intermediates', () => {
    const v = valid[0];
    const signer = new MessageSigner(v.privateKey);
    const { message, intermediates } = signer.signWithIntermediates(v.message);

    expect(message.sig).toBe(v.expectedSignature);
    expect(intermediates.canonicalPayload).toBe(v.intermediates.canonicalPayload);
    expect(intermediates.sha256Hash).toBe(v.intermediates.sha256Hash);
  });

  it('getAddress returns correct P2TR address', () => {
    const v = valid[0];
    const signer = new MessageSigner(v.privateKey);
    expect(signer.getAddress()).toBe(v.message.from);
  });

  // --- auxRand tests ---

  it('produces different signatures with random auxRand', () => {
    const signer1 = new MessageSigner(TEST_KEY);
    const signer2 = new MessageSigner(TEST_KEY, { auxRand: randomBytes(32) });

    const msg = buildTestMessage(signer1);
    const signed1 = signer1.sign(msg);
    const signed2 = signer2.sign(msg);

    // Both signatures should be valid
    expect(MessageValidator.verifySignature(signed1)).toBe(true);
    expect(MessageValidator.verifySignature(signed2)).toBe(true);

    // But with different auxRand, signatures should differ
    // (unless the randomBytes happen to be all zeros, which is astronomically unlikely)
    expect(signed1.sig).not.toBe(signed2.sig);
  });

  it('deterministic signing (default) produces identical signatures', () => {
    const signer = new MessageSigner(TEST_KEY);
    const msg = buildTestMessage(signer);

    const signed1 = signer.sign(msg);
    const signed2 = signer.sign(msg);

    expect(signed1.sig).toBe(signed2.sig);
  });

  it('explicit zero auxRand matches default behavior', () => {
    const signerDefault = new MessageSigner(TEST_KEY);
    const signerZero = new MessageSigner(TEST_KEY, { auxRand: new Uint8Array(32) });

    const msg = buildTestMessage(signerDefault);
    const sig1 = signerDefault.sign(msg).sig;
    const sig2 = signerZero.sign(msg).sig;

    expect(sig1).toBe(sig2);
  });

  // --- Address for different networks ---

  it('getAddress supports testnet', () => {
    const signer = new MessageSigner(TEST_KEY);
    const testnetAddr = signer.getAddress('testnet');
    expect(testnetAddr).toMatch(/^tb1p/);
    expect(testnetAddr).toHaveLength(62);
  });

  it('getAddress defaults to mainnet', () => {
    const signer = new MessageSigner(TEST_KEY);
    const addr = signer.getAddress();
    expect(addr).toMatch(/^bc1p/);
  });

  // --- Sign produces complete SnapMessage ---

  it('sign returns message with all original fields plus sig', () => {
    const signer = new MessageSigner(TEST_KEY);
    const unsigned = buildTestMessage(signer);
    const signed = signer.sign(unsigned);

    expect(signed.id).toBe(unsigned.id);
    expect(signed.version).toBe(unsigned.version);
    expect(signed.from).toBe(unsigned.from);
    expect(signed.to).toBe(unsigned.to);
    expect(signed.type).toBe(unsigned.type);
    expect(signed.method).toBe(unsigned.method);
    expect(signed.payload).toEqual(unsigned.payload);
    expect(signed.timestamp).toBe(unsigned.timestamp);
    expect(signed.sig).toBeDefined();
    expect(signed.sig).toHaveLength(128);
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/);
  });

  it('signWithIntermediates includes all intermediate fields', () => {
    const signer = new MessageSigner(TEST_KEY);
    const unsigned = buildTestMessage(signer);
    const { intermediates } = signer.signWithIntermediates(unsigned);

    expect(intermediates.canonicalPayload).toBeDefined();
    expect(intermediates.signatureInput).toBeDefined();
    expect(intermediates.signatureInputHex).toBeDefined();
    expect(intermediates.sha256Hash).toBeDefined();
    // All should be non-empty strings
    expect(intermediates.canonicalPayload.length).toBeGreaterThan(0);
    expect(intermediates.signatureInput.length).toBeGreaterThan(0);
    expect(intermediates.signatureInputHex.length).toBeGreaterThan(0);
    expect(intermediates.sha256Hash).toHaveLength(64); // 32 bytes hex
  });
});
