export interface AutoApplyConfig {
  keywords: string[];
  city: string;
  salaryMin: number | null;
  salaryMax: number | null;
  dailyLimit: number;
  delayMinSec: number;
  delayMaxSec: number;
  messageTemplates: string[];
  enabled: boolean;
}

export interface JobInfo {
  jobTitle: string;
  company: string;
  city: string;
  salary: string;
  url: string;
}

export interface ApplyLog extends JobInfo {
  id: string;
  status: 'applied' | 'skipped' | 'failed' | 'paused';
  reason?: string;
  createdAt: string;
}

export interface RuntimeState {
  status: 'idle' | 'running' | 'paused' | 'waiting_for_user' | 'error';
  todayAppliedCount: number;
  lastReason?: string;
  debugInfo?: DebugInfo;
  updatedAt: string;
}

export interface DebugInfo {
  phase: string;
  tabUrl?: string;
  tabId?: number;
  message?: string;
  stack?: string;
  details?: string[];
  createdAt: string;
}

export interface TemplateRenderResult {
  message: string;
  warnings: string[];
}

export interface MatchResult {
  matched: boolean;
  reason?: string;
}

export type CommandMessage =
  | { type: 'START_AUTO_APPLY' }
  | { type: 'PAUSE_AUTO_APPLY'; reason?: string }
  | { type: 'GET_STATE' }
  | { type: 'CLEAR_LOGS' }
  | { type: 'RUN_ON_ACTIVE_TAB' };

export type ContentMessage =
  | { type: 'CONTENT_RUN'; config: AutoApplyConfig; todayAppliedCount: number }
  | { type: 'CONTENT_PAUSE'; reason: string };

export type ContentResult =
  | { ok: true; job: JobInfo; status: 'applied' | 'skipped'; reason?: string; warnings?: string[]; debugInfo?: DebugInfo }
  | { ok: false; status: 'paused' | 'failed'; reason: string; debugInfo?: DebugInfo };
