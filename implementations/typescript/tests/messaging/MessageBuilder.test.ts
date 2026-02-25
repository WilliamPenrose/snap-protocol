import { describe, it, expect } from 'vitest';
import { MessageBuilder } from '../../src/messaging/MessageBuilder.js';

const VALID_ADDR_A = 'bc1p7a4rn5zksm3553pq39lrtym3sds5thfew03esftgkc8cgvadmehqjzn7u9';
const VALID_ADDR_B = 'bc1p25kxxzmyk49l2qsse83985ut6j2fcuhz9pe4qrmzshptah3392zqg5d69h';

describe('MessageBuilder', () => {
  it('builds a valid unsigned message', () => {
    const msg = new MessageBuilder()
      .id('msg-001')
      .from(VALID_ADDR_A)
      .to(VALID_ADDR_B)
      .method('message/send')
      .payload({ message: { text: 'hello' } })
      .timestamp(1738627200)
      .build();

    expect(msg.id).toBe('msg-001');
    expect(msg.version).toBe('0.1');
    expect(msg.type).toBe('request');
    expect(msg.method).toBe('message/send');
  });

  it('throws when required fields are missing', () => {
    expect(() => new MessageBuilder().build()).toThrow('id is required');
    expect(() => new MessageBuilder().id('x').build()).toThrow('from is required');
  });

  it('supports fluent chaining', () => {
    const builder = new MessageBuilder();
    const result = builder.id('x').from(VALID_ADDR_A);
    expect(result).toBe(builder);
  });

  // --- Detailed required field validation ---

  it('builds without to (Agent-to-Service)', () => {
    const msg = new MessageBuilder().id('x').from(VALID_ADDR_A).method('service/call').timestamp(1000).build();
    expect(msg.to).toBeUndefined();
  });

  it('throws when method is missing', () => {
    expect(() =>
      new MessageBuilder().id('x').from(VALID_ADDR_A).to(VALID_ADDR_B).build(),
    ).toThrow('method is required');
  });

  it('throws when timestamp is missing', () => {
    expect(() =>
      new MessageBuilder()
        .id('x')
        .from(VALID_ADDR_A)
        .to(VALID_ADDR_B)
        .method('message/send')
        .build(),
    ).toThrow('timestamp is required');
  });

  // --- Default values ---

  it('defaults version to 0.1', () => {
    const msg = new MessageBuilder()
      .id('x')
      .from(VALID_ADDR_A)
      .to(VALID_ADDR_B)
      .method('message/send')
      .timestamp(1000)
      .build();
    expect(msg.version).toBe('0.1');
  });

  it('defaults type to request', () => {
    const msg = new MessageBuilder()
      .id('x')
      .from(VALID_ADDR_A)
      .to(VALID_ADDR_B)
      .method('message/send')
      .timestamp(1000)
      .build();
    expect(msg.type).toBe('request');
  });

  it('defaults payload to empty object', () => {
    const msg = new MessageBuilder()
      .id('x')
      .from(VALID_ADDR_A)
      .to(VALID_ADDR_B)
      .method('message/send')
      .timestamp(1000)
      .build();
    expect(msg.payload).toEqual({});
  });

  // --- Overwriting fields ---

  it('allows overwriting fields via repeated calls', () => {
    const msg = new MessageBuilder()
      .id('first')
      .id('second')
      .from(VALID_ADDR_A)
      .to(VALID_ADDR_B)
      .method('message/send')
      .timestamp(1000)
      .build();
    expect(msg.id).toBe('second');
  });

  it('allows overwriting version', () => {
    const msg = new MessageBuilder()
      .id('x')
      .from(VALID_ADDR_A)
      .to(VALID_ADDR_B)
      .method('message/send')
      .version('1.0')
      .timestamp(1000)
      .build();
    expect(msg.version).toBe('1.0');
  });

  it('allows setting type to response', () => {
    const msg = new MessageBuilder()
      .id('x')
      .from(VALID_ADDR_A)
      .to(VALID_ADDR_B)
      .method('message/send')
      .type('response')
      .timestamp(1000)
      .build();
    expect(msg.type).toBe('response');
  });

  it('allows setting type to event', () => {
    const msg = new MessageBuilder()
      .id('x')
      .from(VALID_ADDR_A)
      .to(VALID_ADDR_B)
      .method('message/send')
      .type('event')
      .timestamp(1000)
      .build();
    expect(msg.type).toBe('event');
  });

  // --- Mutation isolation ---

  it('build produces independent message objects', () => {
    const builder = new MessageBuilder()
      .id('x')
      .from(VALID_ADDR_A)
      .to(VALID_ADDR_B)
      .method('message/send')
      .payload({ key: 'value1' })
      .timestamp(1000);

    const msg1 = builder.build();
    builder.payload({ key: 'value2' });
    const msg2 = builder.build();

    expect(msg1.payload).toEqual({ key: 'value1' });
    expect(msg2.payload).toEqual({ key: 'value2' });
  });

  it('builder can be reused after build', () => {
    const builder = new MessageBuilder()
      .id('x')
      .from(VALID_ADDR_A)
      .to(VALID_ADDR_B)
      .method('message/send')
      .timestamp(1000);

    const msg1 = builder.build();
    const msg2 = builder.id('y').build();

    expect(msg1.id).toBe('x');
    expect(msg2.id).toBe('y');
  });

  // --- Payload variations ---

  it('builds with nested payload', () => {
    const msg = new MessageBuilder()
      .id('x')
      .from(VALID_ADDR_A)
      .to(VALID_ADDR_B)
      .method('message/send')
      .payload({ deep: { nested: { value: 42 } } })
      .timestamp(1000)
      .build();
    expect((msg.payload as any).deep.nested.value).toBe(42);
  });

  it('builds with zero timestamp', () => {
    const msg = new MessageBuilder()
      .id('x')
      .from(VALID_ADDR_A)
      .to(VALID_ADDR_B)
      .method('message/send')
      .timestamp(0)
      .build();
    expect(msg.timestamp).toBe(0);
  });

  // --- All setters return this ---

  it('all setter methods return this for chaining', () => {
    const b = new MessageBuilder();
    expect(b.id('x')).toBe(b);
    expect(b.version('0.1')).toBe(b);
    expect(b.from(VALID_ADDR_A)).toBe(b);
    expect(b.to(VALID_ADDR_B)).toBe(b);
    expect(b.type('request')).toBe(b);
    expect(b.method('message/send')).toBe(b);
    expect(b.payload({})).toBe(b);
    expect(b.timestamp(0)).toBe(b);
  });
});
