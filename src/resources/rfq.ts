import { randomUUID } from 'node:crypto';
import type { MintarexClient } from '../client.js';
import {
  assertAmount,
  assertAmountType,
  assertCoin,
  assertCurrencyCode,
  assertIdempotencyKey,
  assertNetwork,
  assertSide,
  assertUuid,
} from '../validate.js';
import type { Quote, QuoteRequest, TradeExecution } from '../types.js';

export class RFQResource {
  public constructor(private readonly client: MintarexClient) {}

  public async quote(input: QuoteRequest): Promise<Quote> {
    // `quote` can be fiat (crypto-fiat trade) or crypto (crypto-crypto swap).
    // The SDK only validates the code format; the server classifies the pair
    // and rejects unsupported combinations with a specific error.
    const body: Record<string, string> = {
      base: assertCoin(input.base, 'base'),
      quote: assertCurrencyCode(input.quote, 'quote'),
      side: assertSide(input.side, 'side'),
      amount: assertAmount(input.amount, 'amount'),
      amount_type: assertAmountType(input.amount_type, 'amount_type'),
    };
    if (input.network !== undefined) {
      body.network = assertNetwork(input.network, 'network');
    }
    if (input.from_network !== undefined) {
      body.from_network = assertNetwork(input.from_network, 'from_network');
    }
    if (input.to_network !== undefined) {
      body.to_network = assertNetwork(input.to_network, 'to_network');
    }
    return this.client.request<Quote>({
      method: 'POST',
      path: '/rfq',
      body,
    });
  }

  /**
   * Accept an RFQ quote. `idempotency_key` is required; if omitted, a UUIDv4
   * is generated so callers get safe retry semantics on network errors.
   */
  public async accept(
    quoteId: string,
    options?: { idempotency_key?: string },
  ): Promise<TradeExecution> {
    const qid = assertUuid(quoteId, 'quote_id');
    const key =
      options?.idempotency_key !== undefined
        ? assertIdempotencyKey(options.idempotency_key)
        : randomUUID();
    return this.client.request<TradeExecution>({
      method: 'POST',
      path: `/rfq/${encodeURIComponent(qid)}/accept`,
      body: { idempotency_key: key },
    });
  }
}
