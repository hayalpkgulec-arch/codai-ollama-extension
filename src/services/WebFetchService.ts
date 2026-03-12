export type WebFetchArgs = {
    url: string;
    maxChars?: number;
    timeoutMs?: number;
    preferCache?: boolean;
    maxRedirects?: number;
};

export type WebFetchLink = {
    text: string;
    url: string;
};

export type WebFetchRedirectHop = {
    from: string;
    to: string;
    statusCode: number;
};

export type WebFetchCitation = {
    title: string;
    url: string;
    canonicalUrl?: string;
    host: string;
    accessedAt: string;
    contentType?: string;
    statusCode?: number;
};

export type WebFetchRobots = {
    directives: string[];
    noindex: boolean;
    nofollow: boolean;
    unavailableAfter?: string;
    source: 'none' | 'meta' | 'header' | 'meta+header';
};

export type WebFetchTrust = {
    level: 'standard' | 'caution';
    reasons: string[];
};

export type WebFetchPayload = {
    __tool: 'web_fetch';
    status: 'success' | 'error';
    summary: string;
    url: string;
    finalUrl?: string;
    canonicalUrl?: string;
    host?: string;
    statusCode?: number;
    contentType?: string;
    title?: string;
    excerpt?: string;
    links?: WebFetchLink[];
    redirected?: boolean;
    redirectCount?: number;
    redirectChain?: WebFetchRedirectHop[];
    citation?: WebFetchCitation;
    robots?: WebFetchRobots;
    cachePolicy?: 'hit' | 'miss' | 'bypass';
    cached?: boolean;
    contentTrust?: WebFetchTrust;
    warnings?: string[];
    throttledMs?: number;
    fetchedAt: string;
    durationMs: number;
    errorMessage?: string;
};

type FetchLike = typeof fetch;

interface WebFetchServiceOptions {
    fetchImpl?: FetchLike;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
}

export interface ExtractedWebPageSignals {
    canonicalUrl?: string;
    robots: WebFetchRobots;
    contentTrust: WebFetchTrust;
    warnings: string[];
}

const DEFAULT_MAX_CHARS = 8_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 4;
const MAX_RESPONSE_BYTES = 512_000;
const CACHE_TTL_MS = 60_000;
const DOMAIN_THROTTLE_WINDOW_MS = 1_200;
const cache = new Map<string, { cachedAt: number; payload: WebFetchPayload }>();
const perHostLastFetchAt = new Map<string, number>();

export class WebFetchService {
    constructor(private readonly options: WebFetchServiceOptions = {}) {}

    public async fetch(args: WebFetchArgs): Promise<string> {
        const targetUrl = String(args.url || '').trim();
        const maxChars = Math.max(1_000, Math.min(20_000, Number(args.maxChars || DEFAULT_MAX_CHARS)));
        const timeoutMs = Math.max(2_000, Math.min(30_000, Number(args.timeoutMs || DEFAULT_TIMEOUT_MS)));
        const preferCache = args.preferCache !== false;
        const maxRedirects = Math.max(0, Math.min(6, Number(args.maxRedirects ?? DEFAULT_MAX_REDIRECTS)));

        if (!targetUrl) {
            return this.serialize({
                __tool: 'web_fetch',
                status: 'error',
                summary: 'Web fetch failed',
                url: '',
                cachePolicy: preferCache ? 'miss' : 'bypass',
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
                cachePolicy: preferCache ? 'miss' : 'bypass',
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
                cachePolicy: preferCache ? 'miss' : 'bypass',
                fetchedAt: new Date().toISOString(),
                durationMs: 0,
                errorMessage: 'Only http:// and https:// URLs are supported.',
            });
        }

        if (preferCache) {
            const cached = cache.get(normalizedUrl);
            if (cached && this.now() - cached.cachedAt < CACHE_TTL_MS) {
                return this.serialize({
                    ...cached.payload,
                    cached: true,
                    cachePolicy: 'hit',
                });
            }
        }

        const startedAt = this.now();
        const host = safeHost(normalizedUrl);
        const throttleDelay = await this.applyDomainThrottle(host);
        const prefetchedWarnings = throttleDelay > 0
            ? [`Throttled repeated fetches to ${host} by ${throttleDelay}ms.`]
            : [];

        let lastError = '';
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const { response, finalUrl, redirectChain } = await fetchWithRedirects({
                    url: normalizedUrl,
                    timeoutMs,
                    maxRedirects,
                    fetchImpl: this.fetchImpl,
                });

                const contentType = response.headers.get('content-type') || 'application/octet-stream';
                const fetchedAt = new Date().toISOString();
                const cachePolicy = preferCache ? 'miss' : 'bypass';

                if (isBinaryContentType(contentType)) {
                    return this.serialize({
                        __tool: 'web_fetch',
                        status: 'error',
                        summary: `Unsupported content type from ${finalUrl || normalizedUrl}`,
                        url: normalizedUrl,
                        finalUrl: finalUrl || normalizedUrl,
                        host: safeHost(finalUrl || normalizedUrl),
                        statusCode: response.status,
                        contentType,
                        redirected: redirectChain.length > 0,
                        redirectCount: redirectChain.length,
                        redirectChain,
                        cachePolicy,
                        fetchedAt,
                        durationMs: this.now() - startedAt,
                        warnings: prefetchedWarnings.length > 0 ? prefetchedWarnings : undefined,
                        throttledMs: throttleDelay || undefined,
                        errorMessage: `Binary content is not supported by web_fetch (${contentType}).`,
                    });
                }

                const body = await readBody(response, MAX_RESPONSE_BYTES);
                const formatted = formatWebFetchBody(body, contentType, maxChars, finalUrl || normalizedUrl);
                const pageSignals = /html/i.test(contentType)
                    ? extractWebPageSignals(body, finalUrl || normalizedUrl, response.headers)
                    : createDefaultWebPageSignals();
                const warnings = [
                    ...prefetchedWarnings,
                    ...pageSignals.warnings,
                ];
                const citation = buildWebCitation({
                    title: formatted.title || formatted.host,
                    finalUrl: finalUrl || normalizedUrl,
                    canonicalUrl: pageSignals.canonicalUrl,
                    fetchedAt,
                    contentType,
                    statusCode: response.status,
                });

                const payload: WebFetchPayload = {
                    __tool: 'web_fetch',
                    status: response.ok ? 'success' : 'error',
                    summary: response.ok
                        ? `Fetched ${formatted.host}`
                        : `Fetch failed for ${formatted.host}`,
                    url: normalizedUrl,
                    finalUrl: finalUrl || normalizedUrl,
                    canonicalUrl: pageSignals.canonicalUrl,
                    host: formatted.host,
                    statusCode: response.status,
                    contentType,
                    title: formatted.title,
                    excerpt: formatted.excerpt,
                    links: formatted.links,
                    redirected: redirectChain.length > 0,
                    redirectCount: redirectChain.length,
                    redirectChain,
                    citation,
                    robots: pageSignals.robots,
                    cachePolicy,
                    cached: false,
                    contentTrust: pageSignals.contentTrust,
                    warnings: warnings.length > 0 ? warnings : undefined,
                    throttledMs: throttleDelay || undefined,
                    fetchedAt,
                    durationMs: this.now() - startedAt,
                    errorMessage: response.ok ? undefined : formatted.excerpt || `HTTP ${response.status}`,
                };

                if (response.ok) {
                    cache.set(normalizedUrl, { cachedAt: this.now(), payload });
                }

                return this.serialize(payload);
            } catch (error: any) {
                lastError = error?.name === 'AbortError'
                    ? `Request timed out after ${timeoutMs}ms.`
                    : (error?.message || 'Unknown fetch error.');
                if (attempt < 2) {
                    await this.sleep(350 * attempt);
                    continue;
                }
            }
        }

        return this.serialize({
            __tool: 'web_fetch',
            status: 'error',
            summary: 'Web fetch failed',
            url: normalizedUrl,
            host,
            cachePolicy: preferCache ? 'miss' : 'bypass',
            warnings: prefetchedWarnings.length > 0 ? prefetchedWarnings : undefined,
            throttledMs: throttleDelay || undefined,
            fetchedAt: new Date().toISOString(),
            durationMs: this.now() - startedAt,
            errorMessage: lastError,
        });
    }

    private get fetchImpl(): FetchLike {
        return this.options.fetchImpl ?? fetch;
    }

    private now(): number {
        return this.options.now ? this.options.now() : Date.now();
    }

    private async sleep(ms: number): Promise<void> {
        if (this.options.sleep) {
            await this.options.sleep(ms);
            return;
        }
        await delay(ms);
    }

    private async applyDomainThrottle(host: string): Promise<number> {
        if (!host) return 0;

        const lastFetchAt = perHostLastFetchAt.get(host) ?? 0;
        const elapsed = this.now() - lastFetchAt;
        const waitMs = elapsed >= DOMAIN_THROTTLE_WINDOW_MS
            ? 0
            : DOMAIN_THROTTLE_WINDOW_MS - elapsed;

        if (waitMs > 0) {
            await this.sleep(waitMs);
        }

        perHostLastFetchAt.set(host, this.now());
        return waitMs;
    }

    private serialize(payload: WebFetchPayload): string {
        return JSON.stringify(payload);
    }
}

interface RedirectFetchInput {
    url: string;
    timeoutMs: number;
    maxRedirects: number;
    fetchImpl: FetchLike;
}

async function fetchWithRedirects(input: RedirectFetchInput): Promise<{
    response: Response;
    finalUrl: string;
    redirectChain: WebFetchRedirectHop[];
}> {
    const redirectChain: WebFetchRedirectHop[] = [];
    const visited = new Set<string>([input.url]);
    const deadline = Date.now() + input.timeoutMs;
    let currentUrl = input.url;

    while (true) {
        const remainingMs = Math.max(1_000, deadline - Date.now());
        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), remainingMs);
        try {
            const response = await input.fetchImpl(currentUrl, {
                redirect: 'manual',
                headers: {
                    'User-Agent': 'CodAI/1.0 (+tool:web_fetch)',
                    'Accept': 'text/html,application/json,text/plain,text/markdown,application/xml;q=0.8,*/*;q=0.2',
                },
                signal: controller.signal,
            });

            if (!isRedirectStatus(response.status)) {
                return {
                    response,
                    finalUrl: response.url || currentUrl,
                    redirectChain,
                };
            }

            if (redirectChain.length >= input.maxRedirects) {
                throw new Error(`Redirect limit exceeded (${input.maxRedirects}).`);
            }

            const location = response.headers.get('location');
            if (!location) {
                throw new Error(`Redirect response from ${currentUrl} did not include a Location header.`);
            }

            const nextUrl = new URL(location, currentUrl).toString();
            if (!/^https?:/i.test(nextUrl)) {
                throw new Error(`Redirect target must stay on http:// or https://: ${nextUrl}`);
            }
            if (visited.has(nextUrl)) {
                throw new Error(`Redirect loop detected while fetching ${input.url}.`);
            }

            redirectChain.push({
                from: currentUrl,
                to: nextUrl,
                statusCode: response.status,
            });
            visited.add(nextUrl);
            currentUrl = nextUrl;
        } finally {
            clearTimeout(timeoutHandle);
        }
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

export function extractWebPageSignals(
    html: string,
    finalUrl: string,
    headers?: Headers | null,
): ExtractedWebPageSignals {
    const canonicalUrl = extractCanonicalUrl(html, finalUrl);
    const headerDirectives = parseRobotsDirectives(headers?.get('x-robots-tag') || '');
    const metaDirectives = extractMetaRobotsDirectives(html);
    const directives = dedupeStrings([...metaDirectives.directives, ...headerDirectives.directives]);
    const noindex = directives.includes('noindex');
    const nofollow = directives.includes('nofollow');
    const unavailableAfter = metaDirectives.unavailableAfter || headerDirectives.unavailableAfter;
    const source = metaDirectives.directives.length > 0 && headerDirectives.directives.length > 0
        ? 'meta+header'
        : metaDirectives.directives.length > 0
            ? 'meta'
            : headerDirectives.directives.length > 0
                ? 'header'
                : 'none';
    const warnings: string[] = [];
    const trustReasons: string[] = [];
    const textContent = htmlToText(html).trim();

    if (!textContent || textContent.length < 80) {
        warnings.push('Page returned very little readable text.');
    }
    if (noindex) {
        warnings.push('Source declares a noindex directive.');
        trustReasons.push('noindex directive is present');
    }
    if (nofollow) {
        warnings.push('Source declares a nofollow directive.');
    }
    if (canonicalUrl && canonicalUrl !== finalUrl) {
        warnings.push('Canonical URL differs from the fetched URL.');
        trustReasons.push('canonical URL differs from the fetched URL');
    }
    if (!extractTitle(html) || extractTitle(html) === 'Web page') {
        warnings.push('Source did not expose a clear page title.');
    }

    return {
        canonicalUrl,
        robots: {
            directives,
            noindex,
            nofollow,
            unavailableAfter,
            source,
        },
        contentTrust: {
            level: trustReasons.length > 0 ? 'caution' : 'standard',
            reasons: trustReasons,
        },
        warnings,
    };
}

function createDefaultWebPageSignals(): ExtractedWebPageSignals {
    return {
        canonicalUrl: undefined,
        robots: {
            directives: [],
            noindex: false,
            nofollow: false,
            source: 'none',
        },
        contentTrust: {
            level: 'standard',
            reasons: [],
        },
        warnings: [],
    };
}

function buildWebCitation(input: {
    title: string;
    finalUrl: string;
    canonicalUrl?: string;
    fetchedAt: string;
    contentType: string;
    statusCode: number;
}): WebFetchCitation {
    const citationUrl = input.canonicalUrl || input.finalUrl;
    return {
        title: input.title || citationUrl,
        url: citationUrl,
        canonicalUrl: input.canonicalUrl,
        host: safeHost(citationUrl),
        accessedAt: input.fetchedAt,
        contentType: input.contentType,
        statusCode: input.statusCode,
    };
}

function extractTitle(html: string): string {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return decodeEntities((match?.[1] || '').trim()) || 'Web page';
}

function extractCanonicalUrl(html: string, finalUrl: string): string | undefined {
    const match = html.match(/<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/i)
        || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical[^"']*["'][^>]*>/i);
    const rawValue = match?.[1]?.trim();
    if (!rawValue) return undefined;
    try {
        return new URL(rawValue, finalUrl).toString();
    } catch {
        return undefined;
    }
}

function extractMetaRobotsDirectives(html: string): { directives: string[]; unavailableAfter?: string } {
    const matches = Array.from(
        html.matchAll(/<meta[^>]+(?:name|property)=["'](?:robots|googlebot|bingbot)["'][^>]+content=["']([^"']+)["'][^>]*>/gi)
    );
    const directives: string[] = [];
    let unavailableAfter: string | undefined;

    for (const match of matches) {
        const parsed = parseRobotsDirectives(match[1] || '');
        directives.push(...parsed.directives);
        unavailableAfter = unavailableAfter || parsed.unavailableAfter;
    }

    return {
        directives: dedupeStrings(directives),
        unavailableAfter,
    };
}

function parseRobotsDirectives(rawValue: string): { directives: string[]; unavailableAfter?: string } {
    const directives: string[] = [];
    let unavailableAfter: string | undefined;

    for (const token of rawValue.split(',')) {
        const normalized = token.trim().toLowerCase();
        if (!normalized) continue;
        directives.push(normalized);
        if (normalized.startsWith('unavailable_after')) {
            unavailableAfter = token.split(':').slice(1).join(':').trim() || unavailableAfter;
        }
    }

    return {
        directives: dedupeStrings(directives),
        unavailableAfter,
    };
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

function isRedirectStatus(statusCode: number): boolean {
    return [301, 302, 303, 307, 308].includes(statusCode);
}

function safeHost(value: string): string {
    try {
        return new URL(value).host;
    } catch {
        return value;
    }
}

function dedupeStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)));
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clearWebFetchCache() {
    cache.clear();
}

export function clearWebFetchThrottleState() {
    perHostLastFetchAt.clear();
}
