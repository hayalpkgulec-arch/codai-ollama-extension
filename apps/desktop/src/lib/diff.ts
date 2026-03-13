import type { DesktopTabState, ReviewFileSummary } from '../store/types';

function splitLines(value: string): string[] {
  return value.replace(/\r\n/g, '\n').split('\n');
}

export function inferLanguageFromPath(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase() ?? '';
  switch (extension) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'json':
      return 'json';
    case 'css':
      return 'css';
    case 'html':
      return 'html';
    case 'md':
      return 'markdown';
    case 'py':
      return 'python';
    case 'rs':
      return 'rust';
    case 'go':
      return 'go';
    case 'yml':
    case 'yaml':
      return 'yaml';
    default:
      return 'plaintext';
  }
}

export function getTabDiffStats(originalContent: string, currentContent: string) {
  const original = splitLines(originalContent);
  const current = splitLines(currentContent);
  let added = 0;
  let removed = 0;
  let changed = 0;

  for (let index = 0; index < Math.max(original.length, current.length); index += 1) {
    const before = original[index];
    const after = current[index];
    if (before === after) {
      continue;
    }
    if (typeof before === 'undefined') {
      added += 1;
      continue;
    }
    if (typeof after === 'undefined') {
      removed += 1;
      continue;
    }
    changed += 1;
  }

  return { added, removed, changed };
}

export function buildReviewSummary(tabs: DesktopTabState[]): ReviewFileSummary[] {
  return tabs
    .filter((tab) => tab.originalContent !== tab.currentContent)
    .map((tab) => {
      const stats = getTabDiffStats(tab.originalContent, tab.currentContent);
      return {
        path: tab.path,
        title: tab.title,
        ...stats,
        dirty: true,
      };
    })
    .sort((left, right) => right.changed + right.added + right.removed - (left.changed + left.added + left.removed));
}

export function buildDiffPreview(originalContent: string, currentContent: string, limit = 12): string[] {
  const original = splitLines(originalContent);
  const current = splitLines(currentContent);
  const preview: string[] = [];

  for (let index = 0; index < Math.max(original.length, current.length); index += 1) {
    const before = original[index];
    const after = current[index];
    if (before === after) {
      continue;
    }
    if (typeof before !== 'undefined') {
      preview.push(`- ${before}`);
    }
    if (typeof after !== 'undefined') {
      preview.push(`+ ${after}`);
    }
    if (preview.length >= limit) {
      break;
    }
  }

  return preview.length > 0 ? preview : ['No pending changes'];
}
