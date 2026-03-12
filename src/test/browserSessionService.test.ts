import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserSessionService, type BrowserAutomationAdapter } from '../services/BrowserSessionService';

function createStorageStub() {
    let browserArtifactsIndex: any[] = [];
    return {
        readBrowserArtifactsIndex<T>(fallback: T): T {
            return (browserArtifactsIndex.length > 0 ? browserArtifactsIndex : fallback) as T;
        },
        async writeBrowserArtifactsIndex<T>(value: T): Promise<void> {
            browserArtifactsIndex = Array.isArray(value) ? [...value] : [];
        },
        getBrowserArtifactFilePath(sessionId: string, artifactId: string, extension: string) {
            return `C:/tmp/${sessionId}/${artifactId}.${extension}`;
        },
        getArtifacts() {
            return [...browserArtifactsIndex];
        },
    };
}

class FakeBrowserAdapter implements BrowserAutomationAdapter {
    public active = false;
    public consoleMessages = ['[log] boot'];
    public currentUrl = '';

    async launch(): Promise<void> {
        this.active = true;
    }

    isActive(): boolean {
        return this.active;
    }

    async navigate(url: string) {
        this.currentUrl = url;
        return {
            currentUrl: url,
            domSummary: `Opened ${url}`,
            consoleSummary: this.consoleMessages.join('\n'),
        };
    }

    async click(selector: string) {
        return {
            currentUrl: this.currentUrl,
            domSummary: `Clicked ${selector}`,
            consoleSummary: this.consoleMessages.join('\n'),
        };
    }

    async type(selector: string, text: string) {
        return {
            currentUrl: this.currentUrl,
            domSummary: `Typed ${text} into ${selector}`,
            consoleSummary: this.consoleMessages.join('\n'),
        };
    }

    async scroll() {
        return {
            currentUrl: this.currentUrl,
            domSummary: 'Scrolled page',
            consoleSummary: this.consoleMessages.join('\n'),
        };
    }

    async waitForText(text: string) {
        return {
            currentUrl: this.currentUrl,
            domSummary: `Found ${text}`,
            consoleSummary: this.consoleMessages.join('\n'),
        };
    }

    async captureScreenshot(filePath: string) {
        return filePath;
    }

    getConsoleMessages(): string[] {
        return [...this.consoleMessages];
    }

    async close(): Promise<void> {
        this.active = false;
    }
}

test('BrowserSessionService launches lazily, persists screenshot artifacts, and updates state', async () => {
    const storage = createStorageStub();
    const adapter = new FakeBrowserAdapter();
    const service = new BrowserSessionService(storage as any, {
        adapterFactory: () => adapter,
        now: () => 1234567890,
    });

    const raw = await service.navigate('https://example.com/docs');
    const parsed = JSON.parse(raw);

    assert.equal(parsed.status, 'success');
    assert.equal(parsed.action, 'navigate');
    assert.equal(parsed.browserSessionState.active, true);
    assert.equal(parsed.currentUrl, 'https://example.com/docs');
    assert.ok(parsed.screenshotPath.includes('browser-navigate-1234567890'));
    assert.equal(storage.getArtifacts()[0].kind, 'screenshot');
});

test('BrowserSessionService captures console logs as local artifacts', async () => {
    const storage = createStorageStub();
    const adapter = new FakeBrowserAdapter();
    const service = new BrowserSessionService(storage as any, {
        adapterFactory: () => adapter,
        now: () => 222,
    });

    await service.navigate('https://example.com');
    const raw = await service.consoleLogs();
    const parsed = JSON.parse(raw);

    assert.equal(parsed.status, 'success');
    assert.equal(parsed.action, 'console_logs');
    assert.equal(storage.getArtifacts()[0].kind, 'console');
    assert.equal(parsed.browserSessionState.artifactCount, 2);
});

test('BrowserSessionService cleans up browser state on close and preserves crash recovery info', async () => {
    const storage = createStorageStub();
    const adapter = new FakeBrowserAdapter();
    const service = new BrowserSessionService(storage as any, {
        adapterFactory: () => adapter,
        now: () => 333,
    });

    await service.navigate('https://example.com');
    const closeRaw = await service.close();
    const closeParsed = JSON.parse(closeRaw);

    assert.equal(closeParsed.status, 'success');
    assert.equal(closeParsed.browserSessionState.active, false);
    assert.equal(closeParsed.browserSessionState.sessionId, undefined);

    const crashingAdapter = new FakeBrowserAdapter();
    crashingAdapter.click = async () => {
        throw new Error('Target closed');
    };

    const crashingService = new BrowserSessionService(storage as any, {
        adapterFactory: () => crashingAdapter,
        now: () => 444,
    });

    await crashingService.navigate('https://example.com');
    const crashRaw = await crashingService.click('#missing');
    const crashParsed = JSON.parse(crashRaw);

    assert.equal(crashParsed.status, 'error');
    assert.equal(crashParsed.browserSessionState.active, false);
    assert.ok(crashParsed.errorMessage.includes('Target closed'));
});
