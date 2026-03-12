import test from 'node:test';
import assert from 'node:assert/strict';
import {
    WebFetchService,
    clearWebFetchCache,
    clearWebFetchThrottleState,
    extractWebPageSignals,
    formatWebFetchBody,
} from '../services/WebFetchService';
import {
    badHtmlFixture,
    binaryResponseFixture,
    createAbortError,
    emptyHtmlFixture,
    redirectChainFixture,
} from './fixtures/webToolFixtures';

test('formatWebFetchBody extracts title, text, and absolute links from HTML', () => {
    const html = `
        <html>
          <head><title>Example Docs</title></head>
          <body>
            <h1>Welcome</h1>
            <p>This is a documentation page.</p>
            <a href="/guide/getting-started">Getting started</a>
          </body>
        </html>
    `;

    const formatted = formatWebFetchBody(html, 'text/html; charset=utf-8', 500, 'https://example.com/docs');

    assert.equal(formatted.host, 'example.com');
    assert.equal(formatted.title, 'Example Docs');
    assert.ok(formatted.excerpt.includes('Welcome'));
    assert.ok(formatted.excerpt.includes('documentation page'));
    assert.equal(formatted.links[0]?.url, 'https://example.com/guide/getting-started');
});

test('formatWebFetchBody pretty prints JSON responses', () => {
    const formatted = formatWebFetchBody('{"ok":true,"items":[1,2]}', 'application/json', 500, 'https://api.example.com/data');

    assert.equal(formatted.host, 'api.example.com');
    assert.equal(formatted.title, 'JSON response');
    assert.ok(formatted.excerpt.includes('"ok": true'));
    assert.ok(formatted.excerpt.includes('"items": ['));
});

test('formatWebFetchBody tolerates malformed HTML fixtures', () => {
    const formatted = formatWebFetchBody(badHtmlFixture, 'text/html; charset=utf-8', 500, 'https://example.com/docs');

    assert.equal(formatted.host, 'example.com');
    assert.ok(formatted.title.includes('Broken'));
    assert.ok(formatted.excerpt.includes('Almost valid page'));
    assert.ok(formatted.excerpt.includes('API docs'));
});

test('extractWebPageSignals reads canonical and robots directives', () => {
    const signals = extractWebPageSignals(
        emptyHtmlFixture,
        'https://example.com/fetched-shell',
        new Headers({ 'x-robots-tag': 'noindex' }),
    );

    assert.equal(signals.canonicalUrl, 'https://example.com/canonical-shell');
    assert.equal(signals.robots.noindex, true);
    assert.equal(signals.robots.nofollow, true);
    assert.equal(signals.robots.source, 'meta+header');
    assert.equal(signals.contentTrust.level, 'caution');
    assert.ok(signals.warnings.some((warning) => warning.includes('very little readable text')));
});

test('WebFetchService follows redirect chains and emits citation metadata', async () => {
    clearWebFetchCache();
    clearWebFetchThrottleState();

    const requestedUrls: string[] = [];
    const responses = [...redirectChainFixture];
    const service = new WebFetchService({
        fetchImpl: async (input) => {
            requestedUrls.push(String(input));
            const next = responses.shift();
            if (!next) {
                throw new Error('No more mocked responses');
            }
            return new Response(next.body ?? null, {
                status: next.status,
                headers: next.headers,
            });
        },
        sleep: async () => undefined,
    });

    const raw = await service.fetch({
        url: 'https://example.com/docs/start',
        maxRedirects: 4,
    });
    const parsed = JSON.parse(raw);

    assert.equal(requestedUrls.length, 3);
    assert.equal(parsed.status, 'success');
    assert.equal(parsed.redirectCount, 2);
    assert.equal(parsed.redirected, true);
    assert.equal(parsed.finalUrl, 'https://example.com/docs/final');
    assert.equal(parsed.citation.url, 'https://example.com/docs/final');
    assert.equal(parsed.cachePolicy, 'miss');
    assert.equal(parsed.redirectChain[1].to, 'https://example.com/docs/final');
});

test('WebFetchService returns structured warnings for empty noindex pages', async () => {
    clearWebFetchCache();
    clearWebFetchThrottleState();

    const service = new WebFetchService({
        fetchImpl: async () => new Response(emptyHtmlFixture, {
            status: 200,
            headers: {
                'content-type': 'text/html; charset=utf-8',
                'x-robots-tag': 'noindex',
            },
        }),
        sleep: async () => undefined,
    });

    const raw = await service.fetch({ url: 'https://example.com/empty' });
    const parsed = JSON.parse(raw);

    assert.equal(parsed.status, 'success');
    assert.equal(parsed.robots.noindex, true);
    assert.ok(Array.isArray(parsed.warnings));
    assert.ok(parsed.warnings.some((warning: string) => warning.includes('very little readable text')));
    assert.equal(parsed.canonicalUrl, 'https://example.com/canonical-shell');
});

test('WebFetchService returns structured binary errors', async () => {
    clearWebFetchCache();
    clearWebFetchThrottleState();

    const service = new WebFetchService({
        fetchImpl: async () => new Response(binaryResponseFixture.body, {
            status: binaryResponseFixture.status,
            headers: binaryResponseFixture.headers,
        }),
        sleep: async () => undefined,
    });

    const raw = await service.fetch({ url: 'https://example.com/image.png' });
    const parsed = JSON.parse(raw);

    assert.equal(parsed.status, 'error');
    assert.equal(parsed.contentType, 'image/png');
    assert.ok(parsed.errorMessage.includes('Binary content'));
});

test('WebFetchService returns structured timeout errors', async () => {
    clearWebFetchCache();
    clearWebFetchThrottleState();

    const service = new WebFetchService({
        fetchImpl: async () => {
            throw createAbortError('aborted');
        },
        sleep: async () => undefined,
    });

    const raw = await service.fetch({ url: 'https://example.com/timeout', timeoutMs: 2500 });
    const parsed = JSON.parse(raw);

    assert.equal(parsed.status, 'error');
    assert.ok(parsed.errorMessage.includes('timed out'));
});
