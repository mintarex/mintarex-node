import type { MintarexClient } from '../client.js';
import { assertCurrencyCode, assertSide, assertUuid } from '../validate.js';
import type { PaginatedResponse, Trade } from '../types.js';

export interface TradeListParams {
  limit?: number;
  offset?: number;
  sort?: 'asc' | 'desc';
  base?: string;
  quote?: string;
  side?: 'buy' | 'sell';
  status?: 'filled' | 'pending' | 'cancelled' | 'failed' | 'expired';
  from?: string;
  to?: string;
}

export class TradesResource {
  public constructor(private readonly client: MintarexClient) {}

  public async list(params?: TradeListParams): Promise<PaginatedResponse<Trade>> {
    const query: Record<string, string | number | undefined> = {};
    if (params) {
      if (params.limit !== undefined) query.limit = clampInt(params.limit, 1, 200);
      if (params.offset !== undefined) query.offset = clampInt(params.offset, 0, 2_000_000);
      if (params.sort !== undefined) query.sort = params.sort === 'asc' ? 'asc' : 'desc';
      // base/quote accept any uppercase alphanumeric currency code for filtering
      // (supports both fiat and crypto quotes for crypto-crypto swap history).
      if (params.base !== undefined) query.base = assertCurrencyCode(params.base, 'base');
      if (params.quote !== undefined) query.quote = assertCurrencyCode(params.quote, 'quote');
      if (params.side !== undefined) query.side = assertSide(params.side, 'side');
      if (params.status !== undefined) query.status = params.status;
      if (params.from !== undefined) query.from = String(params.from);
      if (params.to !== undefined) query.to = String(params.to);
    }
    return this.client.request<PaginatedResponse<Trade>>({
      method: 'GET',
      path: '/trades',
      query,
    });
  }

  public async get(tradeUuid: string): Promise<Trade> {
    const id = assertUuid(tradeUuid, 'trade_uuid');
    return this.client.request<Trade>({
      method: 'GET',
      path: `/trades/${encodeURIComponent(id)}`,
    });
  }
}

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  const n = Math.floor(v);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
