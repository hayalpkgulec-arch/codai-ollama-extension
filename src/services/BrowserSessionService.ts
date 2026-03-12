import { promises as fs } from 'fs';
import * as path from 'path';
import { existsSync } from 'fs';
import { WorkspaceStorage } from './WorkspaceStorage';
import type { BrowserActionName, BrowserArtifactEntry, BrowserSessionState } from './runtimeTypes';

type PuppeteerPage = any;
type PuppeteerBrowser = any;

export interface BrowserSnapshot {
    currentUrl?: string;
    domSummary?: string;
    consoleSummary?: string;
}

export interface BrowserAutomationAdapter {
    launch(): Promise<void>;
    isActive(): boolean;
    navigate(url: string): Promise<BrowserSnapshot>;
    click(selector: string): Promise<BrowserSnapshot>;
    type(selector: string, text: string, submit?: boolean): Promise<BrowserSnapshot>;
    scroll(input: { direction?: 'up' | 'down'; amount?: number; x?: number; y?: number }): Promise<BrowserSnapshot>;
    waitForText(text: string, timeoutMs: number): Promise<BrowserSnapshot & { matchedText?: string }>;
    captureScreenshot(filePath: string, fullPage?: boolean): Promise<string>;
    getConsoleMessages(): string[];
    close(): Promise<void>;
}

export interface BrowserActionPayload {
    __tool: 'browser_action';
    action: BrowserActionName;
    status: 'success' | 'error';
    summary: string;
    sessionId?: string;
    currentUrl?: string;
    domSummary?: string;
    consoleSummary?: string;
    screenshotPath?: string;
    artifactIds?: string[];
    durationMs: number;
    browserSessionState: BrowserSessionState;
    errorMessage?: string;
}

interface BrowserSessionServiceOptions {
    adapterFactory?: () => BrowserAutomationAdapter;
    now?: () => number;
}

const MAX_CONSOLE_MESSAGES = 100;

export class BrowserSessionService {
    private adapter: BrowserAutomationAdapter | null = null;
    private readonly adapterFactory: () => BrowserAutomationAdapter;
    private artifactsIndex: BrowserArtifactEntry[];
    private state: BrowserSessionState = {
        active: false,
        artifactCount: 0,
    };

    constructor(
        private readonly storage: WorkspaceStorage,
        private readonly options: BrowserSessionServiceOptions = {},
    ) {
        this.adapterFactory = options.adapterFactory ?? (() => new PuppeteerBrowserAdapter());
        this.artifactsIndex = this.storage.readBrowserArtifactsIndex<BrowserArtifactEntry[]>([]);
        this.state.artifactCount = this.artifactsIndex.length;
        if (this.artifactsIndex[0]?.path) {
            this.state.lastArtifactPath = this.artifactsIndex[0].path;
        }
    }

    public getState(): BrowserSessionState {
        return { ...this.state };
    }

    public getArtifactsIndex(): BrowserArtifactEntry[] {
        return [...this.artifactsIndex];
    }

    public async navigate(url: string): Promise<string> {
        return this.executeAction('navigate', async () => {
            ensureHttpUrl(url);
            const adapter = await this.ensureSession();
            const snapshot = await adapter.navigate(url);
            return this.attachAutoScreenshot('navigate', snapshot, { label: 'Navigate screenshot' });
        });
    }

    public async click(selector: string): Promise<string> {
        return this.executeAction('click', async () => {
            ensureNonEmpty(selector, 'selector');
            const adapter = await this.ensureSession();
            const snapshot = await adapter.click(selector);
            return this.attachAutoScreenshot('click', snapshot, { label: 'Click screenshot' });
        });
    }

    public async type(input: { selector: string; text: string; submit?: boolean }): Promise<string> {
        return this.executeAction('type', async () => {
            ensureNonEmpty(input.selector, 'selector');
            ensureNonEmpty(input.text, 'text');
            const adapter = await this.ensureSession();
            const snapshot = await adapter.type(input.selector, input.text, input.submit);
            return this.attachAutoScreenshot('type', snapshot, { label: 'Type screenshot' });
        });
    }

    public async scroll(input: { direction?: 'up' | 'down'; amount?: number; x?: number; y?: number }): Promise<string> {
        return this.executeAction('scroll', async () => {
            const adapter = await this.ensureSession();
            const snapshot = await adapter.scroll(input || {});
            return this.attachAutoScreenshot('scroll', snapshot, { label: 'Scroll screenshot' });
        });
    }

    public async waitForText(text: string, timeoutMs = 10_000): Promise<string> {
        return this.executeAction('wait_for_text', async () => {
            ensureNonEmpty(text, 'text');
            const adapter = await this.ensureSession();
            const snapshot = await adapter.waitForText(text, clamp(timeoutMs, 1_000, 30_000));
            return this.attachAutoScreenshot('wait_for_text', snapshot, { label: 'Wait result screenshot' });
        });
    }

    public async screenshot(fullPage = false): Promise<string> {
        return this.executeAction('screenshot', async () => {
            const adapter = await this.ensureSession();
            const artifact = await this.createScreenshotArtifact('screenshot', adapter, {
                label: fullPage ? 'Full page screenshot' : 'Viewport screenshot',
                fullPage,
            });
            const snapshot = await this.snapshotFromAdapter(adapter);
            return {
                snapshot: {
                    ...snapshot,
                    screenshotPath: artifact.path,
                },
                artifactIds: [artifact.id],
            };
        });
    }

    public async consoleLogs(): Promise<string> {
        return this.executeAction('console_logs', async () => {
            const adapter = await this.ensureSession();
            const consoleMessages = adapter.getConsoleMessages();
            const artifact = await this.createConsoleArtifact(consoleMessages);
            const snapshot = await this.snapshotFromAdapter(adapter);
            return {
                snapshot,
                artifactIds: [artifact.id],
            };
        });
    }

    public async close(): Promise<string> {
        return this.executeAction('close', async () => {
            if (this.adapter) {
                await this.adapter.close();
            }
            this.adapter = null;
            this.state = {
                ...this.state,
                active: false,
                sessionId: undefined,
                currentUrl: undefined,
                lastAction: 'close',
                lastActionAt: this.now(),
            };
            return {
                snapshot: {
                    currentUrl: '',
                    domSummary: 'Browser session closed.',
                    consoleSummary: '',
                },
                artifactIds: [],
            };
        }, { allowWithoutActiveSession: true });
    }

    private async executeAction(
        action: BrowserActionName,
        run: () => Promise<{ snapshot: BrowserSnapshot & { screenshotPath?: string }; artifactIds: string[] }>,
        options: { allowWithoutActiveSession?: boolean } = {},
    ): Promise<string> {
        const startedAt = this.now();
        try {
            if (!options.allowWithoutActiveSession && !this.state.active && action !== 'navigate') {
                await this.ensureSession();
            }
            const output = await run();
            this.state = {
                ...this.state,
                active: action === 'close' ? false : true,
                currentUrl: output.snapshot.currentUrl || this.state.currentUrl,
                lastAction: action,
                lastActionAt: this.now(),
                artifactCount: this.artifactsIndex.length,
                lastArtifactPath: output.snapshot.screenshotPath || this.state.lastArtifactPath,
                consoleMessageCount: this.adapter?.getConsoleMessages().length ?? this.state.consoleMessageCount,
                lastError: undefined,
            };
            return this.serialize({
                __tool: 'browser_action',
                action,
                status: 'success',
                summary: summarizeBrowserAction(action, output.snapshot.currentUrl),
                sessionId: this.state.sessionId,
                currentUrl: output.snapshot.currentUrl,
                domSummary: output.snapshot.domSummary,
                consoleSummary: output.snapshot.consoleSummary,
                screenshotPath: output.snapshot.screenshotPath,
                artifactIds: output.artifactIds,
                durationMs: this.now() - startedAt,
                browserSessionState: this.getState(),
            });
        } catch (error: any) {
            if (action !== 'close') {
                await this.resetSessionOnFailure(error);
            }
            return this.serialize({
                __tool: 'browser_action',
                action,
                status: 'error',
                summary: `Browser ${action} failed`,
                sessionId: this.state.sessionId,
                currentUrl: this.state.currentUrl,
                durationMs: this.now() - startedAt,
                browserSessionState: this.getState(),
                errorMessage: error?.message || 'Unknown browser error.',
            });
        }
    }

    private async ensureSession(): Promise<BrowserAutomationAdapter> {
        if (!this.adapter || !this.adapter.isActive()) {
            this.adapter = this.adapterFactory();
            await this.adapter.launch();
            this.state = {
                ...this.state,
                active: true,
                sessionId: `browser-${this.now()}`,
                lastActionAt: this.now(),
                consoleMessageCount: this.adapter.getConsoleMessages().length,
            };
        }
        return this.adapter;
    }

    private async attachAutoScreenshot(
        action: Exclude<BrowserActionName, 'console_logs' | 'close'>,
        snapshot: BrowserSnapshot,
        options: { label: string },
    ): Promise<{ snapshot: BrowserSnapshot & { screenshotPath?: string }; artifactIds: string[] }> {
        const adapter = await this.ensureSession();
        const artifact = await this.createScreenshotArtifact(action, adapter, options);
        return {
            snapshot: {
                ...snapshot,
                screenshotPath: artifact.path,
            },
            artifactIds: [artifact.id],
        };
    }

    private async snapshotFromAdapter(adapter: BrowserAutomationAdapter): Promise<BrowserSnapshot> {
        const consoleMessages = adapter.getConsoleMessages();
        return {
            currentUrl: this.state.currentUrl,
            domSummary: undefined,
            consoleSummary: consoleMessages.slice(-5).join('\n'),
        };
    }

    private async createScreenshotArtifact(
        action: BrowserActionName,
        adapter: BrowserAutomationAdapter,
        options: { label: string; fullPage?: boolean },
    ): Promise<BrowserArtifactEntry> {
        const sessionId = this.state.sessionId || `browser-${this.now()}`;
        this.state.sessionId = sessionId;
        const artifactId = `browser-${action}-${this.now()}`;
        const artifactPath = this.storage.getBrowserArtifactFilePath(sessionId, artifactId, 'png');
        await fs.mkdir(path.dirname(artifactPath), { recursive: true });
        const screenshotPath = await adapter.captureScreenshot(artifactPath, options.fullPage);
        return this.addArtifact({
            id: artifactId,
            sessionId,
            kind: 'screenshot',
            label: options.label,
            path: screenshotPath,
            createdAt: new Date().toISOString(),
            action,
        });
    }

    private async createConsoleArtifact(consoleMessages: string[]): Promise<BrowserArtifactEntry> {
        const sessionId = this.state.sessionId || `browser-${this.now()}`;
        this.state.sessionId = sessionId;
        const artifactId = `browser-console-${this.now()}`;
        const artifactPath = this.storage.getBrowserArtifactFilePath(sessionId, artifactId, 'log');
        await fs.mkdir(path.dirname(artifactPath), { recursive: true });
        await fs.writeFile(
            artifactPath,
            consoleMessages.length > 0 ? consoleMessages.join('\n') : '(no console messages)',
            'utf8',
        );
        return this.addArtifact({
            id: artifactId,
            sessionId,
            kind: 'console',
            label: 'Console log snapshot',
            path: artifactPath,
            createdAt: new Date().toISOString(),
            action: 'console_logs',
        });
    }

    private async addArtifact(entry: BrowserArtifactEntry): Promise<BrowserArtifactEntry> {
        this.artifactsIndex = [entry, ...this.artifactsIndex].slice(0, 100);
        await this.storage.writeBrowserArtifactsIndex(this.artifactsIndex);
        this.state.artifactCount = this.artifactsIndex.length;
        this.state.lastArtifactPath = entry.path;
        return entry;
    }

    private async resetSessionOnFailure(error: unknown): Promise<void> {
        const message = error instanceof Error ? error.message : 'Unknown browser error.';
        const shouldReset = /target closed|browser.*closed|protocol error|session closed/i.test(message);
        if (shouldReset && this.adapter) {
            try {
                await this.adapter.close();
            } catch {
                // Ignore cleanup failures.
            }
            this.adapter = null;
        }
        this.state = {
            ...this.state,
            sessionId: shouldReset ? undefined : this.state.sessionId,
            active: this.adapter?.isActive() ?? false,
            lastError: message,
            lastActionAt: this.now(),
        };
    }

    private now(): number {
        return this.options.now ? this.options.now() : Date.now();
    }

    private serialize(payload: BrowserActionPayload): string {
        return JSON.stringify(payload);
    }
}

class PuppeteerBrowserAdapter implements BrowserAutomationAdapter {
    private browser: PuppeteerBrowser | null = null;
    private page: PuppeteerPage | null = null;
    private readonly consoleMessages: string[] = [];

    public async launch(): Promise<void> {
        if (this.isActive()) return;

        const executablePath = findBrowserExecutable();
        if (!executablePath) {
            throw new Error('No local Chrome, Edge, or Brave executable was found for browser tools.');
        }

        const puppeteer = loadPuppeteerCore();
        this.browser = await puppeteer.launch({
            executablePath,
            headless: true,
            defaultViewport: { width: 1440, height: 900 },
            args: ['--disable-dev-shm-usage'],
        });
        this.page = await this.browser.newPage();
        this.page.on('console', (message: any) => {
            this.consoleMessages.push(`[${message.type()}] ${message.text()}`);
            if (this.consoleMessages.length > MAX_CONSOLE_MESSAGES) {
                this.consoleMessages.splice(0, this.consoleMessages.length - MAX_CONSOLE_MESSAGES);
            }
        });
    }

    public isActive(): boolean {
        return Boolean(this.page && !this.page.isClosed?.());
    }

    public async navigate(url: string): Promise<BrowserSnapshot> {
        const page = await this.ensurePage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        return this.collectSnapshot();
    }

    public async click(selector: string): Promise<BrowserSnapshot> {
        const page = await this.ensurePage();
        await page.waitForSelector(selector, { timeout: 10_000 });
        await page.click(selector);
        return this.collectSnapshot();
    }

    public async type(selector: string, text: string, submit?: boolean): Promise<BrowserSnapshot> {
        const page = await this.ensurePage();
        await page.waitForSelector(selector, { timeout: 10_000 });
        await page.click(selector, { clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.type(selector, text);
        if (submit) {
            await page.keyboard.press('Enter');
        }
        return this.collectSnapshot();
    }

    public async scroll(input: { direction?: 'up' | 'down'; amount?: number; x?: number; y?: number }): Promise<BrowserSnapshot> {
        const page = await this.ensurePage();
        const amount = clamp(input.amount ?? 700, 100, 5_000);
        const x = typeof input.x === 'number' ? input.x : 0;
        const y = typeof input.y === 'number'
            ? input.y
            : (input.direction === 'up' ? -amount : amount);
        await page.evaluate(({ scrollX, scrollY }) => {
            (globalThis as any).scrollBy(scrollX, scrollY);
        }, { scrollX: x, scrollY: y });
        return this.collectSnapshot();
    }

    public async waitForText(text: string, timeoutMs: number): Promise<BrowserSnapshot & { matchedText?: string }> {
        const page = await this.ensurePage();
        await page.waitForFunction(
            (needle: string) => {
                const doc = (globalThis as any).document;
                return Boolean(doc?.body?.innerText?.includes(needle));
            },
            { timeout: timeoutMs },
            text,
        );
        return this.collectSnapshot();
    }

    public async captureScreenshot(filePath: string, fullPage = false): Promise<string> {
        const page = await this.ensurePage();
        await page.screenshot({ path: filePath, fullPage, type: 'png' });
        return filePath;
    }

    public getConsoleMessages(): string[] {
        return [...this.consoleMessages];
    }

    public async close(): Promise<void> {
        if (this.page && !this.page.isClosed?.()) {
            await this.page.close();
        }
        if (this.browser) {
            await this.browser.close();
        }
        this.page = null;
        this.browser = null;
    }

    private async ensurePage(): Promise<PuppeteerPage> {
        if (!this.isActive()) {
            await this.launch();
        }
        if (!this.page) {
            throw new Error('Browser page is not available.');
        }
        return this.page;
    }

    private async collectSnapshot(): Promise<BrowserSnapshot> {
        const page = await this.ensurePage();
        const currentUrl = page.url();
        const title = await page.title().catch(() => '');
        const bodyText = await page.evaluate(() => {
            const doc = (globalThis as any).document;
            const text = doc?.body?.innerText || '';
            return text.replace(/\s+/g, ' ').trim().slice(0, 400);
        }).catch(() => '');
        return {
            currentUrl,
            domSummary: [title, bodyText].filter(Boolean).join(' - '),
            consoleSummary: this.consoleMessages.slice(-5).join('\n'),
        };
    }
}

function loadPuppeteerCore(): any {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('puppeteer-core');
}

function findBrowserExecutable(): string | null {
    const candidates = process.platform === 'win32'
        ? windowsBrowserCandidates()
        : process.platform === 'darwin'
            ? macBrowserCandidates()
            : linuxBrowserCandidates();

    for (const candidate of candidates) {
        if (candidate && existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

function windowsBrowserCandidates(): string[] {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA || '';
    return [
        path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        path.join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ];
}

function macBrowserCandidates(): string[] {
    return [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ];
}

function linuxBrowserCandidates(): string[] {
    return [
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/microsoft-edge',
        '/usr/bin/brave-browser',
    ];
}

function summarizeBrowserAction(action: BrowserActionName, currentUrl?: string): string {
    const target = currentUrl ? ` on ${safeUrlLabel(currentUrl)}` : '';
    const labels: Record<BrowserActionName, string> = {
        navigate: `Navigated${target}`,
        click: `Clicked${target}`,
        type: `Typed${target}`,
        scroll: `Scrolled${target}`,
        wait_for_text: `Waited for text${target}`,
        screenshot: `Captured screenshot${target}`,
        console_logs: `Captured console logs${target}`,
        close: 'Closed browser session',
    };
    return labels[action];
}

function safeUrlLabel(value: string): string {
    try {
        return new URL(value).host;
    } catch {
        return value;
    }
}

function ensureHttpUrl(value: string): void {
    const normalized = String(value || '').trim();
    if (!normalized) {
        throw new Error('A URL is required.');
    }
    const url = new URL(normalized);
    if (!/^https?:$/i.test(url.protocol)) {
        throw new Error('Browser navigation only supports http:// and https:// URLs.');
    }
}

function ensureNonEmpty(value: string, field: string): void {
    if (!String(value || '').trim()) {
        throw new Error(`Browser ${field} cannot be empty.`);
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}
