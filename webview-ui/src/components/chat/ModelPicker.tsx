import { useState, useRef, useEffect, useMemo, memo } from 'react';
import { ChevronDown, Cloud, Cpu, Search } from 'lucide-react';
import type { ModelDef } from '../../types';

interface ModelPickerProps {
    models: ModelDef[];
    selected: ModelDef;
    onChange: (m: ModelDef) => void;
    disabled?: boolean;
}

export const ModelPicker = memo(({ models, selected, onChange, disabled }: ModelPickerProps) => {
    const [open, setOpen]       = useState(false);
    const [query, setQuery]     = useState('');
    const ref                   = useRef<HTMLDivElement>(null);
    const searchRef             = useRef<HTMLInputElement>(null);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
                setQuery('');
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    // Focus search when opened
    useEffect(() => {
        if (open) setTimeout(() => searchRef.current?.focus(), 50);
        else setQuery('');
    }, [open]);

    const filtered = useMemo(() => {
        const q = query.toLowerCase().trim();
        if (!q) return models;
        return models.filter(m =>
            m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
        );
    }, [models, query]);

    const cloud = filtered.filter(m => m.tag === 'cloud');
    const local = filtered.filter(m => m.tag === 'local');

    const pick = (m: ModelDef) => { onChange(m); setOpen(false); setQuery(''); };

    return (
        <div className={`model-picker${open ? ' open' : ''}`} ref={ref}>
            <button
                className="model-picker-trigger"
                onClick={() => !disabled && setOpen(o => !o)}
                disabled={disabled}
                title={selected.id}
            >
                {selected.tag === 'cloud'
                    ? <Cloud size={10} className="model-tag-icon cloud" />
                    : <Cpu  size={10} className="model-tag-icon local" />}
                <span className="model-picker-label">{selected.label}</span>
                <ChevronDown size={10} className={`model-picker-chevron${open ? ' open' : ''}`} />
            </button>

            {open && (
                <div className="model-picker-dropdown">
                    {/* Search */}
                    <div className="model-search-wrap">
                        <Search size={10} className="model-search-icon" />
                        <input
                            ref={searchRef}
                            className="model-search-input"
                            placeholder="Search models…"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            onKeyDown={e => e.key === 'Escape' && (setOpen(false), setQuery(''))}
                        />
                    </div>

                    {/* Scrollable list */}
                    <div className="model-picker-list">
                        {cloud.length > 0 && (
                            <div className="model-group">
                                <div className="model-group-label"><Cloud size={9} /> Cloud</div>
                                {cloud.map(m => (
                                    <button
                                        key={m.id}
                                        className={`model-option${m.id === selected.id ? ' active' : ''}`}
                                        onClick={() => pick(m)}
                                        title={m.id}
                                    >
                                        <span className="model-option-label">{m.label || m.id}</span>
                                        {m.id === selected.id && <span className="model-option-check">✓</span>}
                                    </button>
                                ))}
                            </div>
                        )}
                        {local.length > 0 && (
                            <div className="model-group">
                                <div className="model-group-label"><Cpu size={9} /> Local</div>
                                {local.map(m => (
                                    <button
                                        key={m.id}
                                        className={`model-option${m.id === selected.id ? ' active' : ''}`}
                                        onClick={() => pick(m)}
                                        title={m.id}
                                    >
                                        <span className="model-option-label">{m.label || m.id}</span>
                                        {m.id === selected.id && <span className="model-option-check">✓</span>}
                                    </button>
                                ))}
                            </div>
                        )}
                        {filtered.length === 0 && (
                            <div className="model-no-results">No models match "{query}"</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
});
ModelPicker.displayName = 'ModelPicker';
