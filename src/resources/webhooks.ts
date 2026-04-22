import type { MintarexClient } from '../client.js';
import { assertEvents, assertHttpsUrl, assertLabel, assertUuid } from '../validate.js';
import type { Webhook, WebhookCreateResponse } from '../types.js';

export interface WebhookCreateRequest {
  url: string;
  events: string[];
  /** Optional human-readable label (max 100 chars). */
  label?: string;
}

export class WebhooksResource {
  public constructor(private readonly client: MintarexClient) {}

  public async create(input: WebhookCreateRequest): Promise<WebhookCreateResponse> {
    const body: Record<string, unknown> = {
      url: assertHttpsUrl(input.url, 'url'),
      events: assertEvents(input.events, 'events'),
    };
    if (input.label !== undefined) {
      body.label = assertLabel(input.label, 'label');
    }
    return this.client.request<WebhookCreateResponse>({
      method: 'POST',
      path: '/webhooks',
      body,
    });
  }

  public async list(): Promise<{ endpoints: Webhook[] }> {
    return this.client.request<{ endpoints: Webhook[] }>({
      method: 'GET',
      path: '/webhooks',
    });
  }

  public async remove(endpointUuid: string): Promise<{
    success: boolean;
    endpoint_uuid: string;
    status: 'deleted' | 'pending_confirmation';
    confirmation_id?: string;
  }> {
    const id = assertUuid(endpointUuid, 'endpoint_uuid');
    return this.client.request({
      method: 'DELETE',
      path: `/webhooks/${encodeURIComponent(id)}`,
    });
  }
}
