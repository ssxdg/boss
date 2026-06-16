import type { DebugInfo } from './types';

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function makeDebugInfo(input: {
  phase: string;
  tabUrl?: string;
  tabId?: number;
  error?: unknown;
  details?: string[];
}): DebugInfo {
  return {
    phase: input.phase,
    tabUrl: input.tabUrl,
    tabId: input.tabId,
    message: input.error ? formatErrorMessage(input.error) : undefined,
    stack: input.error instanceof Error ? input.error.stack : undefined,
    details: input.details,
    createdAt: new Date().toISOString(),
  };
}
