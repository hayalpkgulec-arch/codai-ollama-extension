import { WriteFileDiffEntry } from '../types';

export interface UnifiedLineDiffResult {
    entries: WriteFileDiffEntry[];
    addedCount: number;
    removedCount: number;
    truncated: boolean;
}

function splitLines(content: string): string[] {
    if (!content) return [];
    return content.replace(/\r\n/g, '\n').split('\n');
}

function trimWithContext(entries: WriteFileDiffEntry[], contextRadius: number): WriteFileDiffEntry[] {
    const changedIndexes: number[] = [];
    for (let i = 0; i < entries.length; i += 1) {
        if (entries[i].type !== 'context') {
            changedIndexes.push(i);
        }
    }

    if (!changedIndexes.length) {
        return entries.slice(0, Math.min(12, entries.length));
    }

    const ranges: Array<{ start: number; end: number }> = [];
    for (const idx of changedIndexes) {
        const start = Math.max(0, idx - contextRadius);
        const end = Math.min(entries.length - 1, idx + contextRadius);
        ranges.push({ start, end });
    }

    ranges.sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [];
    for (const range of ranges) {
        const last = merged[merged.length - 1];
        if (!last || range.start > last.end + 1) {
            merged.push({ ...range });
        } else {
            last.end = Math.max(last.end, range.end);
        }
    }

    const output: WriteFileDiffEntry[] = [];
    for (const block of merged) {
        for (let i = block.start; i <= block.end; i += 1) {
            output.push(entries[i]);
        }
    }
    return output;
}

export function buildUnifiedLineDiff(
    beforeContent: string,
    afterContent: string,
    options?: { maxEntries?: number; contextRadius?: number; lookahead?: number }
): UnifiedLineDiffResult {
    const maxEntries = options?.maxEntries ?? 1200;
    const contextRadius = options?.contextRadius ?? 2;
    const lookahead = options?.lookahead ?? 24;

    const before = splitLines(beforeContent);
    const after = splitLines(afterContent);

    const entries: WriteFileDiffEntry[] = [];
    let addedCount = 0;
    let removedCount = 0;
    let i = 0;
    let j = 0;
    let oldLineNo = 1;
    let newLineNo = 1;

    while (i < before.length && j < after.length) {
        if (before[i] === after[j]) {
            entries.push({
                type: 'context',
                text: before[i],
                oldLineNo,
                newLineNo
            });
            i += 1;
            j += 1;
            oldLineNo += 1;
            newLineNo += 1;
            continue;
        }

        let matchInAfter = -1;
        for (let k = 1; k <= lookahead && j + k < after.length; k += 1) {
            if (before[i] === after[j + k]) {
                matchInAfter = j + k;
                break;
            }
        }

        let matchInBefore = -1;
        for (let k = 1; k <= lookahead && i + k < before.length; k += 1) {
            if (before[i + k] === after[j]) {
                matchInBefore = i + k;
                break;
            }
        }

        if (matchInAfter !== -1 && (matchInBefore === -1 || (matchInAfter - j) <= (matchInBefore - i))) {
            while (j < matchInAfter) {
                entries.push({
                    type: 'add',
                    text: after[j],
                    newLineNo
                });
                addedCount += 1;
                j += 1;
                newLineNo += 1;
            }
            continue;
        }

        if (matchInBefore !== -1) {
            while (i < matchInBefore) {
                entries.push({
                    type: 'remove',
                    text: before[i],
                    oldLineNo
                });
                removedCount += 1;
                i += 1;
                oldLineNo += 1;
            }
            continue;
        }

        entries.push({
            type: 'remove',
            text: before[i],
            oldLineNo
        });
        removedCount += 1;
        i += 1;
        oldLineNo += 1;

        entries.push({
            type: 'add',
            text: after[j],
            newLineNo
        });
        addedCount += 1;
        j += 1;
        newLineNo += 1;
    }

    while (i < before.length) {
        entries.push({
            type: 'remove',
            text: before[i],
            oldLineNo
        });
        removedCount += 1;
        i += 1;
        oldLineNo += 1;
    }

    while (j < after.length) {
        entries.push({
            type: 'add',
            text: after[j],
            newLineNo
        });
        addedCount += 1;
        j += 1;
        newLineNo += 1;
    }

    const contextual = trimWithContext(entries, contextRadius);
    const truncated = contextual.length > maxEntries;
    const limited = truncated ? contextual.slice(0, maxEntries) : contextual;

    return {
        entries: limited,
        addedCount,
        removedCount,
        truncated
    };
}
