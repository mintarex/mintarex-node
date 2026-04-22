import { EventEmitter } from 'node:events';
import type { MintarexClient } from './client.js';
import { NetworkError } from './errors.js';
import type { StreamToken } from './types.js';

export type StreamEventName =
  | 'open'
  | 'message'
  | 'error'
  | 'close'
  | 'reconnecting'
  | (string & {});

export interface StreamOptions {
  /** Disable automatic reconnection. Default: enabled. */
  autoReconnect?: boolean;
  /** Max reconnect attempts before giving up. Default: Infinity. */
  maxReconnectAttempts?: number;
  /** Max backoff between reconnect attempts, in ms. Default: 30000. */
  maxReconnectDelayMs?: number;
  /** Expected heartbeat interval in ms; connection is reset if no data
   * (heartbeat or event) arrives within 2x this interval. Default: 15000. */
  heartbeatIntervalMs?: number;
  /** Optional AbortSignal to externally terminate the stream. */
  signal?: AbortSignal;
}

export interface StreamMessage {
  event: string;
  data: unknown;
  id: string | null;
  raw: string;
}

/**
 * Long-running SSE stream. Emits `'message'` (with parsed event payloads),
 * `'open'`, `'reconnecting'`, `'error'`, and `'close'`. It also re-emits
 * each event by name (e.g. `'trade.executed'`) for convenience.
 *
 * Tokens are auto-refreshed on each reconnect. Heartbeats reset a watchdog
 * timer — if no data arrives in 2x the heartbeat interval, the connection
 * is torn down and restarted.
 */
export class Stream extends EventEmitter {
  private readonly client: MintarexClient;
  private readonly endpoint: 'prices' | 'account';
  private readonly options: Required<Omit<StreamOptions, 'signal'>>;
  private readonly externalSignal: AbortSignal | undefined;
  private abortController: AbortController | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private closedByUser = false;
  private running = false;
  private externalListener: (() => void) | null = null;

  public constructor(
    client: MintarexClient,
    endpoint: 'prices' | 'account',
    options: StreamOptions = {},
  ) {
    super();
    this.client = client;
    this.endpoint = endpoint;
    const hb = options.heartbeatIntervalMs ?? 15_000;
    if (!(Number.isFinite(hb) && hb >= 1000)) {
      throw new Error('heartbeatIntervalMs must be a finite number ≥ 1000');
    }
    const maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30_000;
    if (!(Number.isFinite(maxReconnectDelayMs) && maxReconnectDelayMs >= 0)) {
      throw new Error('maxReconnectDelayMs must be a finite non-negative number');
    }
    this.options = {
      autoReconnect: options.autoReconnect ?? true,
      maxReconnectAttempts: options.maxReconnectAttempts ?? Number.POSITIVE_INFINITY,
      maxReconnectDelayMs,
      heartbeatIntervalMs: hb,
    };
    this.externalSignal = options.signal;
    this.setMaxListeners(0);
    if (this.externalSignal) {
      this.externalListener = (): void => this.close();
      if (this.externalSignal.aborted) {
        // Already aborted: schedule close after constructor returns so any
        // caller-attached listeners see the 'close' event.
        queueMicrotask(() => this.close());
      } else {
        this.externalSignal.addEventListener('abort', this.externalListener, {
          once: true,
        });
      }
    }
  }

  /** Begin streaming. Safe to call once; subsequent calls are no-ops. */
  public async connect(): Promise<void> {
    if (this.running || this.closedByUser) return;
    this.running = true;
    await this.run();
  }

  /** Terminate the stream and prevent further reconnects. */
  public close(): void {
    if (this.closedByUser) return;
    this.closedByUser = true;
    this.running = false;
    if (this.externalListener && this.externalSignal) {
      this.externalSignal.removeEventListener('abort', this.externalListener);
      this.externalListener = null;
    }
    this.clearWatchdog();
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {
        /* ignore */
      }
      this.abortController = null;
    }
    this.emit('close');
  }

  private async run(): Promise<void> {
    while (!this.closedByUser) {
      try {
        await this.openOnce();
        // openOnce returns normally on clean server-side close.
        if (!this.options.autoReconnect || this.closedByUser) break;
      } catch (err) {
        if (this.closedByUser) break;
        this.emit('error', err);
        if (!this.options.autoReconnect) break;
      }

      if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
        this.emit(
          'error',
          new NetworkError(
            `Stream reconnect limit reached (${this.options.maxReconnectAttempts})`,
          ),
        );
        break;
      }
      this.reconnectAttempts += 1;
      const delayMs = Math.min(
        500 * Math.pow(2, this.reconnectAttempts - 1) + Math.floor(Math.random() * 500),
        this.options.maxReconnectDelayMs,
      );
      this.emit('reconnecting', { attempt: this.reconnectAttempts, delayMs });
      await sleep(delayMs);
    }
    if (!this.closedByUser) this.close();
  }

  private async openOnce(): Promise<void> {
    // Create the abort controller BEFORE fetching the token so close() can
    // interrupt the token request too. Bail out immediately if the stream
    // was closed while we were waiting to start.
    this.abortController = new AbortController();
    if (this.closedByUser) return;
    const signal = this.abortController.signal;

    const token = await this.fetchToken(signal);
    if (this.closedByUser) return;

    const url = new URL(this.client.streamBaseURL.href);
    url.pathname = trimTrailing(url.pathname) + '/' + this.endpoint;
    url.searchParams.set('token', token);

    // Abort the initial connection attempt after 2x heartbeat interval
    // so a silent server (TCP accept but no response) can't stall us.
    const openTimeout = setTimeout(() => {
      try {
        this.abortController?.abort();
      } catch {
        /* ignore */
      }
    }, this.options.heartbeatIntervalMs * 2);
    if (typeof (openTimeout as { unref?: () => void }).unref === 'function') {
      (openTimeout as { unref: () => void }).unref();
    }

    let response: Response;
    try {
      response = await this.client.fetch(url, {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
        signal,
        redirect: 'error',
      });
    } finally {
      clearTimeout(openTimeout);
    }

    if (this.closedByUser) return;

    if (!response.ok || !response.body) {
      throw new NetworkError(`Stream open failed: HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream')) {
      throw new NetworkError(`Unexpected content-type: ${contentType}`);
    }

    this.emit('open');
    this.reconnectAttempts = 0; // reset on successful connect
    this.armWatchdog();

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        this.armWatchdog();
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = findEventBoundary(buffer)) >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx).replace(/^(\r\n\r\n|\n\n|\r\r)/, '');
          this.dispatchChunk(chunk);
        }
      }
    } finally {
      this.clearWatchdog();
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }
  }

  private async fetchToken(signal?: AbortSignal): Promise<string> {
    const token = await this.client.request<StreamToken>({
      method: 'POST',
      path: '/stream/token',
      body: {},
      ...(signal ? { signal } : {}),
    });
    if (typeof token.token !== 'string' || token.token.length === 0) {
      throw new NetworkError('Stream token response missing token field');
    }
    return token.token;
  }

  private dispatchChunk(chunk: string): void {
    // Ignore comment-only chunks (e.g., `:heartbeat`)
    const lines = chunk.split(/\r\n|\n|\r/);
    let eventName = 'message';
    let dataLines: string[] = [];
    let id: string | null = null;
    let hasData = false;

    for (const line of lines) {
      if (line.length === 0) continue;
      if (line.startsWith(':')) continue; // SSE comment, used for heartbeats
      const colonIdx = line.indexOf(':');
      let field: string;
      let value: string;
      if (colonIdx === -1) {
        field = line;
        value = '';
      } else {
        field = line.slice(0, colonIdx);
        value = line.slice(colonIdx + 1);
        if (value.startsWith(' ')) value = value.slice(1);
      }
      switch (field) {
        case 'event':
          eventName = value || 'message';
          break;
        case 'data':
          dataLines.push(value);
          hasData = true;
          break;
        case 'id':
          id = value;
          break;
        case 'retry':
          // Advisory; we use our own backoff strategy.
          break;
        default:
          break;
      }
    }

    if (!hasData) return;

    const rawData = dataLines.join('\n');
    let parsed: unknown = rawData;
    if (rawData.length > 0) {
      try {
        parsed = JSON.parse(rawData);
      } catch {
        parsed = rawData;
      }
    }
    const msg: StreamMessage = {
      event: eventName,
      data: parsed,
      id,
      raw: rawData,
    };
    this.emit('message', msg);
    if (eventName !== 'message') this.emit(eventName, msg);
  }

  private armWatchdog(): void {
    this.clearWatchdog();
    const timeoutMs = Math.max(1000, this.options.heartbeatIntervalMs * 2);
    this.watchdog = setTimeout(() => {
      if (this.closedByUser) return;
      this.emit(
        'error',
        new NetworkError(`No data for ${timeoutMs}ms; forcing reconnect`),
      );
      if (this.abortController) {
        try {
          this.abortController.abort();
        } catch {
          /* ignore */
        }
      }
    }, timeoutMs);
    if (typeof (this.watchdog as { unref?: () => void }).unref === 'function') {
      (this.watchdog as { unref: () => void }).unref();
    }
  }

  private clearWatchdog(): void {
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimTrailing(p: string): string {
  return p.endsWith('/') ? p.slice(0, -1) : p;
}

function findEventBoundary(s: string): number {
  // SSE event terminator per spec: \n\n, \r\n\r\n, or \r\r
  const candidates = [s.indexOf('\n\n'), s.indexOf('\r\n\r\n'), s.indexOf('\r\r')]
    .filter((i) => i >= 0);
  if (candidates.length === 0) return -1;
  return Math.min(...candidates);
}

export class StreamsResource {
  public constructor(private readonly client: MintarexClient) {}

  public prices(options?: StreamOptions): Stream {
    const s = new Stream(this.client, 'prices', options);
    // Start asynchronously; caller attaches listeners before awaiting.
    void s.connect().catch((err) => s.emit('error', err));
    return s;
  }

  public account(options?: StreamOptions): Stream {
    const s = new Stream(this.client, 'account', options);
    void s.connect().catch((err) => s.emit('error', err));
    return s;
  }
}
