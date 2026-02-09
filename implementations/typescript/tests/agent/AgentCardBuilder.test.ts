import { describe, it, expect } from 'vitest';
import { AgentCardBuilder } from '../../src/agent/AgentCardBuilder.js';
import type { P2TRAddress } from '../../src/types/keys.js';

const IDENTITY = 'bc1p5d7rjq7g6rdk2yhzqnt9dp8wvscrplqk0zwy63lmgreu9jzyt0mqf3xvn8' as P2TRAddress;

describe('AgentCardBuilder', () => {
  function minimalBuilder() {
    return new AgentCardBuilder()
      .name('Test Agent')
      .description('A test agent')
      .version('1.0.0')
      .identity(IDENTITY)
      .skill({
        id: 'echo',
        name: 'Echo',
        description: 'Echoes input',
        tags: ['test'],
      })
      .defaultInputModes(['text/plain'])
      .defaultOutputModes(['text/plain']);
  }

  it('builds a minimal valid AgentCard', () => {
    const card = minimalBuilder().build();
    expect(card.name).toBe('Test Agent');
    expect(card.description).toBe('A test agent');
    expect(card.version).toBe('1.0.0');
    expect(card.identity).toBe(IDENTITY);
    expect(card.skills).toHaveLength(1);
    expect(card.skills[0].id).toBe('echo');
    expect(card.defaultInputModes).toEqual(['text/plain']);
    expect(card.defaultOutputModes).toEqual(['text/plain']);
  });

  it('builds a card with endpoints', () => {
    const card = minimalBuilder()
      .endpoint('http', 'https://agent.example.com/snap')
      .endpoint('wss', 'wss://agent.example.com/snap')
      .build();

    expect(card.endpoints).toHaveLength(2);
    expect(card.endpoints![0]).toEqual({ protocol: 'http', url: 'https://agent.example.com/snap' });
    expect(card.endpoints![1]).toEqual({ protocol: 'wss', url: 'wss://agent.example.com/snap' });
  });

  it('builds a card with nostr relays', () => {
    const card = minimalBuilder()
      .nostrRelay('wss://relay.damus.io')
      .nostrRelay('wss://nos.lol')
      .build();

    expect(card.nostrRelays).toEqual(['wss://relay.damus.io', 'wss://nos.lol']);
  });

  it('builds a card with all optional fields', () => {
    const card = minimalBuilder()
      .endpoint('http', 'https://agent.example.com/snap')
      .nostrRelay('wss://relay.damus.io')
      .protocolVersion('0.1')
      .supportedVersion('0.1')
      .capabilities({ streaming: true, pushNotifications: false })
      .trust({ domain: 'agent.example.com' })
      .provider({ organization: 'Test Corp', url: 'https://test.com' })
      .iconUrl('https://test.com/icon.png')
      .documentationUrl('https://docs.test.com')
      .build();

    expect(card.protocolVersion).toBe('0.1');
    expect(card.supportedVersions).toEqual(['0.1']);
    expect(card.capabilities?.streaming).toBe(true);
    expect(card.trust?.domain).toBe('agent.example.com');
    expect(card.provider?.organization).toBe('Test Corp');
    expect(card.iconUrl).toBe('https://test.com/icon.png');
    expect(card.documentationUrl).toBe('https://docs.test.com');
  });

  it('accumulates multiple skills', () => {
    const card = minimalBuilder()
      .skill({
        id: 'code-gen',
        name: 'Code Generation',
        description: 'Generate code',
        tags: ['code'],
      })
      .build();

    expect(card.skills).toHaveLength(2);
  });

  it('accumulates multiple supported versions', () => {
    const card = minimalBuilder()
      .supportedVersion('0.1')
      .supportedVersion('0.2')
      .build();

    expect(card.supportedVersions).toEqual(['0.1', '0.2']);
  });

  it('throws when name is missing', () => {
    expect(() => {
      new AgentCardBuilder()
        .description('A test agent')
        .version('1.0.0')
        .identity(IDENTITY)
        .skill({ id: 'echo', name: 'Echo', description: 'Echoes', tags: ['test'] })
        .defaultInputModes(['text/plain'])
        .defaultOutputModes(['text/plain'])
        .build();
    }).toThrow('missing required fields: name');
  });

  it('throws when multiple required fields are missing', () => {
    expect(() => {
      new AgentCardBuilder().build();
    }).toThrow(/missing required fields/);
  });

  it('throws when skills array is empty', () => {
    expect(() => {
      new AgentCardBuilder()
        .name('Test')
        .description('Test')
        .version('1.0.0')
        .identity(IDENTITY)
        .defaultInputModes(['text/plain'])
        .defaultOutputModes(['text/plain'])
        .build();
    }).toThrow('skills');
  });

  it('returns a shallow copy (mutations do not affect builder state)', () => {
    const builder = minimalBuilder();
    const card1 = builder.build();
    const card2 = builder.build();
    expect(card1).toEqual(card2);
    expect(card1).not.toBe(card2);
  });

  // --- Edge case tests ---

  it('throws when description is missing', () => {
    expect(() => {
      new AgentCardBuilder()
        .name('Test')
        .version('1.0.0')
        .identity(IDENTITY)
        .skill({ id: 'echo', name: 'Echo', description: 'Echoes', tags: ['test'] })
        .defaultInputModes(['text/plain'])
        .defaultOutputModes(['text/plain'])
        .build();
    }).toThrow('missing required fields: description');
  });

  it('throws when version is missing', () => {
    expect(() => {
      new AgentCardBuilder()
        .name('Test')
        .description('Test')
        .identity(IDENTITY)
        .skill({ id: 'echo', name: 'Echo', description: 'Echoes', tags: ['test'] })
        .defaultInputModes(['text/plain'])
        .defaultOutputModes(['text/plain'])
        .build();
    }).toThrow('missing required fields: version');
  });

  it('throws when identity is missing', () => {
    expect(() => {
      new AgentCardBuilder()
        .name('Test')
        .description('Test')
        .version('1.0.0')
        .skill({ id: 'echo', name: 'Echo', description: 'Echoes', tags: ['test'] })
        .defaultInputModes(['text/plain'])
        .defaultOutputModes(['text/plain'])
        .build();
    }).toThrow('missing required fields: identity');
  });

  it('throws when defaultInputModes is missing', () => {
    expect(() => {
      new AgentCardBuilder()
        .name('Test')
        .description('Test')
        .version('1.0.0')
        .identity(IDENTITY)
        .skill({ id: 'echo', name: 'Echo', description: 'Echoes', tags: ['test'] })
        .defaultOutputModes(['text/plain'])
        .build();
    }).toThrow('defaultInputModes');
  });

  it('throws when defaultOutputModes is missing', () => {
    expect(() => {
      new AgentCardBuilder()
        .name('Test')
        .description('Test')
        .version('1.0.0')
        .identity(IDENTITY)
        .skill({ id: 'echo', name: 'Echo', description: 'Echoes', tags: ['test'] })
        .defaultInputModes(['text/plain'])
        .build();
    }).toThrow('defaultOutputModes');
  });

  it('lists all missing fields in error message', () => {
    expect(() => {
      new AgentCardBuilder().build();
    }).toThrow('name, description, version, identity, skills, defaultInputModes, defaultOutputModes');
  });

  it('optional fields are undefined when not set', () => {
    const card = minimalBuilder().build();
    expect(card.endpoints).toBeUndefined();
    expect(card.nostrRelays).toBeUndefined();
    expect(card.protocolVersion).toBeUndefined();
    expect(card.supportedVersions).toBeUndefined();
    expect(card.capabilities).toBeUndefined();
    expect(card.trust).toBeUndefined();
    expect(card.provider).toBeUndefined();
    expect(card.iconUrl).toBeUndefined();
    expect(card.documentationUrl).toBeUndefined();
  });

  it('builder methods are chainable (fluent API)', () => {
    const builder = new AgentCardBuilder();
    const result = builder
      .name('Test')
      .description('Test')
      .version('1.0.0')
      .identity(IDENTITY)
      .skill({ id: 'echo', name: 'Echo', description: 'Echoes', tags: ['test'] })
      .defaultInputModes(['text/plain'])
      .defaultOutputModes(['text/plain'])
      .endpoint('http', 'https://example.com')
      .nostrRelay('wss://relay.example.com')
      .protocolVersion('0.1')
      .supportedVersion('0.1')
      .capabilities({ streaming: true })
      .trust({ domain: 'example.com' })
      .provider({ organization: 'Test Corp' })
      .iconUrl('https://icon.png')
      .documentationUrl('https://docs.example.com');

    // Every method returns the same builder
    expect(result).toBe(builder);
  });

  it('can build multiple cards from one builder with incremental changes', () => {
    const builder = minimalBuilder();
    const card1 = builder.build();

    builder.endpoint('http', 'https://example.com/snap');
    const card2 = builder.build();

    // card1 should not have endpoint (not present when it was built)
    expect(card1.endpoints).toBeUndefined();
    // card2 should have the endpoint
    expect(card2.endpoints).toHaveLength(1);
  });

  it('supports multiple input and output modes', () => {
    const card = new AgentCardBuilder()
      .name('Multi-Mode')
      .description('Supports many modes')
      .version('1.0.0')
      .identity(IDENTITY)
      .skill({ id: 'process', name: 'Process', description: 'Process data', tags: ['data'] })
      .defaultInputModes(['text/plain', 'application/json', 'image/png'])
      .defaultOutputModes(['text/plain', 'application/json'])
      .build();

    expect(card.defaultInputModes).toEqual(['text/plain', 'application/json', 'image/png']);
    expect(card.defaultOutputModes).toEqual(['text/plain', 'application/json']);
  });

  it('skills preserve all fields', () => {
    const card = minimalBuilder()
      .skill({
        id: 'complex-skill',
        name: 'Complex Skill',
        description: 'A skill with many tags',
        tags: ['tag1', 'tag2', 'tag3'],
      })
      .build();

    const skill = card.skills.find((s) => s.id === 'complex-skill')!;
    expect(skill).toBeDefined();
    expect(skill.name).toBe('Complex Skill');
    expect(skill.description).toBe('A skill with many tags');
    expect(skill.tags).toEqual(['tag1', 'tag2', 'tag3']);
  });
});
