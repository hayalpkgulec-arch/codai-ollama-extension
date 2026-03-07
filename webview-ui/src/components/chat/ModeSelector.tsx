import { useState, useRef, useEffect, memo } from 'react';
import { ChevronDown, Code2, BookOpen, MessageCircle } from 'lucide-react';
import type { AgentMode } from '../../types';

export interface ModeDef {
    id: AgentMode;
    label: string;
    shortLabel: string;
    description: string;
    icon: React.ReactNode;
}

export const MODES: ModeDef[] = [
    {
        id: 'code',
        label: 'Code',
        shortLabel: 'Code',
        description: 'Full agent — reads, writes, runs commands',
        icon: <Code2 size={11} />,
    },
    {
        id: 'plan',
        label: 'Plan',
        shortLabel: 'Plan',
        description: 'Analyze & plan — no file writes',
        icon: <BookOpen size={11} />,
    },
    {
        id: 'chat',
        label: 'Chat',
        shortLabel: 'Chat',
        description: 'Conversational — no tools',
        icon: <MessageCircle size={11} />,
    },
];

interface ModeSelectorProps {
    selected: ModeDef;
    onChange: (mode: ModeDef) => void;
    disabled?: boolean;
}

export const ModeSelector = memo(({ selected, onChange, disabled }: ModeSelectorProps) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const h = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, [open]);

    return (
        <div className={`mode-selector${open ? ' open' : ''}`} ref={ref}>
            <button
                className="mode-trigger"
                onClick={() => !disabled && setOpen(o => !o)}
                disabled={disabled}
                title={selected.description}
            >
                <span className={`mode-icon mode-icon-${selected.id}`}>{selected.icon}</span>
                <span className="mode-label">{selected.shortLabel}</span>
                <ChevronDown size={9} className={`mode-chevron${open ? ' open' : ''}`} />
            </button>

            {open && (
                <div className="mode-dropdown">
                    {MODES.map(m => (
                        <button
                            key={m.id}
                            className={`mode-option${m.id === selected.id ? ' active' : ''}`}
                            onClick={() => { onChange(m); setOpen(false); }}
                        >
                            <span className={`mode-option-icon mode-icon-${m.id}`}>{m.icon}</span>
                            <div className="mode-option-text">
                                <span className="mode-option-label">{m.label}</span>
                                <span className="mode-option-desc">{m.description}</span>
                            </div>
                            {m.id === selected.id && <span className="mode-option-check">✓</span>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
});
ModeSelector.displayName = 'ModeSelector';
