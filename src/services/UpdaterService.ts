import * as vscode from 'vscode';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';

const GITHUB_REPO = 'hayalpkgulec-arch/codai-ollama-extension';
const GITHUB_API  = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 dakika

export class UpdaterService {
    private _timer?: ReturnType<typeof setInterval>;
    private _statusBar?: vscode.StatusBarItem;

    constructor(private readonly context: vscode.ExtensionContext) {}

    // ── Public API ─────────────────────────────────────────────────────────────

    public start() {
        // İlk kontrol — 10 saniye sonra (VS Code startup'ı bekle)
        setTimeout(() => this.checkForUpdate(), 10_000);
        // Periyodik kontrol
        this._timer = setInterval(() => this.checkForUpdate(), CHECK_INTERVAL_MS);
        this.context.subscriptions.push({ dispose: () => this.dispose() });
    }

    public dispose() {
        if (this._timer) clearInterval(this._timer);
        this._statusBar?.dispose();
    }

    // ── Core logic ─────────────────────────────────────────────────────────────

    private async checkForUpdate(): Promise<void> {
        try {
            const release = await this.fetchLatestRelease();
            if (!release) return;

            const latest  = release.tag_name.replace(/^v/, '');
            const current = this.context.extension.packageJSON.version as string;

            if (!this.isNewer(latest, current)) return;

            // Yeni versiyon var
            const vsixAsset = (release.assets as any[]).find(
                (a: any) => a.name.endsWith('.vsix')
            );
            if (!vsixAsset) return;

            this.showUpdateNotification(current, latest, vsixAsset.browser_download_url);
        } catch {
            // Sessizce yut — ağ yoksa rahatsız etme
        }
    }

    private showUpdateNotification(current: string, latest: string, downloadUrl: string) {
        // Status bar badge
        if (!this._statusBar) {
            this._statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
            this._statusBar.command = 'codai.installUpdate';
            this.context.subscriptions.push(this._statusBar);
        }
        this._statusBar.text = `$(arrow-circle-up) CodAI ${latest}`;
        this._statusBar.tooltip = `CodAI güncellemesi mevcut: ${current} → ${latest}. Tıkla yükle.`;
        this._statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this._statusBar.show();

        // Bildirim popup
        vscode.window.showInformationMessage(
            `CodAI güncellemesi mevcut: v${current} → v${latest}`,
            'Şimdi Güncelle',
            'Sonra'
        ).then(choice => {
            if (choice === 'Şimdi Güncelle') {
                this.installUpdate(downloadUrl, latest);
            }
        });

        // Komutu kaydet (status bar tıklaması için)
        this.context.subscriptions.push(
            vscode.commands.registerCommand('codai.installUpdate', () =>
                this.installUpdate(downloadUrl, latest)
            )
        );
    }

    public async installUpdate(downloadUrl: string, version: string): Promise<void> {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `CodAI v${version} indiriliyor…`,
                cancellable: false,
            },
            async (progress) => {
                try {
                    progress.report({ increment: 10, message: 'İndiriliyor…' });
                    const vsixPath = await this.downloadFile(downloadUrl, `codai-${version}.vsix`);

                    progress.report({ increment: 60, message: 'Yükleniyor…' });
                    await this.installVsix(vsixPath);

                    progress.report({ increment: 30, message: 'Tamamlandı!' });

                    // Temp dosyayı temizle
                    try { fs.unlinkSync(vsixPath); } catch { /* ignore */ }

                    this._statusBar?.hide();

                    const reload = await vscode.window.showInformationMessage(
                        `CodAI v${version} başarıyla yüklendi. Değişikliklerin aktif olması için yeniden yükle.`,
                        'Şimdi Yeniden Yükle'
                    );
                    if (reload) {
                        vscode.commands.executeCommand('workbench.action.reloadWindow');
                    }
                } catch (err: any) {
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
            https.get(GITHUB_API, options, (res) => {
                if (res.statusCode === 404) { resolve(null); return; }
                if (res.statusCode !== 200) { reject(new Error(`GitHub API: ${res.statusCode}`)); return; }
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); }
                    catch (e) { reject(e); }
                });
            }).on('error', reject);
        });
    }

    private downloadFile(url: string, filename: string): Promise<string> {
        const dest = path.join(os.tmpdir(), filename);
        return new Promise((resolve, reject) => {
            const follow = (redirectUrl: string) => {
                https.get(redirectUrl, { headers: { 'User-Agent': 'CodAI-Updater/1.0' } }, (res) => {
                    // GitHub asset download → 302 redirect
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
                    file.on('error', err => { fs.unlink(dest, () => {}); reject(err); });
                }).on('error', reject);
            };
            follow(url);
        });
    }

    private installVsix(vsixPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            // VS Code CLI yolu
            const codeExe = process.platform === 'win32' ? 'code.cmd' : 'code';
            execFile(codeExe, ['--install-extension', vsixPath, '--force'], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    /** Semantic version karşılaştırması: latest > current mu? */
    private isNewer(latest: string, current: string): boolean {
        const parse = (v: string) => v.split('.').map(Number);
        const [lMaj, lMin, lPat] = parse(latest);
        const [cMaj, cMin, cPat] = parse(current);
        if (lMaj !== cMaj) return lMaj > cMaj;
        if (lMin !== cMin) return lMin > cMin;
        return lPat > cPat;
    }
}
