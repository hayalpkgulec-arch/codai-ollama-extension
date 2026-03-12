import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDuckDuckGoHtml } from '../services/search/DuckDuckGoHtmlSearchProvider';
import { WebSearchService } from '../services/WebSearchService';

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

test('WebSearchService serializes structured success payloads', async () => {
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
            ];
        },
    });

    const raw = await service.search({ query: 'codai runtime architecture' });
    const parsed = JSON.parse(raw);

    assert.equal(parsed.__tool, 'web_search');
    assert.equal(parsed.status, 'success');
    assert.equal(parsed.provider, 'fake-search');
    assert.equal(parsed.results[0].url, 'https://example.com/codai');
});
