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
    searchedAt: string;
    durationMs: number;
    errorMessage?: string;
};

export class WebSearchService {
    constructor(private readonly provider: SearchProvider = new DuckDuckGoHtmlSearchProvider()) {}

    public async search(args: WebSearchArgs): Promise<string> {
        const query = String(args.query || '').trim();
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
            const results = await this.provider.search(args);
            return this.serialize({
                __tool: 'web_search',
                status: 'success',
                summary: results.length > 0
                    ? `Found ${results.length} web result${results.length === 1 ? '' : 's'} for "${query}"`
                    : `No web results found for "${query}"`,
                query,
                provider: this.provider.id,
                results,
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
