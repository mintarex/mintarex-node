import { randomUUID } from 'node:crypto';
import type { MintarexClient } from '../client.js';
import {
  assertAddress,
  assertAddressTag,
  assertAmount,
  assertCoin,
  assertIdempotencyKey,
  assertLabel,
  assertNetwork,
  assertUuid,
} from '../validate.js';
import type {
  CryptoDeposit,
  CryptoWithdrawal,
  DepositAddress,
  PaginatedResponse,
  WithdrawalAddress,
} from '../types.js';

export type { PaginatedResponse } from '../types.js';

export interface DepositListParams {
  coin?: string;
  status?: CryptoDeposit['status'];
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface WithdrawalListParams {
  coin?: string;
  status?: CryptoWithdrawal['status'];
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface WithdrawRequest {
  coin: string;
  network: string;
  amount: string;
  address: string;
  address_tag?: string;
  idempotency_key?: string;
}

export interface AddressAddRequest {
  currency: string;
  network: string;
  address: string;
  address_tag?: string;
  label: string;
}

export interface AddressListParams {
  currency?: string;
  network?: string;
  status?: WithdrawalAddress['status'];
  limit?: number;
  offset?: number;
}

export class WithdrawalAddressesSubresource {
  public constructor(private readonly client: MintarexClient) {}

  public async list(
    params?: AddressListParams,
  ): Promise<PaginatedResponse<WithdrawalAddress>> {
    const query: Record<string, string | number | undefined> = {};
    if (params) {
      if (params.currency !== undefined)
        query.currency = assertCoin(params.currency, 'currency');
      if (params.network !== undefined)
        query.network = assertNetwork(params.network, 'network');
      if (params.status !== undefined) query.status = params.status;
      if (params.limit !== undefined) query.limit = clampInt(params.limit, 1, 200);
      if (params.offset !== undefined) query.offset = clampInt(params.offset, 0, 2_000_000);
    }
    return this.client.request<PaginatedResponse<WithdrawalAddress>>({
      method: 'GET',
      path: '/crypto/withdrawal-addresses',
      query,
    });
  }

  public async add(input: AddressAddRequest): Promise<{
    success: boolean;
    address_uuid?: string;
    status: 'pending' | 'active';
    message?: string;
  }> {
    const body = {
      currency: assertCoin(input.currency, 'currency'),
      network: assertNetwork(input.network, 'network'),
      address: assertAddress(input.address, 'address'),
      ...(input.address_tag !== undefined
        ? { address_tag: assertAddressTag(input.address_tag) }
        : {}),
      label: assertLabel(input.label, 'label'),
    };
    return this.client.request({
      method: 'POST',
      path: '/crypto/withdrawal-addresses',
      body,
    });
  }

  public async remove(addressUuid: string): Promise<{
    success: boolean;
    address_uuid: string;
    status: 'revoked' | 'pending_confirmation';
    confirmation_id?: string;
  }> {
    const id = assertUuid(addressUuid, 'address_uuid');
    return this.client.request({
      method: 'DELETE',
      path: `/crypto/withdrawal-addresses/${encodeURIComponent(id)}`,
    });
  }
}

export class CryptoResource {
  public readonly addresses: WithdrawalAddressesSubresource;

  public constructor(private readonly client: MintarexClient) {
    this.addresses = new WithdrawalAddressesSubresource(client);
  }

  public async depositAddress(params: {
    coin: string;
    network?: string;
  }): Promise<DepositAddress> {
    const query: Record<string, string> = {
      coin: assertCoin(params.coin, 'coin'),
    };
    if (params.network !== undefined) {
      query.network = assertNetwork(params.network, 'network');
    }
    return this.client.request<DepositAddress>({
      method: 'GET',
      path: '/crypto/deposit-address',
      query,
    });
  }

  public async deposits(
    params?: DepositListParams,
  ): Promise<PaginatedResponse<CryptoDeposit>> {
    const query: Record<string, string | number | undefined> = {};
    if (params) {
      if (params.coin !== undefined) query.coin = assertCoin(params.coin, 'coin');
      if (params.status !== undefined) query.status = params.status;
      if (params.from !== undefined) query.from = String(params.from);
      if (params.to !== undefined) query.to = String(params.to);
      if (params.limit !== undefined) query.limit = clampInt(params.limit, 1, 200);
      if (params.offset !== undefined) query.offset = clampInt(params.offset, 0, 2_000_000);
    }
    return this.client.request<PaginatedResponse<CryptoDeposit>>({
      method: 'GET',
      path: '/crypto/deposits',
      query,
    });
  }

  public async withdraw(input: WithdrawRequest): Promise<CryptoWithdrawal> {
    const body: Record<string, string> = {
      coin: assertCoin(input.coin, 'coin'),
      network: assertNetwork(input.network, 'network'),
      amount: assertAmount(input.amount, 'amount'),
      address: assertAddress(input.address, 'address'),
      idempotency_key:
        input.idempotency_key !== undefined
          ? assertIdempotencyKey(input.idempotency_key)
          : randomUUID(),
    };
    if (input.address_tag !== undefined) {
      body.address_tag = assertAddressTag(input.address_tag);
    }
    return this.client.request<CryptoWithdrawal>({
      method: 'POST',
      path: '/crypto/withdraw',
      body,
    });
  }

  public async withdrawals(
    params?: WithdrawalListParams,
  ): Promise<PaginatedResponse<CryptoWithdrawal>> {
    const query: Record<string, string | number | undefined> = {};
    if (params) {
      if (params.coin !== undefined) query.coin = assertCoin(params.coin, 'coin');
      if (params.status !== undefined) query.status = params.status;
      if (params.from !== undefined) query.from = String(params.from);
      if (params.to !== undefined) query.to = String(params.to);
      if (params.limit !== undefined) query.limit = clampInt(params.limit, 1, 200);
      if (params.offset !== undefined) query.offset = clampInt(params.offset, 0, 2_000_000);
    }
    return this.client.request<PaginatedResponse<CryptoWithdrawal>>({
      method: 'GET',
      path: '/crypto/withdrawals',
      query,
    });
  }

  public async getWithdrawal(uuid: string): Promise<CryptoWithdrawal> {
    const id = assertUuid(uuid, 'withdrawal_uuid');
    return this.client.request<CryptoWithdrawal>({
      method: 'GET',
      path: `/crypto/withdrawals/${encodeURIComponent(id)}`,
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
