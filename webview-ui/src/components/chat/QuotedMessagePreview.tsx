/**
 * QuotedMessagePreview — Cline/Kilo-style quote preview above the input bar
 */
import { X, Quote } from 'lucide-react';

interface QuotedMessagePreviewProps {
  text: string;
  onRemove: () => void;
}

export function QuotedMessagePreview({ text, onRemove }: QuotedMessagePreviewProps) {
  const preview = text.length > 120 ? text.slice(0, 117) + '…' : text;

  return (
    <div className="quoted-preview">
      <Quote size={10} className="quoted-preview-icon" />
      <span className="quoted-preview-text">{preview}</span>
      <button className="quoted-preview-remove" onClick={onRemove} title="Remove quote">
        <X size={10} />
      </button>
    </div>
  );
}
