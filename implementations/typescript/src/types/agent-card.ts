import type { P2TRAddress } from './keys.js';
import type { MediaType } from './part.js';

/** A capability that the agent provides. */
export interface Skill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
  inputModes?: MediaType[];
  outputModes?: MediaType[];
}

/** Rate limiting policy declared in the Agent Card. */
export interface RateLimit {
  maxRequests: number;
  windowSeconds: number;
}

/** Optional feature flags for an agent. */
export interface Capabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  rateLimit?: RateLimit;
}

/** Domain verification for trust anchoring. */
export interface Trust {
  domain: string;
}

/** Organization operating the agent. */
export interface Provider {
  organization?: string;
  url?: string;
}

/** Transport protocol type for an agent endpoint. */
export type EndpointProtocol = 'http' | 'wss';

/** A transport endpoint declared in the Agent Card. */
export interface AgentEndpoint {
  protocol: EndpointProtocol;
  url: string;
}

/** Describes an agent's identity, capabilities, and how to communicate with it. */
export interface AgentCard {
  name: string;
  description: string;
  version: string;
  identity: P2TRAddress;
  endpoints?: AgentEndpoint[];
  nostrRelays?: string[];
  protocolVersion?: string;
  supportedVersions?: string[];
  capabilities?: Capabilities;
  skills: Skill[];
  defaultInputModes: MediaType[];
  defaultOutputModes: MediaType[];
  trust?: Trust;
  provider?: Provider;
  iconUrl?: string;
  documentationUrl?: string;
}
