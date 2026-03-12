export type WebFetchArgs = {
    url: string;
    maxChars?: number;
    timeoutMs?: number;
    preferCache?: boolean;
};

export type WebFetchLink = {
    text: string;
    url: string;
};

export type WebFetchPayload = {
    __tool: 'web_fetch';
    status: 'success' | 'error';
    summary: string;
    url: string;
    finalUrl?: string;
    host?: string;
    statusCode?: number;
    contentType?: string;
    title?: string;
    excerpt?: string;
    links?: WebFetchLink[];
    cached?: boolean;
    fetchedAt: string;
    durationMs: number;
    errorMessage?: string;
};

const DEFAULT_MAX_CHARS = 8_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 512_000;
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { cachedAt: number; payload: WebFetchPayload }>();

export class WebFetchService {
    public async fetch(args: WebFetchArgs): Promise<string> {
        const targetUrl = String(args.url || '').trim();
        const maxChars = Math.max(1_000, Math.min(20_000, Number(args.maxChars || DEFAULT_MAX_CHARS)));
        const timeoutMs = Math.max(2_000, Math.min(30_000, Number(args.timeoutMs || DEFAULT_TIMEOUT_MS)));
        const preferCache = args.preferCache !== false;

        if (!targetUrl) {
            return this.serialize({
                __tool: 'web_fetch',
                status: 'error',
                summary: 'Web fetch failed',
                url: '',
                fetchedAt: new Date().toISOString(),
                durationMs: 0,
                errorMessage: 'No URL provided.',
            });
        }

        let normalizedUrl: string;
        try {
            normalizedUrl = new URL(targetUrl).toString();
        } catch {
            return this.serialize({
                __tool: 'web_fetch',
                status: 'error',
                summary: 'Web fetch failed',
                url: targetUrl,
                fetchedAt: new Date().toISOString(),
                durationMs: 0,
                errorMessage: 'Only valid http:// or https:// URLs are supported.',
            });
        }

        if (!/^https?:/i.test(normalizedUrl)) {
            return this.serialize({
                __tool: 'web_fetch',
                status: 'error',
                summary: 'Web fetch failed',
                url: normalizedUrl,
                fetchedAt: new Date().toISOString(),
                durationMs: 0,
                errorMessage: 'Only http:// and https:// URLs are supported.',
            });
        }

        if (preferCache) {
            const cached = cache.get(normalizedUrl);
            if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
                return this.serialize({
                    ...cached.payload,
                    cached: true,
                });
            }
        }

        const startedAt = Date.now();
        let lastError = '';
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
                const response = await fetch(normalizedUrl, {
                    redirect: 'follow',
                    headers: {
                        'User-Agent': 'CodAI/1.0 (+tool:web_fetch)',
                        'Accept': 'text/html,application/json,text/plain,text/markdown,application/xml;q=0.8,*/*;q=0.2',
                    },
                    signal: controller.signal,
                });
                clearTimeout(timeoutHandle);

                const contentType = response.headers.get('content-type') || 'application/octet-stream';
                if (isBinaryContentType(contentType)) {
                    return this.serialize({
                        __tool: 'web_fetch',
                        status: 'error',
                        summary: `Unsupported content type from ${response.url || normalizedUrl}`,
                        url: normalizedUrl,
                        finalUrl: response.url || normalizedUrl,
                        host: safeHost(response.url || normalizedUrl),
                        statusCode: response.status,
                        contentType,
                        fetchedAt: new Date().toISOString(),
                        durationMs: Date.now() - startedAt,
                        errorMessage: `Binary content is not supported by web_fetch (${contentType}).`,
                    });
                }

                const body = await readBody(response, MAX_RESPONSE_BYTES);
                const formatted = formatWebFetchBody(body, contentType, maxChars, response.url || normalizedUrl);
                const payload: WebFetchPayload = {
                    __tool: 'web_fetch',
                    status: response.ok ? 'success' : 'error',
                    summary: response.ok
                        ? `Fetched ${formatted.host}`
                        : `Fetch failed for ${formatted.host}`,
                    url: normalizedUrl,
                    finalUrl: response.url || normalizedUrl,
                    host: formatted.host,
                    statusCode: response.status,
                    contentType,
                    title: formatted.title,
                    excerpt: formatted.excerpt,
                    links: formatted.links,
                    cached: false,
                    fetchedAt: new Date().toISOString(),
                    durationMs: Date.now() - startedAt,
                    errorMessage: response.ok ? undefined : formatted.excerpt || `HTTP ${response.status}`,
                };

                if (response.ok) {
                    cache.set(normalizedUrl, { cachedAt: Date.now(), payload });
                }

                return this.serialize(payload);
            } catch (error: any) {
                lastError = error?.name === 'AbortError'
                    ? `Request timed out after ${timeoutMs}ms.`
                    : (error?.message || 'Unknown fetch error.');
                if (attempt < 2) {
                    await delay(350 * attempt);
                    continue;
                }
            }
        }

        return this.serialize({
            __tool: 'web_fetch',
            status: 'error',
            summary: 'Web fetch failed',
            url: normalizedUrl,
            host: safeHost(normalizedUrl),
            fetchedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAt,
            errorMessage: lastError,
        });
    }

    private serialize(payload: WebFetchPayload): string {
        return JSON.stringify(payload);
    }
}

async function readBody(response: Response, maxBytes: number): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) {
        return await response.text();
    }

    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        chunks.push(value);
        received += value.byteLength;
        if (received >= maxBytes) break;
    }

    const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    return buffer.toString('utf8');
}

export function formatWebFetchBody(body: string, contentType: string, maxChars: number, finalUrl: string) {
    const host = safeHost(finalUrl);
    if (/json/i.test(contentType)) {
        try {
            const parsed = JSON.parse(body);
            const pretty = JSON.stringify(parsed, null, 2);
            return {
                host,
                title: 'JSON response',
                excerpt: truncate(pretty, maxChars),
                links: [] as WebFetchLink[],
            };
        } catch {
            return {
                host,
                title: 'JSON response',
                excerpt: truncate(body, maxChars),
                links: [] as WebFetchLink[],
            };
        }
    }

    if (/html/i.test(contentType)) {
        const title = extractTitle(body);
        const links = extractLinks(body, finalUrl).slice(0, 10);
        const cleaned = htmlToText(body);
        return {
            host,
            title,
            excerpt: truncate(cleaned, maxChars),
            links,
        };
    }

    return {
        host,
        title: /markdown/i.test(contentType) ? 'Markdown document' : 'Text response',
        excerpt: truncate(body.replace(/\r\n/g, '\n').trim(), maxChars),
        links: [] as WebFetchLink[],
    };
}

function extractTitle(html: string): string {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return decodeEntities((match?.[1] || '').trim()) || 'Web page';
}

function extractLinks(html: string, baseUrl: string): WebFetchLink[] {
    const matches = Array.from(html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi));
    const seen = new Set<string>();
    const links: WebFetchLink[] = [];
    for (const match of matches) {
        const href = match[1]?.trim();
        if (!href) continue;
        try {
            const absolute = new URL(href, baseUrl).toString();
            if (seen.has(absolute)) continue;
            seen.add(absolute);
            links.push({
                text: decodeEntities(stripTags(match[2] || '')).slice(0, 80) || absolute,
                url: absolute,
            });
        } catch {
            continue;
        }
    }
    return links;
}

function htmlToText(html: string): string {
    return truncate(
        decodeEntities(
            stripTags(
                html
                    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
                    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
                    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
                    .replace(/<(h1|h2|h3|h4|h5|h6|p|li|section|article|br)[^>]*>/gi, '\n')
                    .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1) ')
            )
        )
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]{2,}/g, ' ')
            .trim(),
        MAX_RESPONSE_BYTES,
    );
}

function stripTags(value: string): string {
    return value.replace(/<[^>]+>/g, ' ');
}

function decodeEntities(value: string): string {
    return value
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function truncate(value: string, maxChars: number): string {
    const normalized = value.trim();
    return normalized.length > maxChars
        ? `${normalized.slice(0, maxChars)}\n...[truncated]`
        : normalized;
}

function isBinaryContentType(contentType: string): boolean {
    return /^(image|audio|video)\//i.test(contentType)
        || /(application\/pdf|application\/zip|application\/octet-stream)/i.test(contentType);
}

function safeHost(value: string): string {
    try {
        return new URL(value).host;
    } catch {
        return value;
    }
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clearWebFetchCache() {
    cache.clear();
}
