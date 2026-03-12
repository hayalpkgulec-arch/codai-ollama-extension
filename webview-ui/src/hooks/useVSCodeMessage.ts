import { useEffect, useState, useCallback } from 'react';
import type { ChatMessage, Segment, ToolCall, AgentMode, WizardQuestion, PlanSavedPayload, ProviderSavedConfig } from '../types';
import { vscode } from '../vscode';

// ── Immutable last-element update ────────────────────────────────────────────
function updateLast<T>(arr: T[], fn: (item: T) => T): T[] {
  if (!arr.length) return arr;
  const next = [...arr];
  next[next.length - 1] = fn(next[next.length - 1]);
  return next;
}

// ── New empty assistant message ───────────────────────────────────────────────
function newAsst(extra?: Partial<ChatMessage>): ChatMessage {
  return {
    id: `a${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    role: 'assistant',
    segments: [],
    isStreaming: true,
    ...extra,
  };
}

// ── Check if last assistant message has ALL tools completed (new iteration) ───
function allToolsDone(msgs: ChatMessage[]): boolean {
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== 'assistant') return false;
  const tools = last.segments.filter(s => s.type === 'tool');
  return tools.length > 0 && tools.every(s => s.type === 'tool' && s.tool.status !== 'running');
}

// ── BUG 4 FIX: Daha iyi tool summary oluştur ──────────────────────────────────
function buildToolSummaryFromHistory(fnName: string, args: any): string {
  const pathVal = args?.path || args?.oldPath || '';
  const pathBase = pathVal ? pathVal.split(/[/\\]/).filter(Boolean).pop() || pathVal : '';
  const summaryMap: Record<string, string> = {
    read_file: pathBase ? `Read ${pathBase}` : 'Read file',
    write_file: pathBase ? `Edited ${pathBase}` : 'Edited file',
    create_file: pathBase ? `Created ${pathBase}` : 'Created file',
    list_files: pathBase ? `List ${pathBase}` : 'List directory',
    list_directory_tree: pathBase ? `Tree ${pathBase}` : 'List directory tree',
    read_multiple_files:   args?.paths ? `Read ${Array.isArray(args.paths) ? args.paths.length : '?'} files` : 'Read multiple files',
    write_multiple_files:  args?.files ? `Write ${Array.isArray(args.files) ? args.files.length : '?'} files` : 'Write multiple files',
    delete_multiple_files: args?.paths ? `Delete ${Array.isArray(args.paths) ? args.paths.length : '?'} files` : 'Delete multiple files',
    search_files: args?.pattern ? `Search ${args.pattern}` : 'Search files',
    grep_code: args?.pattern ? `Grep "${args.pattern}"` : 'Search code',
    run_command: args?.command ? `Run: ${String(args.command).slice(0, 40)}` : 'Run command',
    delete_file: pathBase ? `Delete ${pathBase}` : 'Delete file',
    rename_file: 'Move file',
    get_diagnostics: pathBase ? `Diagnose ${pathBase}` : 'Diagnose workspace',
    web_fetch: args?.url ? `Fetch ${args.url}` : 'Web fetch',
    create_directory: pathBase ? `Create dir ${pathBase}` : 'Create directory',
    get_file_info: pathBase ? `Info ${pathBase}` : 'File info',
    find_and_replace: pathBase ? `Replace in ${pathBase}` : 'Find & replace',
    append_to_file: pathBase ? `Append to ${pathBase}` : 'Append to file',
    task_notes: 'Update task plan',
    ask_followup_question: args?.question ? args.question.slice(0, 60) : 'Ask user',
    attempt_completion: 'Task complete',
  };
  return summaryMap[fnName] || fnName.replace(/_/g, ' ');
}

// ── Reconstruct clean ChatMessages from Ollama history format ─────────────────
function reconstructHistory(history: any[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  const toolResults = new Map<string, string>();
  for (const h of history) {
    if (h.role === 'tool' && h.tool_call_id) {
      toolResults.set(h.tool_call_id, h.content ?? '');
    }
  }

  let idx = 0;
  for (const h of history) {
    if (h.role === 'system' || h.role === 'tool') continue;

    if (h.role === 'user') {
      result.push({
        id: `h${idx++}`,
        role: 'user',
        segments: h.content ? [{ type: 'content', text: h.content }] : [],
      });
      continue;
    }

    if (h.role === 'assistant') {
      const segments: Segment[] = [];

      if (h.content) {
        segments.push({ type: 'content', text: h.content });
      }

      if (Array.isArray(h.tool_calls)) {
        for (const tc of h.tool_calls) {
          const fnName: string = tc.function?.name ?? 'tool';
          const fnArgs = typeof tc.function?.arguments === 'string'
            ? (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })()
            : (tc.function?.arguments ?? {});
          const callId: string = tc.id ?? '';
          const rawResult = callId ? (toolResults.get(callId) ?? '') : '';

          // BUG 4 FIX: düzgün summary
          const summary = buildToolSummaryFromHistory(fnName, fnArgs);

          const tool: ToolCall = {
            phaseId: callId || `r${idx}-${Math.random().toString(36).slice(2, 4)}`,
            name: fnName,
            summary,
            status: 'done',
            result: rawResult,
            args: fnArgs,
          };
          segments.push({ type: 'tool', tool });
        }
      }

      result.push({
        id: `h${idx++}`,
        role: 'assistant',
        segments,
      });
    }
  }

  return result;
}


export function useVSCodeMessage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [scrollTick, setScrollTick] = useState(0);
  const [mode, setMode] = useState<AgentMode>('code');
  const [todoItems, setTodoItems] = useState<string>('');
  const [pendingQuestion, setPendingQuestion] = useState<{ question: string; options?: string[] } | null>(null);
  const [pendingQuestions, setPendingQuestions] = useState<WizardQuestion[] | null>(null);
  const [planSaved, setPlanSaved] = useState<PlanSavedPayload | null>(null);
  const [taskDone, setTaskDone] = useState<string | null>(null);
  const [tokenCount, setTokenCount] = useState<{ contextTokens: number; contextChars: number } | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  // BUG 8 FIX: initialModel backend'den restore edilir
  const [initialModel, setInitialModel] = useState<string | null>(null);
  // Iterasyon sayacı (BUG 11)
  const [iterationCount, setIterationCount] = useState(0);
  // Aktif dosya context (BUG 10)
  const [activeFileContext, setActiveFileContext] = useState<any>(null);
  // Ollama dinamik model listesi (BUG 14)
  const [ollamaModels, setOllamaModels] = useState<Array<{ id: string; label: string; size?: number }>>([]);
  // Provider state — backend'den restore
  const [providerInfo, setProviderInfo] = useState<{
    providerId: string;
    hasApiKey: boolean;
    baseUrl: string;
    configs: Record<string, ProviderSavedConfig>;
  }>({ providerId: 'ollama', hasApiKey: false, baseUrl: 'http://localhost:11434', configs: {} });

  const bumpScroll = useCallback(() => setScrollTick(t => t + 1), []);
  const clearMessages = useCallback(() => {
    setMessages([]);
    setIsProcessing(false);
    setIterationCount(0);
  }, []);

  useEffect(() => {
    const handle = (event: MessageEvent) => {
      const msg = event.data;

      switch (msg.type) {

        // ── History restore ────────────────────────────────────────────────
        case 'initialState':
          setMessages(reconstructHistory(msg.history || []));
          if (msg.mode) setMode(msg.mode as AgentMode);
          if (typeof msg.model === 'string' && msg.model) {
            setInitialModel(msg.model);
          }
          // Provider state restore
          if (msg.provider) {
            setProviderInfo({
              providerId: msg.provider.providerId || 'ollama',
              hasApiKey: !!msg.provider.hasApiKey,
              baseUrl: msg.provider.baseUrl || 'http://localhost:11434',
              configs: typeof msg.provider.configs === 'object' && msg.provider.configs
                ? msg.provider.configs
                : {},
            });
          }
          if (typeof msg.planTodos === 'string' && msg.planTodos.trim()) {
            setTodoItems(msg.planTodos);
          }
          bumpScroll();
          break;

        // ── New user turn ────────────────────────────────────────────────
        case 'turnStart':
          setIsProcessing(true);
          setIsStreaming(false);
          setTaskDone(null);
          setPendingQuestion(null);
          setPendingQuestions(null);
          setIterationCount(0);
          setMessages(prev => [
            ...prev,
            {
              id: `u${Date.now()}`,
              role: 'user' as const,
              segments: [{ type: 'content', text: msg.userText as string }],
            },
            newAsst(),
          ]);
          break;

        // ── Thinking token ───────────────────────────────────────────────
        case 'thinking':
          setIsStreaming(true);
          setMessages(prev => {
            const newThinkSeg: Segment = {
              type: 'thinking',
              text: msg.content as string,
              done: false,
              startedAt: Date.now(),
            };

            if (allToolsDone(prev)) {
              setIterationCount(c => c + 1);
              return [...prev, newAsst({ segments: [newThinkSeg] })];
            }

            return updateLast(prev, last => {
              if (last.role !== 'assistant') return last;
              const segs = [...last.segments];
              const lastSeg = segs[segs.length - 1];
              if (lastSeg?.type === 'thinking' && !lastSeg.done) {
                segs[segs.length - 1] = { ...lastSeg, text: msg.content as string };
              } else {
                segs.push(newThinkSeg);
              }
              return { ...last, segments: segs };
            });
          });
          break;

        // ── Content chunk ────────────────────────────────────────────────
        case 'contentChunk':
          setIsStreaming(true);
          setMessages(prev => {
            const newContentSeg: Segment = {
              type: 'content',
              text: msg.content as string,
            };

            if (allToolsDone(prev)) {
              setIterationCount(c => c + 1);
              return [...prev, newAsst({ segments: [newContentSeg] })];
            }

            return updateLast(prev, last => {
              if (last.role !== 'assistant') return last;
              const segs = [...last.segments];
              const lastSeg = segs[segs.length - 1];

              if (lastSeg?.type === 'thinking' && !lastSeg.done) {
                const finalMs = lastSeg.startedAt ? Date.now() - lastSeg.startedAt : undefined;
                segs[segs.length - 1] = { ...lastSeg, done: true, finalMs };
                segs.push(newContentSeg);
              } else if (lastSeg?.type === 'content') {
                segs[segs.length - 1] = { ...lastSeg, text: msg.content as string };
              } else {
                segs.push(newContentSeg);
              }
              return { ...last, segments: segs };
            });
          });
          break;

        // ── Tool starting ────────────────────────────────────────────────
        case 'toolActivityStart': {
          const newTool: ToolCall = {
            phaseId: msg.phaseId as string,
            name: (msg.toolName as string) || 'tool',
            summary: (msg.summary as string) || JSON.stringify(msg.args || {}),
            status: 'running',
            args: msg.args,
            startedAt: (msg.startedAt as number) || Date.now(),
          };
          const toolSeg: Segment = { type: 'tool', tool: newTool };

          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant') {
              return updateLast(prev, l => {
                const segs = [...l.segments];
                // Duplicate phaseId guard — aynı tool iki kez eklenmesin
                if (segs.some(s => s.type === 'tool' && s.tool.phaseId === newTool.phaseId)) return l;
                const lastSeg = segs[segs.length - 1];
                if (lastSeg?.type === 'thinking' && !lastSeg.done) {
                  const finalMs = lastSeg.startedAt ? Date.now() - lastSeg.startedAt : undefined;
                  segs[segs.length - 1] = { ...lastSeg, done: true, finalMs };
                }
                segs.push(toolSeg);
                return { ...l, segments: segs };
              });
            }
            return [...prev, newAsst({ segments: [toolSeg] })];
          });
          break;
        }

        // ── Tool done / error ────────────────────────────────────────────
        case 'toolActivityDone':
        case 'toolActivityError': {
          const ok = msg.type === 'toolActivityDone';
          // B01 FIX: If this is a background run_command, watch for process death
          const rawResult: string = msg.rawResult || '';
          if (rawResult.includes('"background":true') || rawResult.includes('"bgId":')) {
            try {
              const parsed = JSON.parse(rawResult);
              if (parsed?.bgId) {
                // Ask backend to notify us when this process exits
                vscode.postMessage({ type: 'watchBgProcess', bgId: parsed.bgId });
              }
            } catch { /* ignore */ }
          }

          setMessages(prev =>
            updateLast(prev, last => {
              if (last.role !== 'assistant') return last;
              const segs = last.segments.map(seg => {
                if (seg.type !== 'tool') return seg;
                if (seg.tool.phaseId !== msg.phaseId) return seg;
                return {
                  ...seg,
                  tool: {
                    ...seg.tool,
                    status: ok ? 'done' as const : 'error' as const,
                    result: msg.rawResult || msg.errorMessage || msg.summary,
                    finishedAt: (msg.finishedAt as number) || Date.now(),
                    // write_file için extra fields
                    ...(msg.hunks !== undefined ? {
                      hunks: msg.hunks,
                      addedCount: msg.addedCount,
                      removedCount: msg.removedCount,
                      mode: msg.mode,
                      fileName: msg.fileName,
                      path: msg.path,
                    } : {}),
                  },
                };
              });
              return { ...last, segments: segs };
            })
          );
          break;
        }

        // ── Background process died (Ctrl+C or natural exit) ────────────
        // Updates the tool card UI to show interrupted/done state
        case 'bgProcessDied': {
          const bgId = msg.bgId as string;
          const exitCode = msg.exitCode as number | null;
          const signal = msg.signal as string | null;
          const isInterrupted = signal === 'SIGINT' || signal === 'SIGTERM' || signal === '^C';

          setMessages(prev => prev.map(m => {
            if (m.role !== 'assistant') return m;
            const segs = m.segments.map(seg => {
              if (seg.type !== 'tool') return seg;
              // Find the tool that has this bgId in its result
              let parsed: any = null;
              try { if (seg.tool.result?.trim().startsWith('{')) parsed = JSON.parse(seg.tool.result); } catch {}
              if (!parsed || parsed.bgId !== bgId) return seg;

              // Update the result JSON with new status
              const updatedResult = JSON.stringify({
                ...parsed,
                status: isInterrupted ? 'interrupted' : (exitCode === 0 ? 'success' : 'error'),
                background: false,
                exitCode,
                signal,
                bgId: undefined, // clear bgId so Stop button hides
              });
              return {
                ...seg,
                tool: {
                  ...seg.tool,
                  status: 'done' as const,
                  result: updatedResult,
                  finishedAt: Date.now(),
                },
              };
            });
            return { ...m, segments: segs };
          }));
          break;
        }

        // ── Final response ───────────────────────────────────────────────
        case 'finalResponse':
          setIsProcessing(false);
          setIsStreaming(false);
          setMessages(prev => {
            const idx = [...prev].reverse().findIndex(m => m.role === 'assistant');
            if (idx === -1) return prev;
            const realIdx = prev.length - 1 - idx;
            const updated = [...prev];
            const last = updated[realIdx];

            let segs = [...last.segments];
            if (msg.content && !segs.some(s => s.type === 'content')) {
              segs.push({ type: 'content', text: msg.content as string });
            }
            segs = segs.map(s =>
              s.type === 'thinking' && !s.done
                ? { ...s, done: true, finalMs: s.startedAt ? Date.now() - s.startedAt : undefined }
                : s
            );
            updated[realIdx] = { ...last, segments: segs, isStreaming: false };
            return updated;
          });
          bumpScroll();
          break;

        // ── BUG 2 FIX: turnDone handler ─────────────────────────────────
        case 'turnDone':
          setIsProcessing(false);
          setIsStreaming(false);
          // Tüm açık thinking segment'leri kapat
          setMessages(prev => prev.map(msg => ({
            ...msg,
            isStreaming: false,
            segments: msg.segments.map(s =>
              s.type === 'thinking' && !s.done
                ? { ...s, done: true }
                : s
            ),
          })));
          break;

        // ── Error ────────────────────────────────────────────────────────
        case 'error':
          setIsProcessing(false);
          setIsStreaming(false);
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant') {
              return updateLast(prev, l => ({ ...l, error: msg.message as string, isStreaming: false }));
            }
            return [...prev, { id: `e${Date.now()}`, role: 'assistant' as const, segments: [], error: msg.message as string }];
          });
          break;

        // ── Session loaded (restore from history) ───────────────────────
        case 'sessionLoaded':
          if (Array.isArray(msg.messages) && msg.messages.length > 0) {
            // Messages are already in UI segment format (saved by App.tsx)
            const restored = msg.messages.map((m: any, i: number) => ({
              id: `r${i}-${Date.now()}`,
              role: m.role as 'user' | 'assistant',
              segments: Array.isArray(m.segments) ? m.segments : [],
              error: m.error,
              isStreaming: false,
            }));
            setMessages(restored);
          } else {
            setMessages([]);
          }
          if (msg.mode) setMode(msg.mode as AgentMode);
          setIsProcessing(false);
          setIsStreaming(false);
          setTaskDone(null);
          setPendingQuestion(null);
          setPendingQuestions(null);
          setPlanSaved(null);
          setIterationCount(0);
          bumpScroll();
          break;

        case 'clearHistory':
          clearMessages();
          setTodoItems('');
          setPendingQuestion(null);
          setPendingQuestions(null);
          setPlanSaved(null);
          setTaskDone(null);
          setIterationCount(0);
          break;

        // ── Interaction tool events ──────────────────────────────────────
        case 'todoUpdate':
          setTodoItems(msg.todos || '');
          break;

        case 'clarificationRequest':
          setPendingQuestion({ question: msg.question, options: msg.options });
          break;

        // ── Wizard multi-question (ask_followup_questions / ask_followup_question) ──
        case 'questionsRequest':
          setPendingQuestions(Array.isArray(msg.questions) ? msg.questions : null);
          // Also clear old single-question state
          setPendingQuestion(null);
          break;

        // ── Plan spec saved (save_plan tool) ────────────────────────────────
        case 'planSaved':
          setPlanSaved({
            title: msg.title || '',
            slug: msg.slug || '',
            planDir: msg.planDir || '',
            files: {
              requirements: msg.files?.requirements || '',
              design: msg.files?.design || '',
              tasks: msg.files?.tasks || '',
            },
          });
          break;

        case 'taskComplete':
          setTaskDone(msg.result || 'Task complete.');
          setIsProcessing(false);
          setIsStreaming(false);
          break;

        // ── @ Mention resolved ──────────────────────────────────────────────
        case 'mentionResolved':
          // Dispatch custom event so App.tsx can inject content into input
          window.dispatchEvent(new CustomEvent('codai:mentionResolved', { detail: msg }));
          break;

        // ── Token count estimate ─────────────────────────────────────────────
        case 'tokenCount':
          setTokenCount({
            contextTokens: msg.contextTokens ?? 0,
            contextChars: msg.contextChars ?? 0,
          });
          break;

        // ── BUG 10 FIX: Aktif dosya context yanıtı ──────────────────────
        case 'activeFileResult':
          setActiveFileContext(msg.file || null);
          break;

        // ── BUG 14 FIX: Ollama dinamik model listesi ────────────────────
        case 'ollamaModels':
          if (Array.isArray(msg.models) && msg.models.length > 0) {
            setOllamaModels(msg.models);
          }
          break;

        // Provider models (ProviderSettings componentinden tetiklenir)
        case 'providerModels':
          if (Array.isArray(msg.models) && msg.models.length > 0) {
            setOllamaModels(msg.models);
          }
          break;

        // providerChanged — provider başarıyla değişti
        case 'providerChanged':
          if (msg.providerId) {
            setProviderInfo(prev => ({
              ...prev,
              providerId: msg.providerId,
              hasApiKey: typeof msg.hasApiKey === 'boolean' ? msg.hasApiKey : prev.hasApiKey,
              baseUrl: typeof msg.baseUrl === 'string' && msg.baseUrl ? msg.baseUrl : prev.baseUrl,
              configs: msg.config
                ? {
                  ...prev.configs,
                  [msg.providerId]: msg.config,
                }
                : prev.configs,
            }));
          }
          break;
      }
    };

    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [clearMessages, bumpScroll]);

  // ── Auto-detect checklist in plan mode ──────────────────────────────────────
  useEffect(() => {
    if (mode !== 'plan') return;
    if (todoItems) return;
    const asstMsgs = messages.filter(m => m.role === 'assistant');
    if (!asstMsgs.length) return;
    const last = asstMsgs[asstMsgs.length - 1];
    if (last.isStreaming) return;
    const allText = last.segments
      .filter(s => s.type === 'content')
      .map((s: any) => s.text ?? '')
      .join('');
    const lines = allText.split('\n').filter((l: string) => /^\s*-\s*\[[ x]\]/i.test(l));
    if (lines.length >= 2) {
      setTodoItems(lines.join('\n'));
    }
  }, [messages, mode, todoItems]);

  return {
    messages, isProcessing, clearMessages, scrollTick,
    mode, setMode,
    todoItems, setTodoItems,
    pendingQuestion, setPendingQuestion,
    pendingQuestions, setPendingQuestions,
    planSaved, setPlanSaved,
    taskDone, setTaskDone,
    tokenCount,
    isStreaming,
    initialModel,
    iterationCount,
    activeFileContext, setActiveFileContext,
    ollamaModels,
    providerInfo,
  };
}
