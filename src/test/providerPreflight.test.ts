import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderPreflight } from '../services/ProviderPreflight';

test('ProviderPreflight rejects missing API keys for cloud providers', () => {
    const result = new ProviderPreflight().validateRequest({
        providerId: 'openrouter',
        model: 'deepseek/deepseek-r1:free',
        baseUrl: 'https://openrouter.ai/api/v1',
        requiresTools: true,
    });

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('API key is required')));
});

test('ProviderPreflight blocks invalid provider-model combinations before send', () => {
    const result = new ProviderPreflight().validateRequest({
        providerId: 'mistral',
        model: 'qwen3-coder:480b-cloud',
        baseUrl: 'https://api.mistral.ai/v1',
        apiKey: 'mistral-test-key',
        requiresTools: true,
    });

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('not a known model')));
});
