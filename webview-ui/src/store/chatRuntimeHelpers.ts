import type { ChatMessage, Segment, ToolCall } from '../types';

export function updateLast<T>(arr: T[], fn: (item: T) => T): T[] {
  if (!arr.length) return arr;
  const next = [...arr];
  next[next.length - 1] = fn(next[next.length - 1]);
  return next;
}

export function newAssistantMessage(extra?: Partial<ChatMessage>): ChatMessage {
  return {
    id: `a${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    role: 'assistant',
    segments: [],
    isStreaming: true,
    ...extra,
  };
}

export function allToolsDone(messages: ChatMessage[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant') return false;
  const tools = last.segments.filter((segment) => segment.type === 'tool');
  return tools.length > 0 && tools.every((segment) => segment.type === 'tool' && segment.tool.status !== 'running');
}

export function buildToolSummaryFromHistory(fnName: string, args: any): string {
  const pathVal = args?.path || args?.oldPath || '';
  const pathBase = pathVal ? pathVal.split(/[/\\]/).filter(Boolean).pop() || pathVal : '';
  const summaryMap: Record<string, string> = {
    read_file: pathBase ? `Read ${pathBase}` : 'Read file',
    write_file: pathBase ? `Edited ${pathBase}` : 'Edited file',
    create_file: pathBase ? `Created ${pathBase}` : 'Created file',
    list_files: pathBase ? `List ${pathBase}` : 'List directory',
    list_directory_tree: pathBase ? `Tree ${pathBase}` : 'List directory tree',
    read_multiple_files: args?.paths ? `Read ${Array.isArray(args.paths) ? args.paths.length : '?'} files` : 'Read multiple files',
    write_multiple_files: args?.files ? `Write ${Array.isArray(args.files) ? args.files.length : '?'} files` : 'Write multiple files',
    delete_multiple_files: args?.paths ? `Delete ${Array.isArray(args.paths) ? args.paths.length : '?'} files` : 'Delete multiple files',
    search_files: args?.pattern ? `Search ${args.pattern}` : 'Search files',
    grep_code: args?.pattern ? `Grep "${args.pattern}"` : 'Search code',
    run_command: args?.command ? `Run: ${String(args.command).slice(0, 40)}` : 'Run command',
    delete_file: pathBase ? `Delete ${pathBase}` : 'Delete file',
    rename_file: 'Move file',
    get_diagnostics: pathBase ? `Diagnose ${pathBase}` : 'Diagnose workspace',
    web_fetch: args?.url ? `Fetch ${args.url}` : 'Web fetch',
    web_search: args?.query ? `Search ${String(args.query).slice(0, 40)}` : 'Web search',
    browser_navigate: args?.url ? `Open ${String(args.url).slice(0, 40)}` : 'Navigate browser',
    browser_click: args?.selector ? `Click ${String(args.selector).slice(0, 32)}` : 'Browser click',
    browser_type: args?.selector ? `Type into ${String(args.selector).slice(0, 28)}` : 'Browser type',
    browser_scroll: 'Browser scroll',
    browser_wait_for_text: args?.text ? `Wait for ${String(args.text).slice(0, 24)}` : 'Wait for text',
    browser_screenshot: 'Browser screenshot',
    browser_console_logs: 'Browser console logs',
    browser_close: 'Close browser',
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

export function reconstructHistory(history: any[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  const toolResults = new Map<string, string>();

  for (const entry of history) {
    if (entry.role === 'tool' && entry.tool_call_id) {
      toolResults.set(entry.tool_call_id, entry.content ?? '');
    }
  }

  let idx = 0;
  for (const entry of history) {
    if (entry.role === 'system' || entry.role === 'tool') continue;

    if (entry.role === 'user') {
      result.push({
        id: `h${idx++}`,
        role: 'user',
        segments: entry.content ? [{ type: 'content', text: entry.content }] : [],
      });
      continue;
    }

    if (entry.role === 'assistant') {
      const segments: Segment[] = [];

      if (entry.content) {
        segments.push({ type: 'content', text: entry.content });
      }

      if (Array.isArray(entry.tool_calls)) {
        for (const toolCall of entry.tool_calls) {
          const fnName: string = toolCall.function?.name ?? 'tool';
          const fnArgs = typeof toolCall.function?.arguments === 'string'
            ? (() => {
                try {
                  return JSON.parse(toolCall.function.arguments);
                } catch {
                  return {};
                }
              })()
            : (toolCall.function?.arguments ?? {});
          const callId: string = toolCall.id ?? '';
          const rawResult = callId ? toolResults.get(callId) ?? '' : '';
          const tool: ToolCall = {
            phaseId: callId || `r${idx}-${Math.random().toString(36).slice(2, 4)}`,
            name: fnName,
            summary: buildToolSummaryFromHistory(fnName, fnArgs),
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
