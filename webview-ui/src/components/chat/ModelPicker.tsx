import { useState, useRef, useEffect, memo } from 'react';
import { ChevronDown, Cloud, Cpu } from 'lucide-react';
import type { ModelDef } from '../../App';

interface ModelPickerProps {
    models: ModelDef[];
    selected: ModelDef;
    onChange: (m: ModelDef) => void;
    disabled?: boolean;
}

export const ModelPicker = memo(({ models, selected, onChange, disabled }: ModelPickerProps) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const cloud = models.filter(m => m.tag === 'cloud');
    const local = models.filter(m => m.tag === 'local');

    return (
        <div className="model-picker" ref={ref}>
            <button
                className="model-picker-trigger"
                onClick={() => !disabled && setOpen(o => !o)}
                disabled={disabled}
                title={selected.id}
            >
                {selected.tag === 'cloud'
                    ? <Cloud size={10} className="model-tag-icon cloud" />
                    : <Cpu size={10} className="model-tag-icon local" />}
                <span className="model-picker-label">{selected.label}</span>
                <ChevronDown size={10} className={`model-picker-chevron${open ? ' open' : ''}`} />
            </button>

            {open && (
                <div className="model-picker-dropdown">
                    {cloud.length > 0 && (
                        <div className="model-group">
                            <div className="model-group-label"><Cloud size={9} /> Cloud</div>
                            {cloud.map(m => (
                                <button
                                    key={m.id}
                                    className={`model-option${m.id === selected.id ? ' active' : ''}`}
                                    onClick={() => { onChange(m); setOpen(false); }}
                                >
                                    <span className="model-option-label">{m.label}</span>
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
                                    onClick={() => { onChange(m); setOpen(false); }}
                                >
                                    <span className="model-option-label">{m.label}</span>
                                    {m.id === selected.id && <span className="model-option-check">✓</span>}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
});
ModelPicker.displayName = 'ModelPicker';
