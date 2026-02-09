import {
  SimplePool,
  finalizeEvent,
  getPublicKey,
  type Event as NostrEvent,
  type EventTemplate,
  type Filter,
} from 'nostr-tools';
import { useWebSocketImplementation } from 'nostr-tools/pool';
import * as nip44 from 'nostr-tools/nip44';
import { hexToBytes } from '@noble/hashes/utils';
import WebSocket from 'ws';
import type { SnapMessage } from '../types/message.js';
import type { TransportPlugin, TransportSendOptions, TransportLogger } from '../types/plugin.js';
import type { P2TRAddress } from '../types/keys.js';
import type { AgentCard } from '../types/agent-card.js';
import { KeyManager } from '../crypto/KeyManager.js';

/** Nostr event kind for storable SNAP messages (regular range, persisted by relays). */
export const SNAP_MESSAGE_KIND = 4339;

/** Nostr event kind for ephemeral SNAP messages (NIP-16 range, forwarded but not stored). */
export const SNAP_EPHEMERAL_MESSAGE_KIND = 21339;

/** Default Nostr event kind for agent card publication (replaceable). */
export const SNAP_AGENT_CARD_KIND = 31337;

export interface NostrTransportConfig {
  /** Nostr relay URLs to connect to. */
  relays: string[];
  /** Private key (hex) for signing Nostr events and NIP-44 encryption. */
  privateKey: string;
  /** Request timeout in ms (default: 30000). */
  timeout?: number;
  /** Nostr event kind for ephemeral messages (default: 21339). Used for real-time send(). */
  messageKind?: number;
  /** Nostr event kind for storable messages (default: 4339). Used when persist=true and for fetchOfflineMessages(). */
  storableMessageKind?: number;
  /** Nostr event kind for agent cards (default: 31337). */
  agentCardKind?: number;
  /** Lookback window in seconds for response subscription (default: 5). */
  responseLookbackSeconds?: number;
  /** Optional logger for diagnostic events. */
  logger?: TransportLogger;
  /** Optional HTTP headers to send with WebSocket connections (e.g. User-Agent). Node.js only. */
  headers?: Record<string, string>;
}

export interface AgentDiscoveryFilter {
  skills?: string[];
  identity?: P2TRAddress;
  name?: string;
}

/** Nostr transport: encrypted messaging via relays + agent card discovery. */
export class NostrTransport implements TransportPlugin {
  readonly name = 'nostr';

  private readonly config: Required<Pick<NostrTransportConfig, 'relays' | 'privateKey' | 'timeout' | 'messageKind' | 'storableMessageKind' | 'agentCardKind' | 'responseLookbackSeconds'>> & { logger?: TransportLogger };
  private readonly pool: SimplePool;
  private readonly pubkey: string;
  private readonly secretKeyBytes: Uint8Array;
  private subscriptionCloser: { close: () => void } | null = null;
  /** Cache of P2TR address → internal (untweaked) Nostr pubkey hex. Populated by discoverAgents(). */
  private readonly internalKeyCache = new Map<string, string>();

  constructor(config: NostrTransportConfig) {
    this.config = {
      ...config,
      timeout: config.timeout ?? 30_000,
      messageKind: config.messageKind ?? SNAP_EPHEMERAL_MESSAGE_KIND,
      storableMessageKind: config.storableMessageKind ?? SNAP_MESSAGE_KIND,
      agentCardKind: config.agentCardKind ?? SNAP_AGENT_CARD_KIND,
      responseLookbackSeconds: config.responseLookbackSeconds ?? 5,
      logger: config.logger,
    };

    // Inject custom WebSocket class with headers if configured.
    // useWebSocketImplementation sets a module-level variable captured by SimplePool at construction time.
    if (config.headers && Object.keys(config.headers).length > 0) {
      const headers = config.headers;
      const WSWithHeaders = class extends WebSocket {
        constructor(url: string | URL) {
          super(url, { headers });
        }
      };
      useWebSocketImplementation(WSWithHeaders);
    } else {
      useWebSocketImplementation(WebSocket);
    }

    this.pool = new SimplePool();
    this.secretKeyBytes = hexToBytes(config.privateKey);
    this.pubkey = getPublicKey(this.secretKeyBytes);
  }

  /**
   * Send an encrypted SNAP message to another agent via Nostr.
   * The recipient's internal (untweaked) Nostr pubkey is required for NIP-44 encryption.
   * Provide it via options.nostrPubkey, or it will be looked up from the internal cache
   * (populated by discoverAgents()).
   */
  async send(message: SnapMessage, options: TransportSendOptions): Promise<SnapMessage> {
    const recipientPubkey = options.nostrPubkey
      ?? this.internalKeyCache.get(message.to);

    if (!recipientPubkey) {
      throw new Error(
        `Cannot determine Nostr pubkey for recipient ${message.to}. ` +
        'Discover the agent first via discoverAgents(), or provide nostrPubkey in send options.',
      );
    }

    const conversationKey = nip44.v2.utils.getConversationKey(this.secretKeyBytes, recipientPubkey);
    const encrypted = nip44.v2.encrypt(JSON.stringify(message), conversationKey);

    const eventKind = options.persist
      ? this.config.storableMessageKind
      : this.config.messageKind;

    const eventTemplate: EventTemplate = {
      kind: eventKind,
      tags: [['p', recipientPubkey]],  // Use internal key for Nostr routing
      content: encrypted,
      created_at: Math.floor(Date.now() / 1000),
    };

    const signed = finalizeEvent(eventTemplate, this.secretKeyBytes);

    // Subscribe for response FIRST, then publish the request.
    // finalizeEvent() computes the event ID before publishing, so we can
    // use '#e' to filter for responses referencing this specific request.
    // This prevents both:
    // - Race condition: fast responders reply before subscription is set up
    // - Stale responses: '#e' ensures only THIS request's response is matched
    return new Promise<SnapMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        sub.close();
        reject(new Error('Nostr response timed out'));
      }, options.timeout ?? this.config.timeout);

      const filter: Filter = {
        kinds: [...new Set([this.config.messageKind, this.config.storableMessageKind])],
        '#p': [this.pubkey],
        '#e': [signed.id],
        since: Math.floor(Date.now() / 1000) - this.config.responseLookbackSeconds,
      };

      const sub = this.pool.subscribeMany(this.config.relays, filter, {
        onevent: (event: NostrEvent) => {
          try {
            const senderConvKey = nip44.v2.utils.getConversationKey(
              this.secretKeyBytes,
              event.pubkey,
            );
            const decrypted = nip44.v2.decrypt(event.content, senderConvKey);
            const response = JSON.parse(decrypted) as SnapMessage;

            // Verify that the SNAP message `from` matches the Nostr event pubkey
            const expectedAddress = KeyManager.publicKeyToP2TR(event.pubkey);
            if (response.from !== expectedAddress) {
              this.config.logger?.('warn', `Identity mismatch in response: SNAP from=${response.from} but Nostr pubkey maps to ${expectedAddress}`);
              return;
            }

            if (response.type === 'response') {
              clearTimeout(timeout);
              sub.close();
              resolve(response);
            }
          } catch (err) {
            this.config.logger?.('debug', 'Failed to decrypt/parse Nostr event in send()', err);
          }
        },
      });

      // Publish AFTER subscription is set up
      this.publishToRelays(signed).catch((err) => {
        clearTimeout(timeout);
        sub.close();
        reject(err);
      });
    });
  }

  /** Subscribe to incoming SNAP messages. */
  async listen(
    handler: (message: SnapMessage) => Promise<SnapMessage | void>,
  ): Promise<void> {
    const filter: Filter = {
      kinds: [...new Set([this.config.messageKind, this.config.storableMessageKind])],
      '#p': [this.pubkey],
      since: Math.floor(Date.now() / 1000),
    };

    this.subscriptionCloser = this.pool.subscribeMany(this.config.relays, filter, {
      onevent: async (event: NostrEvent) => {
        try {
          const conversationKey = nip44.v2.utils.getConversationKey(
            this.secretKeyBytes,
            event.pubkey,
          );
          const decrypted = nip44.v2.decrypt(event.content, conversationKey);
          const inbound = JSON.parse(decrypted) as SnapMessage;

          // Skip non-request messages (responses are handled by send()'s subscription)
          if (inbound.type !== 'request') {
            this.config.logger?.('debug', `listen() ignoring ${inbound.type} message ${inbound.id}`);
            return;
          }

          // Verify that the SNAP message `from` matches the Nostr event pubkey
          const expectedAddress = KeyManager.publicKeyToP2TR(event.pubkey);
          if (inbound.from !== expectedAddress) {
            this.config.logger?.('warn', `Identity mismatch: SNAP from=${inbound.from} but Nostr pubkey maps to ${expectedAddress}`);
            return;
          }

          const response = await handler(inbound);

          if (response) {
            const respEncrypted = nip44.v2.encrypt(JSON.stringify(response), conversationKey);

            const respEvent: EventTemplate = {
              kind: event.kind,  // Mirror the request's kind (ephemeral or storable)
              tags: [['p', event.pubkey], ['e', event.id]],
              content: respEncrypted,
              created_at: Math.floor(Date.now() / 1000),
            };

            const signed = finalizeEvent(respEvent, this.secretKeyBytes);
            try {
              await this.publishToRelays(signed);
            } catch (err) {
              this.config.logger?.('warn', 'Failed to publish response to relays', err);
            }
          }
        } catch (err) {
          this.config.logger?.('warn', 'Failed to process inbound Nostr message', err);
        }
      },
    });
  }

  /** Publish an agent card as a Nostr replaceable event (kind 31337). */
  async publishAgentCard(card: AgentCard): Promise<void> {
    const tags: string[][] = [
      ['d', card.identity],
      ['name', card.name],
      ['version', card.version],
    ];

    for (const skill of card.skills) {
      tags.push(['skill', skill.id, skill.name]);
    }

    if (card.endpoints) {
      for (const ep of card.endpoints) {
        tags.push(['endpoint', ep.protocol, ep.url]);
      }
    }

    if (card.nostrRelays) {
      for (const relay of card.nostrRelays) {
        tags.push(['relay', relay]);
      }
    }

    const eventTemplate: EventTemplate = {
      kind: this.config.agentCardKind,
      tags,
      content: JSON.stringify(card),
      created_at: Math.floor(Date.now() / 1000),
    };

    const signed = finalizeEvent(eventTemplate, this.secretKeyBytes);
    await this.publishToRelays(signed);
  }

  /** Query Nostr relays for agent cards matching the filter. */
  async discoverAgents(filter: AgentDiscoveryFilter): Promise<AgentCard[]> {
    const nostrFilter: Filter = {
      kinds: [this.config.agentCardKind],
    };

    if (filter.identity) {
      nostrFilter['#d'] = [filter.identity];
    }

    if (filter.skills) {
      nostrFilter['#skill'] = filter.skills;
    }

    if (filter.name) {
      nostrFilter['#name'] = [filter.name];
    }

    const events = await this.pool.querySync(this.config.relays, nostrFilter);

    return events.map((event) => {
      try {
        const card = JSON.parse(event.content) as AgentCard;

        // Cache the P2TR address → internal Nostr pubkey mapping for NIP-44 encryption
        if (card.identity) {
          this.internalKeyCache.set(card.identity, event.pubkey);
        }

        return card;
      } catch (err) {
        this.config.logger?.('warn', 'Failed to parse agent card from Nostr event', err);
        return null;
      }
    }).filter((card): card is AgentCard => card !== null);
  }

  /** Fetch offline messages since a given unix timestamp. */
  async fetchOfflineMessages(since: number): Promise<SnapMessage[]> {
    const filter: Filter = {
      kinds: [this.config.storableMessageKind],
      '#p': [this.pubkey],
      since,
    };

    const events = await this.pool.querySync(this.config.relays, filter);
    const messages: SnapMessage[] = [];

    for (const event of events) {
      try {
        const conversationKey = nip44.v2.utils.getConversationKey(
          this.secretKeyBytes,
          event.pubkey,
        );
        const decrypted = nip44.v2.decrypt(event.content, conversationKey);
        const parsed = JSON.parse(decrypted) as SnapMessage;

        // Verify that the SNAP message `from` matches the Nostr event pubkey
        const expectedAddress = KeyManager.publicKeyToP2TR(event.pubkey);
        if (parsed.from !== expectedAddress) {
          this.config.logger?.('warn', `Identity mismatch in offline message: SNAP from=${parsed.from} but Nostr pubkey maps to ${expectedAddress}`);
          continue;
        }

        messages.push(parsed);
      } catch (err) {
        this.config.logger?.('debug', 'Skipping undecryptable offline message', err);
      }
    }

    return messages;
  }

  /**
   * Publish a signed Nostr event to all configured relays.
   * Throws if no relay accepts the event.
   */
  private async publishToRelays(event: NostrEvent): Promise<void> {
    const results = await Promise.allSettled(
      this.pool.publish(this.config.relays, event),
    );

    const successes = results.filter(r => r.status === 'fulfilled');
    if (successes.length === 0) {
      const errors = results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map(r => String(r.reason));
      throw new Error(
        `Failed to publish to any relay: ${errors.join('; ')}`,
      );
    }

    this.config.logger?.('debug', `Published to ${successes.length}/${this.config.relays.length} relays`);
  }

  /** Close all relay connections and subscriptions. */
  async close(): Promise<void> {
    this.subscriptionCloser?.close();
    this.subscriptionCloser = null;
    this.pool.destroy();
  }
}
