import { makeDebugInfo } from './shared/diagnostics';
import { getRandomDelaySec, isDailyLimitReached, todayKey } from './shared/domain';
import {
  appendLog,
  clearLogs,
  getConfig,
  getLogs,
  getRuntimeState,
  saveConfig,
  saveRuntimeState,
} from './shared/storage';
import type { ApplyLog, CommandMessage, ContentResult, RuntimeState } from './shared/types';

const FAILURE_THRESHOLD = 3;
let consecutiveFailures = 0;

chrome.runtime.onInstalled.addListener(async () => {
  const config = await getConfig();
  await saveConfig(config);
  await setState({ status: 'idle', todayAppliedCount: countToday(await getLogs()) });
});

chrome.runtime.onMessage.addListener((message: CommandMessage, _sender, sendResponse) => {
  void handleMessage(message).then(sendResponse);
  return true;
});

async function handleMessage(message: CommandMessage) {
  if (message.type === 'GET_STATE') {
    return { config: await getConfig(), logs: await getLogs(), state: await getRuntimeState() };
  }

  if (message.type === 'CLEAR_LOGS') {
    await clearLogs();
    await setState({ status: 'idle', todayAppliedCount: 0, lastReason: '日志已清空' });
    return { ok: true };
  }

  if (message.type === 'PAUSE_AUTO_APPLY') {
    await pause(message.reason ?? '用户手动暂停');
    return { ok: true };
  }

  if (message.type === 'START_AUTO_APPLY' || message.type === 'RUN_ON_ACTIVE_TAB') {
    return runOnActiveTab();
  }

  return { ok: false, reason: '未知命令' };
}

async function runOnActiveTab() {
  const config = await getConfig();
  const logs = await getLogs();
  const todayAppliedCount = countToday(logs);

  if (isDailyLimitReached(todayAppliedCount, config.dailyLimit)) {
    await pause('已达到今日投递上限');
    return { ok: false, reason: '已达到今日投递上限' };
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.id || !tab.url?.includes('zhipin.com')) {
    await pause('当前页面不是 Boss 直聘目标页面');
    return { ok: false, reason: '当前页面不是 Boss 直聘目标页面' };
  }

  await saveConfig({ ...config, enabled: true });
  await setState({ status: 'running', todayAppliedCount });

  try {
    const result = await sendContentRunMessage(tab.id, tab.url, config, todayAppliedCount);
    await handleContentResult(result);
    return { ok: result.ok, result };
  } catch (error) {
    const debugInfo = makeDebugInfo({
      phase: 'send-message-after-injection',
      tabId: tab.id,
      tabUrl: tab.url,
      error,
      details: [
        'content script 通信失败',
        '如果页面在扩展安装或重新加载前已经打开，请刷新 Boss 页面后重试',
        '也可以打开扩展管理页，检查 Service Worker 控制台',
      ],
    });
    const reason = `页面脚本不可用或页面结构异常：${debugInfo.message ?? '未知错误'}`;
    await pause(reason, debugInfo);
    return { ok: false, reason, debugInfo };
  }
}

async function sendContentRunMessage(
  tabId: number,
  tabUrl: string | undefined,
  config: Awaited<ReturnType<typeof getConfig>>,
  todayAppliedCount: number,
): Promise<ContentResult> {
  try {
    return (await chrome.tabs.sendMessage(tabId, {
      type: 'CONTENT_RUN',
      config,
      todayAppliedCount,
    })) as ContentResult;
  } catch (firstError) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    try {
      return (await chrome.tabs.sendMessage(tabId, {
        type: 'CONTENT_RUN',
        config,
        todayAppliedCount,
      })) as ContentResult;
    } catch (secondError) {
      throw new Error(
        [
          '首次通信失败',
          firstError instanceof Error ? firstError.message : String(firstError),
          '补注入 content.js 后仍失败',
          secondError instanceof Error ? secondError.message : String(secondError),
          tabUrl ? `tabUrl=${tabUrl}` : undefined,
        ]
          .filter(Boolean)
          .join('；'),
      );
    }
  }
}

async function handleContentResult(result: ContentResult): Promise<void> {
  if (!result.ok) {
    consecutiveFailures += 1;
    await appendLog(makePausedLog(result.reason, result.status));
    if (consecutiveFailures >= FAILURE_THRESHOLD) {
      await pause('连续失败次数达到阈值');
      return;
    }
    await setState({
      status: result.status === 'paused' ? 'waiting_for_user' : 'error',
      lastReason: result.reason,
      debugInfo: result.debugInfo,
    });
    return;
  }

  consecutiveFailures = result.status === 'applied' ? 0 : consecutiveFailures;
  await appendLog({
    id: crypto.randomUUID(),
    ...result.job,
    status: result.status,
    reason: result.reason ?? result.warnings?.join('；'),
    createdAt: new Date().toISOString(),
  });

  const logs = await getLogs();
  const config = await getConfig();
  const todayAppliedCount = countToday(logs);
  if (isDailyLimitReached(todayAppliedCount, config.dailyLimit)) {
    await pause('已达到今日投递上限');
    return;
  }

  const delay = getRandomDelaySec(config.delayMinSec, config.delayMaxSec);
  await setState({ status: 'paused', todayAppliedCount, lastReason: `等待 ${delay} 秒后可继续` });
}

async function pause(reason: string, debugInfo?: RuntimeState['debugInfo']): Promise<void> {
  const config = await getConfig();
  await saveConfig({ ...config, enabled: false });
  await setState({ status: 'paused', todayAppliedCount: countToday(await getLogs()), lastReason: reason, debugInfo });
}

async function setState(partial: Partial<RuntimeState>): Promise<void> {
  const previous = await getRuntimeState();
  await saveRuntimeState({ ...previous, ...partial, updatedAt: new Date().toISOString() });
}

function countToday(logs: ApplyLog[]): number {
  const key = todayKey();
  return logs.filter((log) => log.status === 'applied' && log.createdAt.startsWith(key)).length;
}

function makePausedLog(reason: string, status: 'paused' | 'failed'): ApplyLog {
  return {
    id: crypto.randomUUID(),
    jobTitle: '',
    company: '',
    city: '',
    salary: '',
    url: '',
    status,
    reason,
    createdAt: new Date().toISOString(),
  };
}
