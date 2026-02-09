import type {
  AgentCard,
  Skill,
  Capabilities,
  Trust,
  Provider,
  EndpointProtocol,
  AgentEndpoint,
} from '../types/agent-card.js';
import type { P2TRAddress } from '../types/keys.js';
import type { MediaType } from '../types/part.js';

/** Fluent builder for constructing an AgentCard. */
export class AgentCardBuilder {
  private readonly card: Partial<AgentCard> = {};

  name(name: string): this {
    this.card.name = name;
    return this;
  }

  description(description: string): this {
    this.card.description = description;
    return this;
  }

  version(version: string): this {
    this.card.version = version;
    return this;
  }

  identity(address: P2TRAddress): this {
    this.card.identity = address;
    return this;
  }

  endpoint(protocol: EndpointProtocol, url: string): this {
    if (!this.card.endpoints) this.card.endpoints = [];
    this.card.endpoints.push({ protocol, url });
    return this;
  }

  nostrRelay(url: string): this {
    if (!this.card.nostrRelays) this.card.nostrRelays = [];
    this.card.nostrRelays.push(url);
    return this;
  }

  protocolVersion(version: string): this {
    this.card.protocolVersion = version;
    return this;
  }

  supportedVersion(version: string): this {
    if (!this.card.supportedVersions) this.card.supportedVersions = [];
    this.card.supportedVersions.push(version);
    return this;
  }

  capabilities(caps: Capabilities): this {
    this.card.capabilities = caps;
    return this;
  }

  skill(skill: Skill): this {
    if (!this.card.skills) this.card.skills = [];
    this.card.skills.push(skill);
    return this;
  }

  defaultInputModes(modes: MediaType[]): this {
    this.card.defaultInputModes = modes;
    return this;
  }

  defaultOutputModes(modes: MediaType[]): this {
    this.card.defaultOutputModes = modes;
    return this;
  }

  trust(trust: Trust): this {
    this.card.trust = trust;
    return this;
  }

  provider(provider: Provider): this {
    this.card.provider = provider;
    return this;
  }

  iconUrl(url: string): this {
    this.card.iconUrl = url;
    return this;
  }

  documentationUrl(url: string): this {
    this.card.documentationUrl = url;
    return this;
  }

  /** Build the AgentCard, validating that all required fields are set. */
  build(): AgentCard {
    const missing: string[] = [];
    if (!this.card.name) missing.push('name');
    if (!this.card.description) missing.push('description');
    if (!this.card.version) missing.push('version');
    if (!this.card.identity) missing.push('identity');
    if (!this.card.skills || this.card.skills.length === 0) missing.push('skills');
    if (!this.card.defaultInputModes || this.card.defaultInputModes.length === 0)
      missing.push('defaultInputModes');
    if (!this.card.defaultOutputModes || this.card.defaultOutputModes.length === 0)
      missing.push('defaultOutputModes');

    if (missing.length > 0) {
      throw new Error(`AgentCard missing required fields: ${missing.join(', ')}`);
    }

    return { ...this.card } as AgentCard;
  }
}
