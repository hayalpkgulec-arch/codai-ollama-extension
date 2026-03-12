import test from 'node:test';
import assert from 'node:assert/strict';
import { formatWebFetchBody } from '../services/WebFetchService';

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
