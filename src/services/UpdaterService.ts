import * as vscode from 'vscode';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';

const GITHUB_REPO    = 'hayalpkgulec-arch/codai-ollama-extension';
const GITHUB_API     = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const CHECK_INTERVAL = 30 * 60 * 1000; // 30 dakika

export class UpdaterService {
    private _timer?: ReturnType<typeof setInterval>;
    private _statusBar?: vscode.StatusBarItem;
    private _updateCommandRegistered = false;
    private _log: vscode.OutputChannel;

    constructor(private readonly context: vscode.ExtensionContext) {
        this._log = vscode.window.createOutputChannel('CodAI Updater');
        context.subscriptions.push(this._log);
    }

    // ── Public API ─────────────────────────────────────────────────────────────

    public start() {
        this._log.appendLine(`[Updater] start() — current version: ${this.currentVersion()}`);
        this._log.appendLine(`[Updater] execPath: ${process.execPath}`);

        // Manuel "Check for updates" komutu — Command Palette'te görünür
        const checkCmd = vscode.commands.registerCommand('codai.checkUpdate', () => {
            this._log.appendLine('[Updater] Manual check triggered');
            this._log.show(true);
            this.checkForUpdate();
        });
        this.context.subscriptions.push(checkCmd);

        // Startup'ta anında kontrol (2 sn bekle — extension host hazır olsun)
        setTimeout(() => {
            this._log.appendLine('[Updater] Startup check...');
            this.checkForUpdate();
        }, 2000);

        // Periyodik kontrol
        this._timer = setInterval(() => this.checkForUpdate(), CHECK_INTERVAL);
        this.context.subscriptions.push({ dispose: () => this.dispose() });
    }

    public dispose() {
        if (this._timer) clearInterval(this._timer);
        this._statusBar?.dispose();
    }

    // ── Core logic ─────────────────────────────────────────────────────────────

    public async checkForUpdate(): Promise<void> {
        const current = this.currentVersion();
        this._log.appendLine(`[Updater] Checking... current=${current}`);

        let release: any;
        try {
            release = await this.fetchLatestRelease();
        } catch (err: any) {
            this._log.appendLine(`[Updater] fetchLatestRelease ERROR: ${err.message}`);
            return;
        }

        if (!release) {
            this._log.appendLine('[Updater] No release found (404 or empty)');
            return;
        }

        const latest = release.tag_name.replace(/^v/, '');
        this._log.appendLine(`[Updater] latest=${latest} current=${current} isNewer=${this.isNewer(latest, current)}`);

        if (!this.isNewer(latest, current)) {
            this._log.appendLine('[Updater] Already up to date.');
            return;
        }

        const vsixAsset = (release.assets as any[]).find((a: any) => a.name.endsWith('.vsix'));
        if (!vsixAsset) {
            this._log.appendLine('[Updater] No .vsix asset found in release!');
            return;
        }

        this._log.appendLine(`[Updater] Update available! ${current} → ${latest}, asset: ${vsixAsset.name}`);
        this.showUpdateNotification(current, latest, vsixAsset.browser_download_url);
    }

    private showUpdateNotification(current: string, latest: string, downloadUrl: string) {
        // Status bar badge
        if (!this._statusBar) {
            this._statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
            this.context.subscriptions.push(this._statusBar);
        }
        this._statusBar.command = 'codai.installUpdate';
        this._statusBar.text = `$(arrow-circle-up) CodAI ${latest}`;
        this._statusBar.tooltip = `CodAI güncellemesi: v${current} → v${latest}. Tıkla yükle.`;
        this._statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this._statusBar.show();

        // installUpdate komutunu bir kez register et
        if (!this._updateCommandRegistered) {
            this._updateCommandRegistered = true;
            const cmd = vscode.commands.registerCommand('codai.installUpdate', () =>
                this.installUpdate(downloadUrl, latest)
            );
            this.context.subscriptions.push(cmd);
        }

        // Popup
        vscode.window.showInformationMessage(
            `CodAI güncellemesi mevcut: v${current} → v${latest}`,
            'Şimdi Güncelle',
            'Sonra'
        ).then(choice => {
            if (choice === 'Şimdi Güncelle') this.installUpdate(downloadUrl, latest);
        });
    }

    public async installUpdate(downloadUrl: string, version: string): Promise<void> {
        this._log.appendLine(`[Updater] Installing v${version} from ${downloadUrl}`);
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `CodAI v${version} yükleniyor…`, cancellable: false },
            async (progress) => {
                try {
                    progress.report({ increment: 10, message: 'İndiriliyor…' });
                    const vsixPath = await this.downloadFile(downloadUrl, `codai-${version}.vsix`);
                    this._log.appendLine(`[Updater] Downloaded to ${vsixPath}`);

                    progress.report({ increment: 60, message: 'Yükleniyor…' });
                    await this.installVsix(vsixPath);
                    this._log.appendLine(`[Updater] Installed successfully`);

                    progress.report({ increment: 30, message: 'Tamamlandı!' });
                    try { fs.unlinkSync(vsixPath); } catch { /* ignore */ }
                    this._statusBar?.hide();

                    const reload = await vscode.window.showInformationMessage(
                        `CodAI v${version} yüklendi. Değişikliklerin aktif olması için yeniden yükle.`,
                        'Şimdi Yeniden Yükle'
                    );
                    if (reload) vscode.commands.executeCommand('workbench.action.reloadWindow');
                } catch (err: any) {
                    this._log.appendLine(`[Updater] Install ERROR: ${err.message}`);
                    vscode.window.showErrorMessage(`CodAI güncelleme hatası: ${err.message}`);
                }
            }
        );
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private fetchLatestRelease(): Promise<any> {
        return new Promise((resolve, reject) => {
            const options = {
                headers: {
                    'User-Agent': 'CodAI-Updater/1.0',
                    'Accept': 'application/vnd.github.v3+json',
                }
            };
            this._log.appendLine(`[Updater] GET ${GITHUB_API}`);
            https.get(GITHUB_API, options, (res) => {
                this._log.appendLine(`[Updater] HTTP ${res.statusCode}`);
                if (res.statusCode === 404) { resolve(null); return; }
                if (res.statusCode !== 200) { reject(new Error(`GitHub API: ${res.statusCode}`)); return; }
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); }
                    catch (e) { reject(e); }
                });
            }).on('error', (err) => {
                this._log.appendLine(`[Updater] Network error: ${err.message}`);
                reject(err);
            });
        });
    }

    private downloadFile(url: string, filename: string): Promise<string> {
        const dest = path.join(os.tmpdir(), filename);
        return new Promise((resolve, reject) => {
            const follow = (redirectUrl: string) => {
                this._log.appendLine(`[Updater] Downloading: ${redirectUrl}`);
                https.get(redirectUrl, { headers: { 'User-Agent': 'CodAI-Updater/1.0' } }, (res) => {
                    if (res.statusCode === 302 || res.statusCode === 301) {
                        follow(res.headers.location!);
                        return;
                    }
                    if (res.statusCode !== 200) {
                        reject(new Error(`Download failed: ${res.statusCode}`));
                        return;
                    }
                    const file = fs.createWriteStream(dest);
                    res.pipe(file);
                    file.on('finish', () => file.close(() => resolve(dest)));
                    file.on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
                }).on('error', reject);
            };
            follow(url);
        });
    }

    private installVsix(vsixPath: string): Promise<void> {
        // VSCodium.exe / Code.exe → GUI binary, --install-extension desteklemiyor
        // CLI binary'leri PATH'te veya exe'nin yanındaki bin/ klasöründe
        const candidates = this.buildCliCandidates();
        this._log.appendLine(`[Updater] CLI candidates: ${candidates.join(', ')}`);
        return new Promise((resolve, reject) => {
            this.tryExecCandidates(candidates, vsixPath, resolve, reject);
        });
    }

    private buildCliCandidates(): string[] {
        const execDir = path.dirname(process.execPath);

        if (process.platform === 'win32') {
            return [
                // VSCodium: bin/ klasöründe codium.cmd
                path.join(execDir, 'bin', 'codium.cmd'),
                path.join(execDir, 'bin', 'code.cmd'),
                // VS Code: Resources/app/bin/
                path.join(execDir, 'resources', 'app', 'bin', 'code.cmd'),
                // PATH'teki global komutlar
                'codium.cmd',
                'code.cmd',
                'codium',
                'code',
            ];
        } else {
            return [
                path.join(execDir, 'bin', 'codium'),
                path.join(execDir, 'bin', 'code'),
                'codium',
                'code',
            ];
        }
    }

    private tryExecCandidates(candidates: string[], vsixPath: string, resolve: () => void, reject: (e: Error) => void) {
        if (candidates.length === 0) {
            reject(new Error('No suitable VS Code / VSCodium CLI found. Please install manually.'));
            return;
        }
        const [current, ...rest] = candidates;
        this._log.appendLine(`[Updater] Trying CLI: ${current}`);
        execFile(current, ['--install-extension', vsixPath, '--force'], (err, stdout) => {
            if (err) {
                this._log.appendLine(`[Updater] Failed (${current}): ${err.message.split('\n')[0]}`);
                this.tryExecCandidates(rest, vsixPath, resolve, reject);
            } else {
                this._log.appendLine(`[Updater] Success with: ${current}\n${stdout}`);
                resolve();
            }
        });
    }

    private currentVersion(): string {
        return this.context.extension.packageJSON.version as string;
    }

    private isNewer(latest: string, current: string): boolean {
        const parse = (v: string) => v.split('.').map(Number);
        const [lMaj, lMin, lPat] = parse(latest);
        const [cMaj, cMin, cPat] = parse(current);
        if (lMaj !== cMaj) return lMaj > cMaj;
        if (lMin !== cMin) return lMin > cMin;
        return lPat > cPat;
    }
}
