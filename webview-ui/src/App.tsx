import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { vscode } from './vscode';
import { useVSCodeMessage } from './hooks/useVSCodeMessage';
import { useHistory, generateSessionTitle } from './hooks/useHistory';
import { AssistantMessage, UserMessage } from './components/chat/ChatComponents';
import { ModelPicker } from './components/chat/ModelPicker';
import { ModeSelector, MODES } from './components/chat/ModeSelector';
import { PlanPanel } from './components/plan/PlanPanel';
import { QuestionWizard } from './components/plan/QuestionWizard';
import { PlanReadyCard } from './components/plan/PlanReadyCard';
import { ChatHistoryPanel } from './components/history/ChatHistoryPanel';
import { TaskHeader } from './components/chat/TaskHeader';
import { WorkingIndicator, ScrollToBottomButton } from './components/chat/WorkingIndicator';
import { QuotedMessagePreview } from './components/chat/QuotedMessagePreview';
import { ContextMenu } from './components/chat/ContextMenu';
import { SlashCommandMenu, BUILTIN_SLASH_COMMANDS } from './components/chat/SlashCommandMenu';
import { ContextInspector } from './components/chat/ContextInspector';
import { TraceDrawer } from './components/chat/TraceDrawer';
import { CodaiStoresProvider } from './store/CodaiStoresProvider';
import type { SlashCommand } from './components/chat/SlashCommandMenu';
import { ProviderSettings } from './components/settings/ProviderSettings';
import { PROVIDERS, type ProviderId } from './catalog/providerCatalog';
import { loadAutoApproveConfig } from './components/settings/AutoApproveSettings';
import type { ModeDef } from './components/chat/ModeSelector';
import type { AutoApproveConfig, ModelDef, ProviderModelsFetchState } from './types';
import { ArrowUp, Square, CheckCheck, XCircle, Plus, Sparkles, FileCode, Settings, History, Terminal, GitCompare } from 'lucide-react';
import type { KeyboardEvent, ChangeEvent } from 'react';
import './App.css';

// ── Static fallback model list (cloud + local) ─────────────────────────────
export type ProposalDecisions = Map<string, 'accepted' | 'rejected'>;
const DEFAULT_PROVIDER_DEF = PROVIDERS.find((provider) => provider.id === 'ollama')!;

export default function App() {
  return (
    <CodaiStoresProvider>
      <AppShell />
    </CodaiStoresProvider>
  );
}

function AppShell() {
  const {
    messages, isProcessing, clearMessages, scrollTick,
    mode, setMode,
    todoItems,
    pendingQuestion, setPendingQuestion,
    pendingQuestions, setPendingQuestions,
    planSaved, setPlanSaved,
    taskDone, setTaskDone,
    tokenCount,
    contextPreview,
    latestTrace,
    turnState,
    toolControlState,
    goalControlState,
    browserSessionState,
    approvalPreview,
    toolControlNotice,
    runtimeWarning,
    preflightNotice,
    resumeNotice,
    contextCompactionNotice,
    isStreaming,
    iterationCount,
    activeFileContext, setActiveFileContext,
    ollamaModels,
    providerInfo,
    toolCatalog,
    model, setModel,
    providerModelsById,
    providerModelFetchStateById,
    setProviderModelFetchState,
    selectedMode,
  } = useVSCodeMessage();

  const [input, setInput] = useState('');
  const [decisions, setDecisions] = useState<ProposalDecisions>(new Map());
  const [planClosed, setPlanClosed] = useState(false);
  // context dosyası popup
  const [showContextPopup, setShowContextPopup] = useState(false);
  // Settings panel
  const [showSettings, setShowSettings] = useState(false);
  const [showContextInspector, setShowContextInspector] = useState(false);
  const [showTraceDrawer, setShowTraceDrawer] = useState(false);
  // Plan timing — for elapsed display on PlanReadyCard
  const [planStartedAt] = useState<number>(() => Date.now());
  const [planReadyCardDismissed, setPlanReadyCardDismissed] = useState(false);
  // History panel
  const [showHistory, setShowHistory] = useState(false);
  // Task start time for TaskHeader elapsed
  const [taskStartedAt, setTaskStartedAt] = useState<number | undefined>(undefined);
  // Scroll-to-bottom
  const [userScrolled, setUserScrolled] = useState(false);
  // Quote
  const [quotedText, setQuotedText] = useState<string | null>(null);
  // @ Mention context menu
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  // / Slash command menu
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashArgs, setSlashArgs] = useState('');
  const [customSlashCommands, setCustomSlashCommands] = useState<SlashCommand[]>([]);
  const [autoApproveConfig, setAutoApproveConfig] = useState<AutoApproveConfig>(() => loadAutoApproveConfig());
  const currentProviderId = providerInfo.providerId as ProviderId;
  const currentProviderDef = PROVIDERS.find((provider) => provider.id === currentProviderId) ?? DEFAULT_PROVIDER_DEF;
  const isProviderLocal = currentProviderDef.isLocal;

  // ── History ────────────────────────────────────────────────────────────────
  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    createSession,
    updateSession,
    deleteSession,
    renameSession,
    toggleSessionPinned,
    toggleSessionArchived,
    exportSession,
    importSessions,
    loadSession,
    getGroupedSessions,
  } = useHistory();

  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // BUG 14 FIX: Ollama'dan dinamik model listesi — uygulama açılışında çek
  useEffect(() => {
    const sendFetch = () => vscode.postMessage({
      type: 'fetchOllamaModels',
      requestId: `ollama-models-${Date.now()}`,
    });

    sendFetch();
    if (currentProviderId !== 'ollama') return;

    const intervalId = window.setInterval(sendFetch, 5000);
    return () => window.clearInterval(intervalId);
  }, [currentProviderId]);

  const scrollToBottom = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollTick, scrollToBottom]);
  useEffect(() => { vscode.postMessage({ type: 'ready' }); }, []);
  useEffect(() => { vscode.postMessage({ type: 'getSlashCommands' }); }, []);

  useEffect(() => { if (todoItems) setPlanClosed(false); }, [todoItems]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type !== 'slashCommandsList') return;
      const nextCommands = Array.isArray(msg.commands)
        ? msg.commands
            .filter((cmd: any) =>
              typeof cmd?.name === 'string' &&
              typeof cmd?.description === 'string' &&
              typeof cmd?.prompt === 'string'
            )
            .map((cmd: any) => ({
              name: cmd.name,
              description: cmd.description,
              prompt: cmd.prompt,
              sourcePath: cmd.sourcePath,
              action: 'prompt' as const,
            }))
        : [];
      setCustomSlashCommands(nextCommands);
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // ── @ Mention resolved event ─────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      const { label, content, mentionType } = detail;
      // Build context block and inject into input
      const block = mentionType === 'file'
        ? `[Context: ${label}]\n\`\`\`\n${content}\n\`\`\`\n`
        : `[${label}]\n${content}\n`;
      setInput(prev => {
        // Remove trailing @<query> from input
        const cleaned = prev.replace(/@\w*$/, '');
        return cleaned + block;
      });
      setMentionMenuOpen(false);
      textareaRef.current?.focus();
    };
    window.addEventListener('codai:mentionResolved', handler);
    return () => window.removeEventListener('codai:mentionResolved', handler);
  }, []);

  // ── Persist conversation to backend whenever messages change ─────────────
  // Debounced so we don't spam on every streaming chunk
  useEffect(() => {
    if (!activeSessionId || messages.length === 0 || isProcessing) return;
    const timer = setTimeout(() => {
      // Convert UI messages back to a saveable format
      const saveable = messages.map(m => ({
        role: m.role,
        segments: m.segments,
        error: m.error,
      }));
      vscode.postMessage({
        type: 'saveSessionHistory',
        sessionId: activeSessionId,
        messages: saveable,
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [messages, activeSessionId, isProcessing]);

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
          if (autoApproveConfig.all || autoApproveConfig.write_file) continue;
          pending.push({ phaseId: seg.tool.phaseId, filename: seg.tool.summary });
        }
      }
    }
    return pending;
  }, [messages, decisions, autoApproveConfig]);



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
    // Prepend quote if any
    if (quotedText) {
      const quoted = quotedText.split('\n').map(l => `> ${l}`).join('\n');
      finalMessage = `${quoted}\n\n${finalMessage}`;
      setQuotedText(null);
    }
    // Aktif dosya context eklenmişse mesajın önüne yap
    if (activeFileContext) {
      const ctx = `[Context: ${activeFileContext.path}]\n\`\`\`${activeFileContext.language}\n${activeFileContext.content}\n\`\`\`\n\n`;
      finalMessage = ctx + finalMessage;
      setActiveFileContext(null);
    }
    // ── Session tracking ────────────────────────────────────────────────────
    const now = Date.now();
    setTaskStartedAt(now);
    const userText = finalMessage;
    const title = generateSessionTitle(userText);
    // Create session on first message, update on subsequent
    if (!activeSessionId) {
      createSession({ title, mode: selectedMode.id as any, model: model.id, preview: userText.slice(0, 80) });
    } else {
      updateSession(activeSessionId, {
        messageCount: messages.length + 1,
        preview: userText.slice(0, 80),
        title: messages.length === 0 ? title : undefined,
      });
    }
    vscode.postMessage({ type: 'sendMessage', message: finalMessage });
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, isProcessing, activeFileContext, setActiveFileContext, activeSessionId, createSession, updateSession, messages.length, selectedMode.id, model.id]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const onInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
    // @ mention detection
    const atMatch = val.match(/@(\w*)$/);
    if (atMatch) {
      setMentionMenuOpen(true);
      setMentionQuery(atMatch[1] || '');
      setSlashMenuOpen(false);
    } else {
      setMentionMenuOpen(false);
    }
    // / slash command detection — only at start of input
    const slashMatch = val.match(/^\/([^\s]*)(?:\s+(.*))?$/);
    if (slashMatch) {
      setSlashMenuOpen(true);
      setSlashQuery(slashMatch[1] || '');
      setSlashArgs(slashMatch[2] || '');
      setMentionMenuOpen(false);
      vscode.postMessage({ type: 'getSlashCommands' });
    } else {
      setSlashMenuOpen(false);
      setSlashArgs('');
    }
  };

  const handleStop = () => vscode.postMessage({ type: 'abortTask' });
  const handleOpenTrace = useCallback(() => {
    if (!latestTrace?.traceFilePath) return;
    vscode.postMessage({ type: 'openFile', path: latestTrace.traceFilePath });
  }, [latestTrace?.traceFilePath]);

  const handleClear = () => {
    clearMessages();
    setDecisions(new Map());
    setPlanClosed(false);
    setActiveFileContext(null);
    setPlanSaved(null);
    setPlanReadyCardDismissed(false);
    setTaskStartedAt(undefined);
    setShowContextInspector(false);
    setShowTraceDrawer(false);
    // Reset active session → next message will create a brand new session
    setActiveSessionId(null);
    vscode.postMessage({ type: 'clearHistory' });
  };

  const handleModeChange = useCallback((m: ModeDef) => {
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

  // ── Plan wizard answer submit ────────────────────────────────────────────
  const handleWizardSubmit = useCallback((answers: string[]) => {
    setPendingQuestions(null);
    // Build a formatted message from all answers
    const formatted = answers
      .map((ans, i) => {
        const q = (pendingQuestions || [])[i];
        return q ? `**${q.question}**\n${ans}` : ans;
      })
      .join('\n\n');
    vscode.postMessage({ type: 'sendMessage', message: formatted });
  }, [pendingQuestions, setPendingQuestions]);

  const handleWizardDismiss = useCallback(() => {
    setPendingQuestions(null);
  }, [setPendingQuestions]);

  // ── PlanReadyCard actions ────────────────────────────────────────────────
  const handleBuild = useCallback(() => {
    setPlanReadyCardDismissed(true);
    const codeMode = MODES.find(m => m.id === 'code')!;
    handleModeChange(codeMode);
    const tasksPath = planSaved?.files?.tasks || '';
    setTimeout(() => {
      vscode.postMessage({
        type: 'sendMessage',
        message: tasksPath
          ? `Implement the plan. Tasks file: ${tasksPath}\n\nExecute all tasks in order from the tasks.md file.`
          : 'Implement the plan — execute all tasks from the spec.',
      });
    }, 120);
  }, [planSaved, handleModeChange]);

  const handleViewPlan = useCallback(() => {
    if (planSaved?.files?.tasks) {
      vscode.postMessage({ type: 'openFile', path: planSaved.files.tasks });
    }
  }, [planSaved]);

  const handleRevise = useCallback(() => {
    setPlanReadyCardDismissed(true);
    vscode.postMessage({
      type: 'sendMessage',
      message: 'Revise the plan based on additional requirements or corrections.',
    });
  }, []);

  // Show PlanReadyCard when both taskDone + planSaved arrived and user hasn't dismissed
  const showPlanReadyCard = !!(taskDone && planSaved && !planReadyCardDismissed && mode === 'plan');

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
  const currentProviderModels: ModelDef[] = useMemo(() => {
    // Settings panelinden manuel çekilen modeller en yüksek öncelik
    const fetchedModels = providerModelsById[currentProviderId];
    if (fetchedModels && fetchedModels.length > 0) return fetchedModels;
    // Ollama auto-fetch (BUG 14)
    if (currentProviderId === 'ollama' && ollamaModels.length > 0) {
      return ollamaModels.map((modelDef) => ({
        id: modelDef.id,
        label: modelDef.label,
        tag: 'local' as const,
      }));
    }
    if (currentProviderDef.defaultModels.length > 0) {
      return currentProviderDef.defaultModels.map((modelDef) => ({
        id: modelDef.id,
        label: modelDef.label,
        tag: currentProviderDef.isLocal ? 'local' as const : 'cloud' as const,
      }));
    }
    return [];
  }, [currentProviderDef, currentProviderId, ollamaModels, providerModelsById]);

  useEffect(() => {
    if (currentProviderModels.length === 0) return;
    if (currentProviderModels.some((candidate) => candidate.id === model.id)) return;
    const fallbackModel = currentProviderModels[0];
    setModel(fallbackModel);
    vscode.postMessage({ type: 'changeModel', model: fallbackModel.id });
  }, [currentProviderModels, model.id, setModel]);

  // ── Visible messages ──────────────────────────────────────────────────────
  const visible = messages.filter(m => {
    if (m.role === 'user') return m.segments.some(s => s.type === 'content' && s.text);
    return m.segments.length > 0 || m.isStreaming || m.error;
  });

  const isEmpty = visible.length === 0 && !isProcessing;
  const slashCommands = useMemo(() => [...BUILTIN_SLASH_COMMANDS, ...customSlashCommands], [customSlashCommands]);
  const lastAssistantMessage = useMemo(
    () => [...messages].reverse().find((msg) => msg.role === 'assistant') ?? null,
    [messages],
  );
  const lastAssistantHasVisibleContent = !!lastAssistantMessage && (
    lastAssistantMessage.segments.length > 0 ||
    !!lastAssistantMessage.error
  );
  const showWorkingIndicator = isProcessing && !isStreaming && !lastAssistantHasVisibleContent;
  const recentSessions = useMemo(
    () => [...sessions]
      .filter((session) => !session.archived)
      .sort((left, right) => {
        if (!!left.pinned !== !!right.pinned) return left.pinned ? -1 : 1;
        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      })
      .slice(0, 3),
    [sessions],
  );

  return (
    <div className="app">
      {/* ── Provider Settings overlay — always mounted, hidden when closed ── */}
      <div className={`settings-overlay${showSettings ? '' : ' settings-overlay--hidden'}`}>
        <ProviderSettings
          open={showSettings}
          currentProviderId={providerInfo.providerId as any}
          hasApiKey={providerInfo.hasApiKey}
          currentBaseUrl={providerInfo.baseUrl}
          currentModel={model.id}
          savedProviderConfigs={providerInfo.configs}
          providerModelsById={providerModelsById}
          providerModelFetchStateById={providerModelFetchStateById}
          onProviderModelFetchStateChange={(providerId, fetchState) => {
            setProviderModelFetchState(providerId, fetchState as ProviderModelsFetchState);
          }}
          onAutoApproveChange={setAutoApproveConfig}
          onClose={() => setShowSettings(false)}
          onModelSelect={(modelId) => {
            const found = currentProviderModels.find(m => m.id === modelId);
            if (found) setModel(found);
            else setModel({ id: modelId, label: modelId, tag: isProviderLocal ? 'local' : 'cloud' });
          }}
        />
      </div>

      {/* ── Chat History Panel overlay ── */}
      {showHistory && (
        <div className="history-overlay">
          <ChatHistoryPanel
            sessions={sessions}
            getGroups={getGroupedSessions}
            activeSessionId={activeSessionId}
            onSelectSession={(id) => {
              loadSession(id);
              setShowHistory(false);
            }}
            onDeleteSession={(id) => {
              deleteSession(id);
              // If deleted session was active — clear UI to empty state
              if (id === activeSessionId) {
                clearMessages();
                setDecisions(new Map());
                setPlanClosed(false);
                setPlanSaved(null);
                setTaskStartedAt(undefined);
                setActiveSessionId(null);
                vscode.postMessage({ type: 'clearHistory' });
              }
            }}
            onRenameSession={(id, title) => renameSession(id, title)}
            onPinSession={(id, pinned) => toggleSessionPinned(id, pinned)}
            onArchiveSession={(id, archived) => toggleSessionArchived(id, archived)}
            onExportSession={(id) => exportSession(id)}
            onImportSessions={() => importSessions()}
            onClose={() => setShowHistory(false)}
          />
        </div>
      )}

      {/* ── Panel header ── */}
      <div className="panel-header">
        <span className="panel-brand">
          <Sparkles size={12} className="panel-brand-icon" />
          <span>CodAI</span>
        </span>
        <div className="panel-header-right">
          <button
            className={`panel-header-btn${showHistory ? ' active' : ''}`}
            onClick={() => setShowHistory(s => !s)}
            title="Chat history"
          >
            <History size={11} />
          </button>
          <button
            className={`panel-header-btn${showContextInspector ? ' active' : ''}`}
            onClick={() => {
              setShowContextInspector((open) => !open);
              setShowTraceDrawer(false);
            }}
            title="Context inspector"
          >
            Context
          </button>
          <button
            className={`panel-header-btn${showTraceDrawer ? ' active' : ''}`}
            onClick={() => {
              setShowTraceDrawer((open) => !open);
              setShowContextInspector(false);
            }}
            title="Debug trace"
          >
            Trace
          </button>
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

      {/* ── Task Header (session title + elapsed) ── */}
      {!isEmpty && (
        <TaskHeader
          title={sessions.find(s => s.id === activeSessionId)?.title}
          startedAt={taskStartedAt}
          isProcessing={isProcessing}
          messageCount={messages.length}
          tokenCount={tokenCount}
          goalControlState={goalControlState}
          browserActive={!!browserSessionState?.active}
        />
      )}

      {(resumeNotice || preflightNotice || toolControlNotice) && (
        <div className={`runtime-banner${preflightNotice?.severity === 'error' || toolControlNotice?.severity === 'error' ? ' runtime-banner--error' : ''}`}>
          <span>
            {resumeNotice || toolControlNotice?.message || [...(preflightNotice?.errors || []), ...(preflightNotice?.warnings || [])].join(' ')}
          </span>
          <div className="runtime-banner-actions">
            {latestTrace?.traceFilePath && (
              <button
                className="runtime-banner-btn"
                onClick={() => {
                  setShowTraceDrawer(true);
                  setShowContextInspector(false);
                }}
              >
                Inspect trace
              </button>
            )}
          </div>
        </div>
      )}

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

      {/* ── Question Wizard (replaces old clarification-bar) ── */}
      {pendingQuestions && pendingQuestions.length > 0 && (
        <QuestionWizard
          questions={pendingQuestions}
          onSubmit={handleWizardSubmit}
          onDismiss={handleWizardDismiss}
        />
      )}

      {/* ── Fallback: single clarification bar (non-wizard path) ── */}
      {!pendingQuestions && pendingQuestion && (
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

      {/* ── Plan Ready Card (plan mode — taskDone + planSaved) ── */}
      {showPlanReadyCard && planSaved && (
        <PlanReadyCard
          planSaved={planSaved}
          elapsedSeconds={planStartedAt ? (Date.now() - planStartedAt) / 1000 : undefined}
          taskResult={taskDone || undefined}
          onBuild={handleBuild}
          onViewPlan={handleViewPlan}
          onRevise={handleRevise}
        />
      )}

      {/* ── Task complete banner (code/chat mode only) ── */}
      {taskDone && !showPlanReadyCard && (
        <div className="task-done-bar">
          <CheckCheck size={13} />
          <span>{taskDone}</span>
          <button className="task-done-dismiss" onClick={() => setTaskDone(null)}>✕</button>
        </div>
      )}

      {/* ── / Slash command menu ── */}
      {slashMenuOpen && !isProcessing && (
        <SlashCommandMenu
          commands={slashCommands}
          query={slashQuery}
          onClose={() => setSlashMenuOpen(false)}
          onSelect={(cmd: SlashCommand) => {
            setSlashMenuOpen(false);
            if (cmd.action === 'prompt') {
              const args = slashArgs.trim();
              const renderedPrompt = cmd.prompt?.includes('$ARGUMENTS')
                ? cmd.prompt.replace(/\$ARGUMENTS/g, args)
                : (args ? `${cmd.prompt?.trim()}\n\n${args}` : cmd.prompt || '');
              setInput(renderedPrompt.trim());
              requestAnimationFrame(() => {
                if (textareaRef.current) {
                  textareaRef.current.focus();
                  textareaRef.current.style.height = 'auto';
                  textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
                }
              });
              return;
            }

            setInput('');
            switch (cmd.builtinKey) {
              case 'new': handleClear(); break;
              case 'clear': handleClear(); break;
              case 'mode:code': handleModeChange(MODES.find(m => m.id === 'code')!); break;
              case 'mode:plan': handleModeChange(MODES.find(m => m.id === 'plan')!); break;
              case 'mode:chat': handleModeChange(MODES.find(m => m.id === 'chat')!); break;
              case 'compact':
                vscode.postMessage({ type: 'sendMessage', message: 'Summarize and compress the conversation context to save tokens. Keep only essential information.' });
                break;
            }
          }}
        />
      )}

      {/* ── @ Mention context menu ── */}
      {mentionMenuOpen && !isProcessing && (
        <ContextMenu
          query={mentionQuery}
          onSelect={(insertion) => {
            setInput(prev => prev.replace(/@\w*$/, insertion));
            setMentionMenuOpen(false);
            textareaRef.current?.focus();
          }}
          onClose={() => setMentionMenuOpen(false)}
        />
      )}

      {/* ── Quoted message preview ── */}
      {quotedText && (
        <QuotedMessagePreview
          text={quotedText}
          onRemove={() => setQuotedText(null)}
        />
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
      <div
        className="chat-scroll"
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          setUserScrolled(!atBottom);
        }}
      >
        {isEmpty ? (
          <div className="empty-state">
            <div className="empty-logo">
              <Sparkles size={24} className="empty-icon" />
            </div>
            <p className="empty-title">How can I help?</p>
            <p className="empty-sub">Ask anything · <span className="empty-mode-hint">{selectedMode.label} mode</span></p>
            {/* Recent sessions on empty state — Kilo style */}
            {recentSessions.length > 0 && (
              <div className="empty-recent">
                <span className="empty-recent-label">Recent</span>
                {recentSessions.map(s => (
                  <button
                    key={s.id}
                    className="empty-recent-item"
                    onClick={() => { loadSession(s.id); }}
                  >
                    <span className="empty-recent-title">{s.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="msg-list">
            {visible.map((msg) => (
              <div key={msg.id} className={`msg-row ${msg.role}`}>
                {msg.role === 'user'
                  ? <UserMessage
                      content={msg.segments.find(s => s.type === 'content')?.text ?? ''}
                      onQuote={(t) => { setQuotedText(t); textareaRef.current?.focus(); }}
                    />
                  : (
                    <AssistantMessage
                      msg={msg}
                      decisions={decisions}
                      onDecide={onDecide}
                      onRetry={msg.error ? handleRetry : undefined}
                      onQuote={(t) => { setQuotedText(t); textareaRef.current?.focus(); }}
                    />
                  )}
              </div>
            ))}

            {/* WorkingIndicator — under the chat stream while we're waiting for visible output */}
            {showWorkingIndicator && (
              <WorkingIndicator
                isProcessing={isProcessing}
                isStreaming={isStreaming}
                iterationCount={iterationCount}
                lastMessageHasContent={lastAssistantHasVisibleContent}
              />
            )}

            {contextCompactionNotice && (
              <div className="context-compact-banner" role="status" aria-live="polite">
                <span className="context-compact-banner-text">{contextCompactionNotice}</span>
              </div>
            )}

            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* Scroll to bottom button */}
      <ScrollToBottomButton
        visible={userScrolled && !isEmpty}
        onClick={() => {
          endRef.current?.scrollIntoView({ behavior: 'smooth' });
          setUserScrolled(false);
        }}
      />

      <ContextInspector
        open={showContextInspector}
        preview={contextPreview}
        tokenCount={tokenCount}
        onClose={() => setShowContextInspector(false)}
      />

      <TraceDrawer
        open={showTraceDrawer}
        latestTrace={latestTrace}
        turnState={turnState}
        toolControlState={toolControlState}
        goalControlState={goalControlState}
        browserSessionState={browserSessionState}
        approvalPreview={approvalPreview}
        runtimeWarning={runtimeWarning}
        preflightNotice={preflightNotice}
        resumeNotice={resumeNotice}
        toolCatalog={toolCatalog}
        onClose={() => setShowTraceDrawer(false)}
        onOpenTrace={handleOpenTrace}
      />

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
        <div className="input-shell">
          <div className="input-editor">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={onInput}
              onKeyDown={onKey}
              rows={1}
              disabled={isProcessing}
              placeholder="Ask anything, mention files, or use / commands"
              className="chat-textarea"
            />
          </div>

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
              <ModelPicker models={currentProviderModels} selected={model} onChange={handleModelChange} disabled={isProcessing} />

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
            </div>

            <div className="input-bottom-right">
              <button
                className={`send-stop-btn${isProcessing ? ' stop' : ' send'}`}
                onClick={isProcessing ? handleStop : send}
                disabled={!isProcessing && !input.trim()}
                title={isProcessing ? 'Stop generation' : 'Send (Enter)'}
              >
                {isProcessing ? <Square size={12} /> : <ArrowUp size={14} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
