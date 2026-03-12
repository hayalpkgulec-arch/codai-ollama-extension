import test from 'node:test';
import assert from 'node:assert/strict';
import { collapseSearchResults, WebSearchService } from '../services/WebSearchService';
import { parseDuckDuckGoHtml } from '../services/search/DuckDuckGoHtmlSearchProvider';

test('parseDuckDuckGoHtml resolves redirected links and snippets', () => {
    const html = `
        <div class="result results_links results_links_deep web-result ">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs%2Fapi">Example API Docs</a>
          <a class="result__snippet">Read the API reference and examples.</a>
        </div>
        <div class="result results_links results_links_deep web-result ">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fguide">Guide</a>
          <div class="result__snippet">Implementation guide for the SDK.</div>
        </div>
    `;

    const results = parseDuckDuckGoHtml(html, 'example api docs');

    assert.equal(results.length, 2);
    assert.equal(results[0].url, 'https://example.com/docs/api');
    assert.equal(results[0].sourceHost, 'example.com');
    assert.ok(results[0].snippet.includes('API reference'));
    assert.equal(results[0].queryIntent, 'documentation');
});

test('collapseSearchResults removes repeated URLs and over-concentrated hosts', () => {
    const collapsed = collapseSearchResults([
        {
            title: 'Result 1',
            url: 'https://example.com/a#intro',
            snippet: 'First result',
            sourceHost: 'example.com',
            rank: 1,
            fetchedAt: '2026-03-13T10:15:00.000Z',
            queryIntent: 'general',
        },
        {
            title: 'Result 1 duplicate',
            url: 'https://example.com/a',
            snippet: 'Duplicate URL',
            sourceHost: 'example.com',
            rank: 2,
            fetchedAt: '2026-03-13T10:15:00.000Z',
            queryIntent: 'general',
        },
        {
            title: 'Result 2',
            url: 'https://example.com/b',
            snippet: 'Second same-host result',
            sourceHost: 'example.com',
            rank: 3,
            fetchedAt: '2026-03-13T10:15:00.000Z',
            queryIntent: 'general',
        },
        {
            title: 'Result 3',
            url: 'https://example.com/c',
            snippet: 'Third same-host result should collapse',
            sourceHost: 'example.com',
            rank: 4,
            fetchedAt: '2026-03-13T10:15:00.000Z',
            queryIntent: 'general',
        },
        {
            title: 'Different host',
            url: 'https://docs.example.org/start',
            snippet: 'Different host should survive',
            sourceHost: 'docs.example.org',
            rank: 5,
            fetchedAt: '2026-03-13T10:15:00.000Z',
            queryIntent: 'general',
        },
    ], 5);

    assert.equal(collapsed.results.length, 3);
    assert.equal(collapsed.hostCount, 2);
    assert.equal(collapsed.duplicateUrlCount, 1);
    assert.equal(collapsed.collapsedHostCount, 1);
    assert.equal(collapsed.results[0].url, 'https://example.com/a');
});

test('WebSearchService serializes structured success payloads and collapse metadata', async () => {
    const service = new WebSearchService({
        id: 'fake-search',
        async search() {
            return [
                {
                    title: 'CodAI Search Result',
                    url: 'https://example.com/codai',
                    snippet: 'Structured result.',
                    sourceHost: 'example.com',
                    rank: 1,
                    fetchedAt: '2026-03-13T10:15:00.000Z',
                    queryIntent: 'general',
                },
                {
                    title: 'CodAI Search Result duplicate',
                    url: 'https://example.com/codai#section',
                    snippet: 'Should be skipped.',
                    sourceHost: 'example.com',
                    rank: 2,
                    fetchedAt: '2026-03-13T10:15:00.000Z',
                    queryIntent: 'general',
                },
                {
                    title: 'Second host',
                    url: 'https://docs.example.org/runtime',
                    snippet: 'Useful docs.',
                    sourceHost: 'docs.example.org',
                    rank: 3,
                    fetchedAt: '2026-03-13T10:15:00.000Z',
                    queryIntent: 'general',
                },
            ];
        },
    });

    const raw = await service.search({ query: 'codai runtime architecture' });
    const parsed = JSON.parse(raw);

    assert.equal(parsed.__tool, 'web_search');
    assert.equal(parsed.status, 'success');
    assert.equal(parsed.provider, 'fake-search');
    assert.equal(parsed.results.length, 2);
    assert.equal(parsed.results[0].url, 'https://example.com/codai');
    assert.equal(parsed.hostCount, 2);
    assert.equal(parsed.duplicateUrlCount, 1);
    assert.ok(parsed.warnings[0].includes('Skipped 1 repeated URL'));
});
