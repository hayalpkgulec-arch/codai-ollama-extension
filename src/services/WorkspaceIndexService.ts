import * as path from 'path';
import { promises as fs } from 'fs';
import type { RetrievalHit, WorkspaceIndexEntry, WorkspaceIndexState } from './runtimeTypes';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', 'dist', 'coverage', 'build']);
const ALLOWED_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.py', '.go', '.rs', '.java', '.yml', '.yaml']);

export class WorkspaceIndexService {
    public async buildIndex(root: string): Promise<WorkspaceIndexState> {
        const entries: WorkspaceIndexEntry[] = [];
        await this.walk(root, root, entries);
        return {
            builtAt: new Date().toISOString(),
            entries,
        };
    }

    public buildSummary(index: WorkspaceIndexState, root: string): string {
        const lines: string[] = [`Root: ${root}`, `Indexed files: ${index.entries.length}`];
        for (const entry of index.entries.slice(0, 20)) {
            const symbolSuffix = entry.symbols.length > 0 ? ` · symbols: ${entry.symbols.slice(0, 4).join(', ')}` : '';
            lines.push(`- ${entry.path}${symbolSuffix}`);
        }
        return lines.join('\n');
    }

    public search(index: WorkspaceIndexState | undefined, query: string, limit = 4): RetrievalHit[] {
        if (!index || !query.trim()) return [];
        const terms = tokenize(query);
        if (terms.length === 0) return [];

        return index.entries
            .map((entry) => {
                const haystack = `${entry.path} ${entry.symbols.join(' ')} ${entry.excerpt}`.toLowerCase();
                const score = terms.reduce((acc, term) => acc + (haystack.includes(term) ? 1 : 0), 0);
                return score > 0
                    ? {
                        id: `workspace:${entry.path}`,
                        source: 'workspace' as const,
                        title: entry.path,
                        preview: entry.symbols.length > 0
                            ? `symbols: ${entry.symbols.slice(0, 6).join(', ')}`
                            : entry.excerpt.slice(0, 180),
                        score,
                    }
                    : null;
            })
            .filter((item): item is NonNullable<typeof item> => Boolean(item))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    private async walk(root: string, currentDir: string, entries: WorkspaceIndexEntry[]): Promise<void> {
        if (entries.length >= 200) return;
        const dirEntries = await fs.readdir(currentDir, { withFileTypes: true });

        for (const dirEntry of dirEntries) {
            if (entries.length >= 200) return;
            if (dirEntry.name.startsWith('.codai')) continue;

            const fullPath = path.join(currentDir, dirEntry.name);
            if (dirEntry.isDirectory()) {
                if (SKIP_DIRS.has(dirEntry.name)) continue;
                await this.walk(root, fullPath, entries);
                continue;
            }

            const ext = path.extname(dirEntry.name).toLowerCase();
            if (!ALLOWED_EXTS.has(ext)) continue;

            try {
                const stats = await fs.stat(fullPath);
                if (stats.size > 256_000) continue;
                const raw = await fs.readFile(fullPath, 'utf8');
                const normalized = raw.replace(/\s+/g, ' ').trim();
                entries.push({
                    path: path.relative(root, fullPath).replace(/\\/g, '/'),
                    language: ext.replace(/^\./, ''),
                    symbols: extractSymbols(raw),
                    excerpt: normalized.slice(0, 240),
                });
            } catch {
                // Skip unreadable files.
            }
        }
    }
}

function extractSymbols(source: string): string[] {
    const matches = source.match(/\b(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const)\s+([A-Za-z0-9_]+)/g) ?? [];
    return Array.from(new Set(matches
        .map((match) => match.split(/\s+/).pop() || '')
        .filter(Boolean)
        .slice(0, 12)));
}

function tokenize(text: string): string[] {
    return Array.from(new Set(text
        .toLowerCase()
        .split(/[^a-z0-9_./:-]+/)
        .map((part) => part.trim())
        .filter((part) => part.length >= 3)));
}
