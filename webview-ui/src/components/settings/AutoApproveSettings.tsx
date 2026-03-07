/**
 * AutoApproveSettings — per-tool-category auto-approval toggles
 * Cline-inspired: users can skip confirmation for trusted tool categories.
 */
import { useState, useEffect } from 'react';
import { vscode } from '../../vscode';
import type { AutoApproveConfig } from '../../types';
import { FileSearch, FileEdit, Terminal, Globe, Zap } from 'lucide-react';

const DEFAULT_CONFIG: AutoApproveConfig = {
  read_file: true,   // read is always safe — on by default
  write_file: false,
  run_command: false,
  web_fetch: false,
  all: false,
};

const STORAGE_KEY = 'codai_auto_approve_v1';

function loadConfig(): AutoApproveConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch { /* */ }
  return DEFAULT_CONFIG;
}

interface ToggleRowProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

function ToggleRow({ icon, label, description, checked, onChange, disabled }: ToggleRowProps) {
  return (
    <label className={`auto-approve-row${disabled ? ' auto-approve-row--disabled' : ''}`}>
      <span className="auto-approve-icon">{icon}</span>
      <span className="auto-approve-text">
        <span className="auto-approve-label">{label}</span>
        <span className="auto-approve-desc">{description}</span>
      </span>
      <span
        className={`auto-approve-toggle${checked ? ' auto-approve-toggle--on' : ''}`}
        onClick={() => !disabled && onChange(!checked)}
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); !disabled && onChange(!checked); } }}
      >
        <span className="auto-approve-toggle-thumb" />
      </span>
    </label>
  );
}

interface AutoApproveSettingsProps {
  onConfigChange?: (cfg: AutoApproveConfig) => void;
}

export function AutoApproveSettings({ onConfigChange }: AutoApproveSettingsProps) {
  const [config, setConfig] = useState<AutoApproveConfig>(loadConfig);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    vscode.postMessage({ type: 'setAutoApprove', config });
    onConfigChange?.(config);
  }, [config]);

  const toggle = (key: keyof AutoApproveConfig) => (val: boolean) => {
    if (key === 'all') {
      setConfig({ read_file: val, write_file: val, run_command: val, web_fetch: val, all: val });
    } else {
      setConfig(prev => {
        const next = { ...prev, [key]: val };
        next.all = next.read_file && next.write_file && next.run_command && next.web_fetch;
        return next;
      });
    }
  };

  return (
    <div className="auto-approve-section">
      <div className="auto-approve-header">
        <span className="auto-approve-title">Auto-Approve</span>
        <span className="auto-approve-subtitle">Skip confirmation for trusted actions</span>
      </div>

      <ToggleRow
        icon={<Zap size={12} />}
        label="Approve All"
        description="Auto-approve every tool action"
        checked={config.all}
        onChange={toggle('all')}
      />

      <div className="auto-approve-divider" />

      <ToggleRow
        icon={<FileSearch size={12} />}
        label="Read Files"
        description="read_file, list_directory, search_files"
        checked={config.read_file}
        onChange={toggle('read_file')}
      />
      <ToggleRow
        icon={<FileEdit size={12} />}
        label="Write Files"
        description="write_file, delete_file, create_directory"
        checked={config.write_file}
        onChange={toggle('write_file')}
      />
      <ToggleRow
        icon={<Terminal size={12} />}
        label="Run Commands"
        description="run_command, kill_bg_process"
        checked={config.run_command}
        onChange={toggle('run_command')}
      />
      <ToggleRow
        icon={<Globe size={12} />}
        label="Web Fetch"
        description="web_search, web_fetch"
        checked={config.web_fetch}
        onChange={toggle('web_fetch')}
      />
    </div>
  );
}

// ── Export config loader for use in TaskController ────────────────────────────
export { loadConfig as loadAutoApproveConfig };
