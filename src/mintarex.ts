import { MintarexClient } from './client.js';
import type { ClientOptions } from './client.js';
import { AccountResource } from './resources/account.js';
import { CryptoResource } from './resources/crypto.js';
import { PublicResource } from './resources/publicMarket.js';
import { RFQResource } from './resources/rfq.js';
import { TradesResource } from './resources/trades.js';
import { WebhooksResource } from './resources/webhooks.js';
import { StreamsResource } from './streams.js';

/**
 * Top-level Mintarex SDK client. Construct once per API key and reuse
 * across requests. Thread-safe within a single Node.js process.
 *
 * @example
 * ```ts
 * import { Mintarex } from '@mintarex-official/node';
 *
 * const mx = new Mintarex({
 *   apiKey: process.env.MX_KEY!,
 *   apiSecret: process.env.MX_SECRET!,
 * });
 *
 * const balances = await mx.account.balances();
 * ```
 */
export class Mintarex {
  public readonly client: MintarexClient;
  public readonly account: AccountResource;
  public readonly rfq: RFQResource;
  public readonly trades: TradesResource;
  public readonly crypto: CryptoResource;
  public readonly webhooks: WebhooksResource;
  public readonly streams: StreamsResource;
  public readonly public: PublicResource;

  public constructor(options: ClientOptions) {
    this.client = new MintarexClient(options);
    this.account = new AccountResource(this.client);
    this.rfq = new RFQResource(this.client);
    this.trades = new TradesResource(this.client);
    this.crypto = new CryptoResource(this.client);
    this.webhooks = new WebhooksResource(this.client);
    this.streams = new StreamsResource(this.client);
    this.public = new PublicResource(this.client);
  }

  /** Alias for the current environment. */
  public get environment(): 'live' | 'sandbox' {
    return this.client.environment;
  }
}
