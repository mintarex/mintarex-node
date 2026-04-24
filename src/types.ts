/**
 * Shared types surfaced as part of the SDK public API.
 */

import type { RateLimitInfo } from './errors.js';

export type Environment = 'live' | 'sandbox';

export type Side = 'buy' | 'sell';
export type AmountType = 'base' | 'quote';
export type CurrencyType = 'fiat' | 'crypto';

export interface Pagination {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}

export interface Balance {
  currency: string;
  currency_type: CurrencyType;
  available: string;
  locked: string;
  pending_in: string;
  pending_out: string;
  total: string;
  usd_value?: string | null;
  usd_price?: string | null;
}

export interface BalancesResponse {
  balances: Balance[];
  timestamp: string;
}

export interface WalletTypeBalance {
  wallet_type: string;
  available: string;
  locked: string;
  pending_in: string;
  pending_out: string;
}

/**
 * Response shape of `GET /account/balance/{currency}`. Note that the
 * aggregated balance fields use `total_` prefixes, distinct from the
 * per-currency entries in {@link BalancesResponse} which use
 * unprefixed names.
 */
export interface SingleBalanceResponse {
  currency: string;
  currency_type: CurrencyType;
  total_available: string;
  total_locked: string;
  total_pending_in: string;
  total_pending_out: string;
  total: string;
  by_wallet_type: WalletTypeBalance[];
  timestamp: string;
}

export interface LimitBucket {
  daily_limit: string | null;
  daily_used: string | null;
  monthly_limit: string | null;
  monthly_used: string | null;
  remaining_daily: string | null;
  remaining_monthly: string | null;
}

export interface LimitsResponse {
  account_type: 'individual' | 'corporate';
  limits: {
    crypto_deposit: LimitBucket | null;
    crypto_withdrawal: LimitBucket | null;
  };
  timestamp: string;
}

export interface Quote {
  quote_id: string;
  base: string;
  quote: string;
  side: Side;
  network: string;
  price: string;
  base_amount: string;
  quote_amount: string;
  expires_at: string;
  expires_in_ms: number;
}

export interface QuoteRequest {
  base: string;
  quote: string;
  side: Side;
  amount: string;
  amount_type: AmountType;
  /** Single-leg network (crypto-fiat trades). */
  network?: string;
  /** Source network for crypto-to-crypto swaps. */
  from_network?: string;
  /** Destination network for crypto-to-crypto swaps. */
  to_network?: string;
}

export interface TradeExecution {
  trade_id: string;
  status: 'filled' | 'pending' | 'cancelled' | 'failed' | 'expired';
  base: string;
  quote: string;
  side: Side;
  network: string;
  price: string;
  base_amount: string;
  quote_amount: string;
  filled_at: string;
  /** Present for crypto-to-crypto swaps. */
  is_swap?: boolean;
  /** Source network for crypto-to-crypto swaps. */
  from_network?: string;
  /** Destination network for crypto-to-crypto swaps. */
  to_network?: string;
  /** True on sandbox trades. */
  sandbox?: boolean;
  /** True when the server returned a cached response for an existing idempotency_key. */
  idempotent?: boolean;
}

export interface Trade {
  trade_id: string;
  base: string;
  quote: string;
  side: Side;
  status: TradeExecution['status'];
  price: string;
  base_amount: string;
  quote_amount: string;
  fee_amount: string;
  fee_currency: string;
  order_type: string;
  created_at: string;
  /** Present only on GET /trades/:uuid (detail), not on list items. */
  updated_at?: string;
  /** Present when the trade is a sandbox trade. */
  sandbox?: boolean;
}

export interface DepositAddress {
  address: string;
  coin: string;
  network: string;
  memo_required: boolean;
  min_deposit: string;
  required_confirmations: number;
  timestamp: string;
}

export interface CryptoDeposit {
  deposit_id: string;
  coin: string;
  network: string;
  amount: string;
  tx_hash: string;
  from_address: string | null;
  confirmations: number;
  required_confirmations: number;
  status:
    | 'detected'
    | 'pending_confirmations'
    | 'confirming'
    | 'crediting'
    | 'completed'
    | 'failed';
  detected_at: string;
  updated_at: string;
  sandbox?: boolean;
}

export interface CryptoWithdrawal {
  withdrawal_id: string;
  /** Internal reference number; returned by POST /crypto/withdraw and list/detail endpoints. */
  reference?: string | null;
  coin: string;
  network: string;
  amount: string;
  fee: string;
  /** Only returned by POST /crypto/withdraw (amount + fee). */
  total_deducted?: string;
  amount_usd?: string | null;
  to_address: string;
  /** Memo/tag for networks that require one (XRP, XLM, ATOM, HBAR, TON, etc.). */
  memo?: string | null;
  tx_hash?: string | null;
  explorer_url?: string | null;
  status:
    | 'pending_review'
    | 'approved'
    | 'processing'
    | 'broadcasting'
    | 'completed'
    | 'rejected'
    | 'failed'
    | 'cancelled';
  reject_reason?: string | null;
  /** Present only on GET /crypto/withdrawals/:uuid (detail). */
  reviewed_at?: string | null;
  /** Present only on GET /crypto/withdrawals/:uuid (detail). */
  broadcast_at?: string | null;
  completed_at?: string | null;
  /** Not returned by POST /crypto/withdraw; present on list + detail. */
  created_at?: string;
  /** Present only on GET /crypto/withdrawals/:uuid (detail). */
  updated_at?: string;
  /** True on idempotency-key replay. */
  idempotent?: boolean;
  /** Status message from POST /crypto/withdraw response. */
  message?: string;
  /** Present when the withdrawal is a sandbox withdrawal. */
  sandbox?: boolean;
}

export interface WithdrawalAddress {
  address_uuid: string;
  currency: string;
  network: string;
  address: string;
  address_tag?: string | null;
  label: string;
  status: 'pending' | 'active' | 'disabled' | 'revoked';
  cooling_until: string | null;
  is_usable: boolean;
  withdrawal_count: number;
  total_withdrawn_amount: string;
  last_withdrawal_at?: string | null;
  created_at: string;
}

export interface Webhook {
  endpoint_uuid: string;
  url: string;
  label: string;
  events: string[];
  status: 'active' | 'disabled';
  disabled_reason: string | null;
  created_at: string;
}

export interface WebhookCreateResponse {
  endpoint_uuid?: string;
  status: 'active' | 'pending_confirmation';
  signing_secret?: string;
  confirmation_id?: string;
  message?: string;
}

export interface StreamToken {
  token: string;
  expires_in: number;
}

export interface Instrument {
  instrument: string;
  base: string;
  quote: string;
  base_name: string;
  type: 'crypto_fiat' | 'crypto_crypto';
}

export interface Network {
  coin: string;
  network: string;
  name: string;
  contract_address: string | null;
  decimals: number;
  min_deposit: string;
  min_withdrawal: string;
  withdrawal_fee: string;
  required_confirmations: number;
  deposit_enabled: boolean;
  withdrawal_enabled: boolean;
}

export interface PublicFees {
  trading: { individual: string; corporate: string; note?: string };
  fiat_withdrawal: { individual: string; corporate: string; note?: string };
  crypto_withdrawal: { note?: string };
  timestamp: string;
}

/**
 * Attached to every API response as a non-enumerable `_meta` property so it
 * doesn't interfere with JSON.stringify or destructuring.
 */
export interface ResponseMeta {
  requestId: string | null;
  rateLimit: RateLimitInfo;
  status: number;
}

export type WebhookEventType =
  | 'trade.executed'
  | 'deposit.detected'
  | 'deposit.confirmed'
  | 'withdrawal.requested'
  | 'withdrawal.approved'
  | 'withdrawal.completed'
  | 'withdrawal.cancelled';

/**
 * A verified webhook event returned by `verifyWebhook()`. The SDK merges
 * delivery metadata from the `X-Mintarex-*` headers with the body payload
 * into a single structured object:
 *
 * - `event_type`, `event_id`, `delivery_uuid` come from the headers
 * - `timestamp` is the ISO timestamp from the body (the Unix-seconds
 *   timestamp in `X-Mintarex-Timestamp` is used only for signing)
 * - `data` is the event-specific payload (everything in the body except
 *   `timestamp`)
 * - `sandbox` is `true` if the event was emitted in sandbox mode
 */
export interface WebhookEvent<T = Record<string, unknown>> {
  event_type: WebhookEventType | string;
  event_id: string;
  delivery_uuid: string;
  timestamp: string;
  sandbox: boolean;
  data: T;
}
