/**
 * @mintarex/node — Official Node.js SDK for the Mintarex Corporate OTC API.
 *
 * Usage:
 * ```ts
 * import { Mintarex } from '@mintarex/node';
 * const mx = new Mintarex({ apiKey, apiSecret });
 * const quote = await mx.rfq.quote({ base: 'BTC', quote: 'USD', side: 'buy',
 *                                    amount: '0.5', amount_type: 'base' });
 * ```
 */
export { Mintarex } from './mintarex.js';
export { MintarexClient } from './client.js';
export type { ClientOptions, RequestOptions } from './client.js';

export {
  MintarexError,
  MintarexAPIError,
  AuthenticationError,
  PermissionError,
  ValidationError,
  InsufficientBalanceError,
  NotFoundError,
  ConflictError,
  QuoteExpiredError,
  RateLimitError,
  ServerError,
  ServiceUnavailableError,
  NetworkError,
  WebhookSignatureError,
  ConfigurationError,
} from './errors.js';
export type { RateLimitInfo } from './errors.js';

export { verifyWebhook, DEFAULT_TOLERANCE_SECONDS } from './webhooks.js';
export type { VerifyWebhookParams } from './webhooks.js';

export { Stream, StreamsResource } from './streams.js';
export type { StreamOptions, StreamMessage, StreamEventName } from './streams.js';

export { sign, buildCanonicalString, sha256Hex, hmacSign } from './signing.js';
export type { SignedHeaders } from './signing.js';

export type {
  Environment,
  Side,
  AmountType,
  CurrencyType,
  Pagination,
  PaginatedResponse,
  Balance,
  BalancesResponse,
  SingleBalanceResponse,
  FeesResponse,
  LimitsResponse,
  LimitBucket,
  Quote,
  QuoteRequest,
  TradeExecution,
  Trade,
  DepositAddress,
  CryptoDeposit,
  CryptoWithdrawal,
  WithdrawalAddress,
  Webhook,
  WebhookCreateResponse,
  WebhookEvent,
  WebhookEventType,
  StreamToken,
  Instrument,
  Network,
  PublicFees,
  ResponseMeta,
} from './types.js';
