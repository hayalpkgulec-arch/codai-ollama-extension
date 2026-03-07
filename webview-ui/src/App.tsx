import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { vscode } from './vscode';
import { useVSCodeMessage } from './hooks/useVSCodeMessage';
import { AssistantMessage, UserMessage } from './components/chat/ChatComponents';
import { ModelPicker } from './components/chat/ModelPicker';
import { ModeSelector, MODES } from './components/chat/ModeSelector';
import { PlanPanel } from './components/plan/PlanPanel';
import { ProviderSettings } from './components/settings/ProviderSettings';
import type { ModeDef } from './components/chat/ModeSelector';
import { Send, Square, CheckCheck, XCircle, Plus, Sparkles, FileCode, Settings, Bot, Terminal, GitCompare } from 'lucide-react';
import type { KeyboardEvent, ChangeEvent } from 'react';
import './App.css';

// ── Static fallback model list (cloud + local) ─────────────────────────────
const STATIC_MODELS = [
  { id: 'kimi-k2.5:cloud', label: 'Kimi K2.5', tag: 'cloud' as const },
  { id: 'deepseek-v3.1:671b-cloud', label: 'DeepSeek V3.1 671B', tag: 'cloud' as const },
  { id: 'qwen3-coder:480b-cloud', label: 'Qwen3 Coder 480B', tag: 'cloud' as const },
  { id: 'minimax-m2.5:cloud', label: 'MiniMax M2.5', tag: 'cloud' as const },
  { id: 'minimax-m2:cloud', label: 'MiniMax M2', tag: 'cloud' as const },
  { id: 'gpt-oss:120b-cloud', label: 'GPT OSS 120B', tag: 'cloud' as const },
  { id: 'qwen2.5-coder:32b', label: 'Qwen2.5 Coder 32B', tag: 'local' as const },
  { id: 'codestral:22b', label: 'Codestral 22B', tag: 'local' as const },
  { id: 'llama3.3:70b', label: 'Llama 3.3 70B', tag: 'local' as const },
  { id: 'mistral:7b', label: 'Mistral 7B', tag: 'local' as const },
];

export type ModelDef = { id: string; label: string; tag: 'cloud' | 'local' };
export type ProposalDecisions = Map<string, 'accepted' | 'rejected'>;

export default function App() {
  const {
    messages, isProcessing, clearMessages, scrollTick,
    mode, setMode,
    todoItems,
    pendingQuestion, setPendingQuestion,
    taskDone, setTaskDone,
    isStreaming,
    initialModel,
    iterationCount,
    activeFileContext, setActiveFileContext,
    ollamaModels,
    providerInfo,
  } = useVSCodeMessage();

  const [input, setInput] = useState('');
  const [model, setModel] = useState<ModelDef>(STATIC_MODELS[0]);
  const [selectedMode, setSelectedMode] = useState<ModeDef>(MODES[0]);
  const [decisions, setDecisions] = useState<ProposalDecisions>(new Map());
  const [planClosed, setPlanClosed] = useState(false);
  // context dosyası popup
  const [showContextPopup, setShowContextPopup] = useState(false);
  // Settings panel
  const [showSettings, setShowSettings] = useState(false);
  // Provider'dan dinamik çekilen modeller
  const [dynamicModels, setDynamicModels] = useState<ModelDef[]>([]);
  // KEY STATE PARENT'TA — unmount edilince kaybolmaması için
  const [settingsApiKey, setSettingsApiKey] = useState('');
  const [settingsBaseUrl, setSettingsBaseUrl] = useState('');

  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // BUG 8 FIX: Backend'den gelen model bilgisiyle state'i restore et
  useEffect(() => {
    if (!initialModel) return;
    const found = STATIC_MODELS.find(m => m.id === initialModel);
    if (found) {
      setModel(found);
    } else {
      // Listede yoksa dynamic olarak ekle
      setModel({ id: initialModel, label: initialModel, tag: 'local' });
    }
  }, [initialModel]);

  // BUG 14 FIX: Ollama'dan dinamik model listesi — uygulama açılışında çek
  useEffect(() => {
    vscode.postMessage({ type: 'fetchOllamaModels' });
  }, []);

  const scrollToBottom = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollTick, scrollToBottom]);
  useEffect(() => { vscode.postMessage({ type: 'ready' }); }, []);

  useEffect(() => { if (todoItems) setPlanClosed(false); }, [todoItems]);

  useEffect(() => {
    const modeObj = MODES.find(m => m.id === mode);
    if (modeObj) setSelectedMode(modeObj);
  }, [mode]);

  // ── Pending write proposals ──────────────────────────────────────────────
  const pendingProposals = useMemo(() => {
    const pending: Array<{ phaseId: string; filename: string }> = [];
    for (const msg of messages) {
      if (msg.role !== 'assistant') continue;
      for (const seg of msg.segments) {
        if (seg.type !== 'tool') continue;
        const isWrite = ['write_file', 'create_file', 'edit_file', 'write_to_file'].includes(seg.tool.name);
        // BUG 1 FIX: phaseId ile key, dosya yolu değil
        if (isWrite && seg.tool.status === 'done' && !decisions.has(seg.tool.phaseId)) {
          pending.push({ phaseId: seg.tool.phaseId, filename: seg.tool.summary });
        }
      }
    }
    return pending;
  }, [messages, decisions]);

  // ── Working shimmer ──────────────────────────────────────────────────────
  const showWorkingShimmer = useMemo(() => {
    if (!isProcessing || isStreaming) return false;
    const asstMsgs = messages.filter(m => m.role === 'assistant');
    if (!asstMsgs.length) return true;
    const last = asstMsgs[asstMsgs.length - 1];
    if (!last.segments.length) return false;
    return last.segments.every(s => {
      if (s.type === 'thinking') return s.done;
      if (s.type === 'tool') return s.tool.status !== 'running';
      return true;
    });
  }, [isProcessing, isStreaming, messages]);

  // ── Decisions ────────────────────────────────────────────────────────────
  const onDecide = useCallback((phaseId: string, decision: 'accepted' | 'rejected', proposalId: string) => {
    setDecisions(prev => { const next = new Map(prev); next.set(phaseId, decision); return next; });
    vscode.postMessage({ type: decision === 'accepted' ? 'applyWriteProposal' : 'rejectWriteProposal', proposalId });
  }, []);

  const acceptAll = () => pendingProposals.forEach(p => onDecide(p.phaseId, 'accepted', p.phaseId));
  const rejectAll = () => pendingProposals.forEach(p => onDecide(p.phaseId, 'rejected', p.phaseId));

  // ── Input ────────────────────────────────────────────────────────────────
  const send = useCallback(() => {
    if (!input.trim() || isProcessing) return;
    let finalMessage = input.trim();
    // Aktif dosya context eklenmişse mesajın önüne yap
    if (activeFileContext) {
      const ctx = `[Context: ${activeFileContext.path}]\n\`\`\`${activeFileContext.language}\n${activeFileContext.content}\n\`\`\`\n\n`;
      finalMessage = ctx + finalMessage;
      setActiveFileContext(null);
    }
    vscode.postMessage({ type: 'sendMessage', message: finalMessage });
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, isProcessing, activeFileContext, setActiveFileContext]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const onInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  };

  const handleStop = () => vscode.postMessage({ type: 'abortTask' });

  const handleClear = () => {
    clearMessages();
    setDecisions(new Map());
    setPlanClosed(false);
    setActiveFileContext(null);
    vscode.postMessage({ type: 'clearHistory' });
  };

  const handleModeChange = useCallback((m: ModeDef) => {
    setSelectedMode(m);
    setMode(m.id);
    vscode.postMessage({ type: 'changeMode', mode: m.id });
  }, [setMode]);

  // BUG 8 FIX: model değişimini backend'e ilet
  const handleModelChange = (m: ModelDef) => {
    setModel(m);
    vscode.postMessage({ type: 'changeModel', model: m.id });
  };

  // ── Plan panel ───────────────────────────────────────────────────────────
  const handleRunTask = useCallback((taskText: string) => {
    const codeMode = MODES.find(m => m.id === 'code')!;
    handleModeChange(codeMode);
    setTimeout(() => {
      vscode.postMessage({ type: 'sendMessage', message: `Execute this task: ${taskText}` });
    }, 120);
  }, [handleModeChange]);

  const handleRunAll = useCallback((tasksMarkdown: string) => {
    const codeMode = MODES.find(m => m.id === 'code')!;
    handleModeChange(codeMode);
    setTimeout(() => {
      vscode.postMessage({
        type: 'sendMessage',
        message: `Execute all the following tasks in order:\n${tasksMarkdown}`,
      });
    }, 120);
  }, [handleModeChange]);

  const handleClosePlan = useCallback(() => setPlanClosed(true), []);
  const showPlanPanel = !!todoItems && !planClosed;

  // ── BUG 13 FIX: Retry — son kullanıcı mesajını tekrar gönder ────────────
  const handleRetry = useCallback(() => {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUser) return;
    const text = lastUser.segments.find(s => s.type === 'content')?.text;
    if (!text) return;
    vscode.postMessage({ type: 'sendMessage', message: text });
  }, [messages]);

  // ── BUG 10 FIX: Context butonu — aktif editördeki dosyayı ekle ──────────
  const handleContextBtn = useCallback(() => {
    if (activeFileContext) {
      setActiveFileContext(null);
      setShowContextPopup(false);
      return;
    }
    vscode.postMessage({ type: 'requestActiveFile' });
    setShowContextPopup(true);
    setTimeout(() => setShowContextPopup(false), 2000);
  }, [activeFileContext, setActiveFileContext]);

  // Dinamik model listesi: provider'dan gelenler öncelikli, yoksa static fallback
  const allModels: ModelDef[] = useMemo(() => {
    // Settings panelinden manuel çekilen modeller en yüksek öncelik
    if (dynamicModels.length > 0) return dynamicModels;
    // Ollama auto-fetch (BUG 14)
    if (ollamaModels.length > 0) {
      const cloudModels = STATIC_MODELS.filter(m => m.tag === 'cloud');
      const dynamicLocal: ModelDef[] = ollamaModels.map(m => ({
        id: m.id, label: m.label, tag: 'local' as const,
      }));
      return [...cloudModels, ...dynamicLocal];
    }
    return STATIC_MODELS;
  }, [ollamaModels, dynamicModels]);

  // ── Visible messages ──────────────────────────────────────────────────────
  const visible = messages.filter(m => {
    if (m.role === 'user') return m.segments.some(s => s.type === 'content' && s.text);
    return m.segments.length > 0 || m.isStreaming || m.error;
  });

  const isEmpty = visible.length === 0 && !isProcessing;

  return (
    <div className="app">
      {/* ── Provider Settings overlay — always mounted, hidden when closed ── */}
      <div className={`settings-overlay${showSettings ? '' : ' settings-overlay--hidden'}`}>
        <ProviderSettings
          currentProviderId={providerInfo.providerId as any}
          hasApiKey={providerInfo.hasApiKey}
          currentBaseUrl={providerInfo.baseUrl}
          currentModel={model.id}
          apiKeyValue={settingsApiKey}
          baseUrlValue={settingsBaseUrl}
          onApiKeyChange={setSettingsApiKey}
          onBaseUrlChange={setSettingsBaseUrl}
          onClose={() => setShowSettings(false)}
          onProviderModels={(models) => {
            const dynamicLocal = models.map(m => ({ id: m.id, label: m.label, tag: 'local' as const }));
            setDynamicModels(dynamicLocal);
          }}
          onModelSelect={(modelId) => {
            const found = allModels.find(m => m.id === modelId);
            if (found) setModel(found);
            else setModel({ id: modelId, label: modelId, tag: 'local' });
          }}
        />
      </div>

      {/* ── Panel header ── */}
      <div className="panel-header">
        <span className="panel-brand">
          <Sparkles size={12} className="panel-brand-icon" />
          <span>CodAI</span>
        </span>
        <div className="panel-header-right">
          <button
            className={`panel-header-btn${showSettings ? ' active' : ''}`}
            onClick={() => setShowSettings(s => !s)}
            title="Provider settings"
          >
            <Settings size={11} />
          </button>
          <button className="panel-header-btn" onClick={handleClear} title="New chat">New chat</button>
        </div>
      </div>

      {/* ── Plan Panel ── */}
      {showPlanPanel && (
        <PlanPanel
          todos={todoItems}
          planReady={!!taskDone}
          isProcessing={isProcessing}
          onRunTask={handleRunTask}
          onAcceptPlan={handleRunAll}
          onClose={handleClosePlan}
        />
      )}

      {/* ── Clarification ── */}
      {pendingQuestion && (
        <div className="clarification-bar">
          <div className="clarification-question">{pendingQuestion.question}</div>
          {pendingQuestion.options && pendingQuestion.options.length > 0 && (
            <div className="clarification-options">
              {pendingQuestion.options.map((opt: string, i: number) => (
                <button key={i} className="clarification-option" onClick={() => {
                  vscode.postMessage({ type: 'sendMessage', message: opt });
                  setPendingQuestion(null);
                }}>
                  {opt}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Task complete banner ── */}
      {taskDone && (
        <div className="task-done-bar">
          <CheckCheck size={13} />
          <span>{taskDone}</span>
          <button className="task-done-dismiss" onClick={() => setTaskDone(null)}>✕</button>
        </div>
      )}

      {/* ── Active file context pill ── */}
      {activeFileContext && (
        <div className="context-pill">
          <FileCode size={11} />
          <span className="context-pill-name">{activeFileContext.path}</span>
          {activeFileContext.selection && <span className="context-pill-sel">· selection</span>}
          <button className="context-pill-remove" onClick={() => setActiveFileContext(null)}>✕</button>
        </div>
      )}

      {/* ── Chat Scroll ── */}
      <div className="chat-scroll">
        {isEmpty ? (
          <div className="empty-state">
            <div className="empty-logo">
              <Sparkles size={24} className="empty-icon" />
            </div>
            <p className="empty-title">How can I help?</p>
            <p className="empty-sub">Ask anything · <span className="empty-mode-hint">{selectedMode.label} mode</span></p>
          </div>
        ) : (
          <div className="msg-list">
            {visible.map((msg) => (
              <div key={msg.id} className={`msg-row ${msg.role}`}>
                {msg.role === 'user'
                  ? <UserMessage content={msg.segments.find(s => s.type === 'content')?.text ?? ''} />
                  : (
                    <>
                      <AssistantMessage
                        msg={msg}
                        decisions={decisions}
                        onDecide={onDecide}
                        onRetry={msg.error ? handleRetry : undefined}
                      />
                    </>
                  )}
              </div>
            ))}

            {/* Working shimmer */}
            {showWorkingShimmer && (
              <div className="working-shimmer-row">
                <span className="working-shimmer">Working…</span>
              </div>
            )}

            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* ── Proposal bar ── */}
      {pendingProposals.length > 0 && (
        <div className="proposal-bar">
          <span className="proposal-bar-label">
            <span className="proposal-count">{pendingProposals.length}</span>
            {' '}change{pendingProposals.length > 1 ? 's' : ''} pending
          </span>
          <div className="proposal-bar-actions">
            <button className="proposal-reject-all" onClick={rejectAll}>
              <XCircle size={11} /> Reject all
            </button>
            <button className="proposal-accept-all" onClick={acceptAll}>
              <CheckCheck size={11} /> Accept all
            </button>
          </div>
        </div>
      )}

      {/* ── Input Bar ── */}
      <div className={`input-bar${isProcessing ? ' processing' : ''}`}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={onInput}
          onKeyDown={onKey}
          rows={1}
          disabled={isProcessing}
          placeholder="Ask anything, @ to mention, / for commands…"
          className="chat-textarea"
        />

        <div className="input-bottom-row">
          <div className="input-bottom-left">
            {/* Aktif dosyayı context olarak ekle */}
            <div className="context-btn-wrap">
              <button
                className={`input-plus-btn${activeFileContext ? ' has-context' : ''}`}
                title={activeFileContext ? 'Remove file context' : 'Add active file as context'}
                onClick={handleContextBtn}
              >
                <Plus size={13} />
              </button>
              {showContextPopup && !activeFileContext && (
                <div className="context-popup">Fetching active file…</div>
              )}
            </div>
            <ModeSelector selected={selectedMode} onChange={handleModeChange} disabled={isProcessing} />
            <ModelPicker models={allModels} selected={model} onChange={handleModelChange} disabled={isProcessing} />

            {/* Terminal button — opens CodAI terminal */}
            <button
              className="input-icon-btn"
              title="Open CodAI terminal"
              onClick={() => vscode.postMessage({ type: 'runInTerminal', command: '' })}
            >
              <Terminal size={12} />
            </button>

            {/* Diff view — open last modified file in diff */}
            <button
              className="input-icon-btn"
              title="Open last file diff in VSCode"
              onClick={() => vscode.postMessage({ type: 'showDiff', path: '' })}
            >
              <GitCompare size={12} />
            </button>

            {/* Background agent status indicator */}
            {isProcessing && (
              <div className="agent-status-pill" title={`Agent running · iteration ${iterationCount}`}>
                <Bot size={11} className="agent-status-icon spin-slow" />
                <span className="agent-status-label">
                  {iterationCount > 1 ? `iter ${iterationCount}` : 'working'}
                </span>
              </div>
            )}
          </div>

          <div className="input-bottom-right">
            <button
              className={`send-stop-btn${isProcessing ? ' stop' : ' send'}`}
              onClick={isProcessing ? handleStop : send}
              disabled={!isProcessing && !input.trim()}
              title={isProcessing ? 'Stop generation' : 'Send (Enter)'}
            >
              {isProcessing ? <Square size={12} /> : <Send size={12} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
