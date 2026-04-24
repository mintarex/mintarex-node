import type { MintarexClient } from '../client.js';
import { assertCoin, assertFiatCurrency } from '../validate.js';
import type {
  BalancesResponse,
  LimitsResponse,
  SingleBalanceResponse,
} from '../types.js';

export class AccountResource {
  public constructor(private readonly client: MintarexClient) {}

  public async balances(params?: {
    currency_type?: 'fiat' | 'crypto';
    include_empty?: boolean;
  }): Promise<BalancesResponse> {
    return this.client.request<BalancesResponse>({
      method: 'GET',
      path: '/account/balances',
      query: params,
    });
  }

  public async balance(currency: string): Promise<SingleBalanceResponse> {
    const c = isFiat3(currency) ? assertFiatCurrency(currency) : assertCoin(currency);
    return this.client.request<SingleBalanceResponse>({
      method: 'GET',
      path: `/account/balance/${encodeURIComponent(c)}`,
    });
  }

  public async limits(): Promise<LimitsResponse> {
    return this.client.request<LimitsResponse>({
      method: 'GET',
      path: '/account/limits',
    });
  }
}

function isFiat3(c: string): boolean {
  return typeof c === 'string' && /^[A-Z]{3,10}$/.test(c);
}
