import type { SearchResult } from '../runtimeTypes';

export interface SearchQuery {
    query: string;
    maxResults?: number;
    timeoutMs?: number;
}

export interface SearchProvider {
    readonly id: string;
    search(query: SearchQuery): Promise<SearchResult[]>;
}
