import type { SearchResult } from '../runtimeTypes';
import type { SearchProvider, SearchQuery } from './SearchProvider';

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_RESULTS = 5;

export class DuckDuckGoHtmlSearchProvider implements SearchProvider {
    public readonly id = 'duckduckgo-html';

    public async search(query: SearchQuery): Promise<SearchResult[]> {
        const text = String(query.query || '').trim();
        if (!text) return [];

        const maxResults = Math.max(1, Math.min(10, Number(query.maxResults || DEFAULT_MAX_RESULTS)));
        const timeoutMs = Math.max(2_000, Math.min(20_000, Number(query.timeoutMs || DEFAULT_TIMEOUT_MS)));
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(text)}`;
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'CodAI/1.0 (+tool:web_search)',
                    'Accept': 'text/html,application/xhtml+xml',
                },
                signal: controller.signal,
            });

            if (!response.ok) {
                throw new Error(`Search failed with HTTP ${response.status}`);
            }

            const html = await response.text();
            return parseDuckDuckGoHtml(html, text).slice(0, maxResults);
        } finally {
            clearTimeout(timeout);
        }
    }
}

export function parseDuckDuckGoHtml(html: string, query: string): SearchResult[] {
    const blocks = html.split(/<div[^>]+class="result[^"]*"[^>]*>/gi).slice(1);
    const results: SearchResult[] = [];
    const seen = new Set<string>();
    const fetchedAt = new Date().toISOString();

    for (const block of blocks) {
        const titleMatch = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        if (!titleMatch) continue;

        const resolvedUrl = resolveDuckDuckGoUrl(decodeHtml(titleMatch[1]));
        if (!resolvedUrl || seen.has(resolvedUrl)) continue;
        seen.add(resolvedUrl);

        const snippetMatch = block.match(/<(?:a|div)[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
        const title = decodeHtml(stripTags(titleMatch[2] || '')).trim();
        const snippet = decodeHtml(stripTags(snippetMatch?.[1] || '')).replace(/\s+/g, ' ').trim();
        results.push({
            title: title || resolvedUrl,
            url: resolvedUrl,
            snippet,
            sourceHost: safeHost(resolvedUrl),
            rank: results.length + 1,
            fetchedAt,
            queryIntent: inferQueryIntent(query),
        });
    }

    return results;
}

function resolveDuckDuckGoUrl(value: string): string {
    try {
        const decoded = decodeURIComponent(value);
        const parsed = new URL(decoded, 'https://duckduckgo.com');
        const redirected = parsed.searchParams.get('uddg');
        return redirected ? decodeURIComponent(redirected) : parsed.toString();
    } catch {
        return '';
    }
}

function stripTags(value: string): string {
    return value.replace(/<[^>]+>/g, ' ');
}

function decodeHtml(value: string): string {
    return value
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function safeHost(value: string): string {
    try {
        return new URL(value).host;
    } catch {
        return value;
    }
}

function inferQueryIntent(query: string): string {
    const normalized = query.toLowerCase();
    if (/\b(api|docs|documentation|reference|sdk)\b/.test(normalized)) return 'documentation';
    if (/\b(error|stack trace|exception|bug)\b/.test(normalized)) return 'troubleshooting';
    if (/\bexample|tutorial|guide|how to\b/.test(normalized)) return 'how-to';
    return 'general';
}
