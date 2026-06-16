import { DEFAULT_CONFIG } from './domain';
import type { ApplyLog, AutoApplyConfig, RuntimeState } from './types';

const CONFIG_KEY = 'autoApplyConfig';
const LOGS_KEY = 'applyLogs';
const STATE_KEY = 'runtimeState';

export const DEFAULT_STATE: RuntimeState = {
  status: 'idle',
  todayAppliedCount: 0,
  updatedAt: new Date(0).toISOString(),
};

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

export async function getConfig(): Promise<AutoApplyConfig> {
  if (!hasChromeStorage()) {
    return DEFAULT_CONFIG;
  }
  const result = await chrome.storage.local.get(CONFIG_KEY);
  return { ...DEFAULT_CONFIG, ...(result[CONFIG_KEY] as Partial<AutoApplyConfig> | undefined) };
}

export async function saveConfig(config: AutoApplyConfig): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}

export async function getLogs(): Promise<ApplyLog[]> {
  if (!hasChromeStorage()) {
    return [];
  }
  const result = await chrome.storage.local.get(LOGS_KEY);
  return (result[LOGS_KEY] as ApplyLog[] | undefined) ?? [];
}

export async function saveLogs(logs: ApplyLog[]): Promise<void> {
  await chrome.storage.local.set({ [LOGS_KEY]: logs });
}

export async function appendLog(log: ApplyLog): Promise<void> {
  const logs = await getLogs();
  await saveLogs([log, ...logs].slice(0, 500));
}

export async function clearLogs(): Promise<void> {
  await saveLogs([]);
}

export async function getRuntimeState(): Promise<RuntimeState> {
  if (!hasChromeStorage()) {
    return DEFAULT_STATE;
  }
  const result = await chrome.storage.local.get(STATE_KEY);
  return { ...DEFAULT_STATE, ...(result[STATE_KEY] as Partial<RuntimeState> | undefined) };
}

export async function saveRuntimeState(state: RuntimeState): Promise<void> {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}
