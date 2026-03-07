import React, { useState, useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Check, Copy } from 'lucide-react';

/* ── Code block with copy button ─────────────────────────── */
function CodeBlock({ code, lang }: { code: string; lang?: string }) {
    const [copied, setCopied] = useState(false);

    const copy = () => {
        navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
        });
    };

    // Basic syntax token highlighting (no external dep)
    const highlighted = useMemo(() => applySyntaxHighlight(code, lang), [code, lang]);

    return (
        <div className="md-code-block">
            <div className="md-code-header">
                <span className="md-code-lang">{lang || 'code'}</span>
                <button className="md-code-copy" onClick={copy} title="Copy code">
                    {copied ? <Check size={11} /> : <Copy size={11} />}
                    {copied ? 'Copied!' : 'Copy'}
                </button>
            </div>
            <pre className="md-pre">
                <code
                    className={lang ? `language-${lang}` : ''}
                    dangerouslySetInnerHTML={{ __html: highlighted }}
                />
            </pre>
        </div>
    );
}

/* ── Minimal syntax highlighter — no external deps ─────────── */
function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function applySyntaxHighlight(code: string, lang?: string): string {
    const escaped = escapeHtml(code);
    if (!lang || ['text', 'plain', 'txt'].includes(lang)) return escaped;

    // JS / TS / JSX / TSX / Python / Rust / Go / Java families
    const isJS = /^(js|javascript|jsx|ts|typescript|tsx|mjs|cjs)$/.test(lang);
    const isPy = lang === 'python' || lang === 'py';
    const isRust = lang === 'rust' || lang === 'rs';

    // Strings
    let out = escaped.replace(
        /(&quot;(?:[^&]|&(?!quot;))*&quot;|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g,
        '<span class="sh-string">$1</span>'
    );

    // Comments
    if (isJS || isRust) {
        out = out.replace(/(\/\/[^\n]*)/g, '<span class="sh-comment">$1</span>');
        out = out.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="sh-comment">$1</span>');
    }
    if (isPy) {
        out = out.replace(/(#[^\n]*)/g, '<span class="sh-comment">$1</span>');
    }

    // Keywords
    const kwJS = /\b(const|let|var|function|return|if|else|for|while|class|import|export|default|async|await|new|this|typeof|instanceof|throw|try|catch|finally|type|interface|enum|extends|implements|from|of|in|true|false|null|undefined|void|never|any|string|number|boolean)\b/g;
    const kwPy = /\b(def|return|if|elif|else|for|while|class|import|from|as|with|try|except|finally|raise|pass|break|continue|lambda|yield|True|False|None|and|or|not|in|is)\b/g;
    const kwRust = /\b(fn|let|mut|const|use|pub|struct|enum|impl|trait|for|while|if|else|match|return|true|false|self|super|mod|crate|where|async|await|move|ref|unsafe)\b/g;

    const kw = isJS ? kwJS : isPy ? kwPy : isRust ? kwRust : kwJS;
    out = out.replace(kw, '<span class="sh-kw">$1</span>');

    // Numbers
    out = out.replace(/\b(\d+\.?\d*)\b/g, '<span class="sh-num">$1</span>');

    // Function calls
    out = out.replace(/\b([a-zA-Z_]\w*)\s*(?=\()/g, '<span class="sh-fn">$1</span>');

    return out;
}

/* ── BUG 7 FIX: Improved markdown parser ──────────────────── */
// Supports: ``` with/without lang, ``` with no newline, indented code, etc.
function parseMarkdown(content: string): React.ReactNode[] {
    if (!content) return [];

    // ── Modelin metin içinde yazdığı tool call artifact'larını temizle ──────
    const cleaned = content
        // <tool_call_begin> ... <tool_call_end> blokları
        .replace(/<\s*\|?\s*tool_call_begin\s*\|?\s*>[\s\S]*?<\s*\|?\s*tool_call_end\s*\|?\s*>/gi, '')
        .replace(/<\s*\|?\s*tool_call_begin\s*\|?\s*>[\s\S]*$/gi, '')
        .replace(/[<＜][^>＞]*tool[\s_▁-]*calls?[\s_▁-]*(begin|end)[^>＞]*[>＞]/giu, '')
        // Groq/Qwen modellerin metin içinde yazdığı JSON tool call satırları:
        // {"name":"list_files","arguments":{"path":"."}}
        // [{"name":"...","arguments":{...}}, ...]
        .replace(/^\s*(\[?\s*\{[^{}]*"name"\s*:\s*"[a-z_]+"[^{}]*"arguments"\s*:[^}]*\}[^}]*\}+\s*\]?\s*,?\s*)+/gm, '')
        // Tek satır tool call JSON
        .replace(/\{[^{}]*"name"\s*:\s*"[a-z_]+"[^{}]*"arguments"\s*:\s*\{[^{}]*\}\s*\}/g, '')
        // Trailing virgüller ve boş satırlar kaldıktan sonra temizle
        .replace(/,\s*\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    if (!cleaned) return [];

    // BUG 7 FIX: Robust split — handles ``` with or without lang, with optional space
    const parts = cleaned.split(/(```(?:[\w.\-+#]*)[ \t]*\n[\s\S]*?```)/g);

    const nodes: React.ReactNode[] = [];

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part) continue;

        // Try to match as fenced code block
        const codeMatch = part.match(/^```([\w.\-+#]*?)[ \t]*\n([\s\S]*?)```$/);
        if (codeMatch) {
            const lang = codeMatch[1].trim() || undefined;
            const code = codeMatch[2];
            nodes.push(<CodeBlock key={i} code={code} lang={lang} />);
            continue;
        }

        // Markdown prose
        if (!part.trim()) continue;
        try {
            const html = DOMPurify.sanitize(marked(part) as string, {
                ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4',
                    'blockquote', 'code', 'pre', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
                    'hr', 'del', 'sup', 'sub', 'span'],
                ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class'],
            });
            nodes.push(
                <div
                    key={i}
                    className="markdown-body"
                    dangerouslySetInnerHTML={{ __html: html }}
                />
            );
        } catch {
            nodes.push(<div key={i} className="markdown-body">{part}</div>);
        }
    }

    return nodes.filter(Boolean);
}

/* ── MarkdownRenderer ─────────────────────────────────────── */
export const MarkdownRenderer: React.FC<{ content: string; className?: string }> = ({ content, className }) => {
    const nodes = useMemo(() => parseMarkdown(content), [content]);
    return (
        <div className={`md-root ${className || ''}`}>
            {nodes}
        </div>
    );
};
