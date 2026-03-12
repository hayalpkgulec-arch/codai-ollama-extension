import type { SearchResult } from './runtimeTypes';
import { DuckDuckGoHtmlSearchProvider } from './search/DuckDuckGoHtmlSearchProvider';
import type { SearchProvider } from './search/SearchProvider';

export type WebSearchArgs = {
    query: string;
    maxResults?: number;
    timeoutMs?: number;
};

export type WebSearchPayload = {
    __tool: 'web_search';
    status: 'success' | 'error';
    summary: string;
    query: string;
    provider: string;
    results: SearchResult[];
    hostCount?: number;
    duplicateUrlCount?: number;
    collapsedHostCount?: number;
    warnings?: string[];
    searchedAt: string;
    durationMs: number;
    errorMessage?: string;
};

export interface CollapsedSearchResults {
    results: SearchResult[];
    hostCount: number;
    duplicateUrlCount: number;
    collapsedHostCount: number;
}

const DEFAULT_MAX_RESULTS = 5;

export class WebSearchService {
    constructor(private readonly provider: SearchProvider = new DuckDuckGoHtmlSearchProvider()) {}

    public async search(args: WebSearchArgs): Promise<string> {
        const query = String(args.query || '').trim();
        const requestedMaxResults = Math.max(1, Math.min(10, Number(args.maxResults || DEFAULT_MAX_RESULTS)));
        const startedAt = Date.now();
        if (!query) {
            return this.serialize({
                __tool: 'web_search',
                status: 'error',
                summary: 'Web search failed',
                query: '',
                provider: this.provider.id,
                results: [],
                searchedAt: new Date().toISOString(),
                durationMs: 0,
                errorMessage: 'No search query provided.',
            });
        }

        try {
            const providerResults = await this.provider.search({
                ...args,
                query,
                maxResults: Math.min(10, Math.max(requestedMaxResults, requestedMaxResults * 2)),
            });
            const collapsed = collapseSearchResults(providerResults, requestedMaxResults);
            const warnings = buildSearchWarnings(collapsed);
            return this.serialize({
                __tool: 'web_search',
                status: 'success',
                summary: collapsed.results.length > 0
                    ? `Found ${collapsed.results.length} web result${collapsed.results.length === 1 ? '' : 's'} for "${query}" across ${collapsed.hostCount} host${collapsed.hostCount === 1 ? '' : 's'}`
                    : `No web results found for "${query}"`,
                query,
                provider: this.provider.id,
                results: collapsed.results,
                hostCount: collapsed.hostCount,
                duplicateUrlCount: collapsed.duplicateUrlCount || undefined,
                collapsedHostCount: collapsed.collapsedHostCount || undefined,
                warnings: warnings.length > 0 ? warnings : undefined,
                searchedAt: new Date().toISOString(),
                durationMs: Date.now() - startedAt,
            });
        } catch (error: any) {
            return this.serialize({
                __tool: 'web_search',
                status: 'error',
                summary: 'Web search failed',
                query,
                provider: this.provider.id,
                results: [],
                searchedAt: new Date().toISOString(),
                durationMs: Date.now() - startedAt,
                errorMessage: error?.name === 'AbortError'
                    ? 'Search request timed out.'
                    : (error?.message || 'Unknown search error.'),
            });
        }
    }

    private serialize(payload: WebSearchPayload): string {
        return JSON.stringify(payload);
    }
}

export function collapseSearchResults(results: SearchResult[], maxResults: number): CollapsedSearchResults {
    const dedupedResults: SearchResult[] = [];
    const seenUrls = new Set<string>();
    const perHostCounts = new Map<string, number>();
    let duplicateUrlCount = 0;
    let collapsedHostCount = 0;

    for (const result of results) {
        const normalizedUrl = normalizeSearchUrl(result.url);
        if (!normalizedUrl || seenUrls.has(normalizedUrl)) {
            duplicateUrlCount += 1;
            continue;
        }

        const host = result.sourceHost || safeHost(normalizedUrl);
        const nextHostCount = (perHostCounts.get(host) ?? 0) + 1;
        if (nextHostCount > 2) {
            collapsedHostCount += 1;
            continue;
        }

        seenUrls.add(normalizedUrl);
        perHostCounts.set(host, nextHostCount);
        dedupedResults.push({
            ...result,
            url: normalizedUrl,
            sourceHost: host,
            rank: dedupedResults.length + 1,
        });

        if (dedupedResults.length >= maxResults) {
            break;
        }
    }

    return {
        results: dedupedResults,
        hostCount: perHostCounts.size,
        duplicateUrlCount,
        collapsedHostCount,
    };
}

function buildSearchWarnings(results: CollapsedSearchResults): string[] {
    const warnings: string[] = [];
    if (results.duplicateUrlCount > 0) {
        warnings.push(`Skipped ${results.duplicateUrlCount} repeated URL${results.duplicateUrlCount === 1 ? '' : 's'}.`);
    }
    if (results.collapsedHostCount > 0) {
        warnings.push(`Collapsed ${results.collapsedHostCount} lower-rank result${results.collapsedHostCount === 1 ? '' : 's'} from already-covered domains.`);
    }
    return warnings;
}

function normalizeSearchUrl(value: string): string {
    try {
        const url = new URL(value);
        url.hash = '';
        return url.toString();
    } catch {
        return '';
    }
}

function safeHost(value: string): string {
    try {
        return new URL(value).host;
    } catch {
        return value;
    }
}
