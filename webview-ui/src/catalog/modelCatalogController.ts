import type { ProviderId } from './providerCatalog';
import type { ProviderModelsFetchState } from '../types';

export function createProviderModelsRequestId(providerId: ProviderId): string {
  return `provider-models-${providerId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeProviderKeys(primaryKey: string, extraKeys: string[] = []): string[] {
  return [primaryKey.trim(), ...extraKeys.map((key) => key.trim())].filter(Boolean);
}

export function buildModelFetchSignature(providerId: ProviderId, draft: {
  apiKey: string;
  extraKeys: string[];
  baseUrl: string;
}): string {
  return JSON.stringify({
    providerId,
    apiKey: draft.apiKey.trim(),
    extraKeys: normalizeProviderKeys('', draft.extraKeys),
    baseUrl: draft.baseUrl.trim(),
  });
}

export function shouldPollOllamaModels(
  fetchState: ProviderModelsFetchState,
  modelCount: number,
): boolean {
  if (fetchState.loading) return false;
  if (modelCount > 0 && !fetchState.error) return false;
  return true;
}
