import type { MintarexClient } from '../client.js';
import { assertCoin } from '../validate.js';
import type { Instrument, Network, PublicFees } from '../types.js';

export class PublicResource {
  public constructor(private readonly client: MintarexClient) {}

  public async instruments(): Promise<{
    instruments: Instrument[];
    total: number;
    timestamp: string;
  }> {
    return this.client.request({
      method: 'GET',
      path: '/instruments',
    });
  }

  public async networks(params?: { coin?: string }): Promise<{
    networks: Network[];
    total: number;
    timestamp: string;
  }> {
    const query: Record<string, string> = {};
    if (params?.coin !== undefined) {
      query.coin = assertCoin(params.coin, 'coin');
    }
    return this.client.request({
      method: 'GET',
      path: '/networks',
      query,
    });
  }

  public async fees(): Promise<PublicFees> {
    return this.client.request<PublicFees>({
      method: 'GET',
      path: '/fees',
    });
  }
}
