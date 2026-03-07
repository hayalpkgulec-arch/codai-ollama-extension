export class NdjsonParser {
    private buffer = '';

    push(chunk: string): any[] {
        this.buffer += chunk;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';

        const parsed: any[] = [];
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                parsed.push(JSON.parse(trimmed));
            } catch {
                // Keep malformed lines out of the stream result.
            }
        }
        return parsed;
    }

    flush(): any[] {
        const trimmed = this.buffer.trim();
        this.buffer = '';
        if (!trimmed) return [];
        try {
            return [JSON.parse(trimmed)];
        } catch {
            return [];
        }
    }
}
