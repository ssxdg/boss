import { makeDebugInfo } from './shared/diagnostics';
import { buildBackgroundJobSearchUrl, isBossSecurityCheckPage, shouldAllowChatPageSend, shouldRedirectWaitingChatToSearch } from './shared/backgroundNavigation';
import { getRandomDelaySec, isDailyLimitReached, todayKey } from './shared/domain';
import { getExcludedJobKeys } from './shared/jobIdentity';
import { getNextRunAt } from './shared/scheduler';
import {
  appendLog,
  clearLogs,
  getConfig,
  getLogs,
  getRuntimeState,
  saveConfig,
  saveRuntimeState,
} from './shared/storage';
import type { ApplyLog, CommandMessage, ContentResult, JobInfo, RuntimeState } from './shared/types';

const FAILURE_THRESHOLD = 3;
const MAX_RUN_STEPS = 8;
const SEARCH_NAVIGATION_TIMEOUT_MS = 15000;
const CONTENT_RETRY_DELAY_MS = 2500;
const NEXT_RUN_ALARM_NAME = 'boss-auto-apply-next-run';
let consecutiveFailures = 0;
let runInProgress = false;

chrome.runtime.onInstalled.addListener(async () => {
  const config = await getConfig();
  await saveConfig(config);
  await setState({ status: 'idle', todayAppliedCount: countToday(await getLogs()) });
});

chrome.runtime.onMessage.addListener((message: CommandMessage, _sender, sendResponse) => {
  void handleMessage(message).then(sendResponse);
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== NEXT_RUN_ALARM_NAME) {
    return;
  }

  void runIfEnabled();
});

async function handleMessage(message: CommandMessage) {
  if (message.type === 'GET_STATE') {
    return { config: await getConfig(), logs: await getLogs(), state: await getRuntimeState() };
  }

  if (message.type === 'CLEAR_LOGS') {
    await clearLogs();
    await clearNextRunAlarm();
    await setState({ status: 'idle', todayAppliedCount: 0, lastReason: '日志已清空', nextRunAt: undefined });
    return { ok: true };
  }

  if (message.type === 'PAUSE_AUTO_APPLY') {
    await pause(message.reason ?? '用户手动暂停');
    return { ok: true };
  }

  if (message.type === 'START_AUTO_APPLY' || message.type === 'RUN_ON_ACTIVE_TAB') {
    return runOnActiveTab(message.type === 'START_AUTO_APPLY' ? message.config : undefined);
  }

  return { ok: false, reason: '未知命令' };
}

async function runOnActiveTab(configOverride?: Awaited<ReturnType<typeof getConfig>>) {
  if (runInProgress) {
    return { ok: false, reason: '已有投递任务正在运行' };
  }

  runInProgress = true;
  try {
    return await executeRunOnActiveTab(configOverride);
  } finally {
    runInProgress = false;
  }
}

async function executeRunOnActiveTab(configOverride?: Awaited<ReturnType<typeof getConfig>>) {
  await clearNextRunAlarm();

  const storedConfig = await getConfig();
  const config = configOverride ? { ...storedConfig, ...configOverride } : storedConfig;
  const previousState = await getRuntimeState();
  if (configOverride) {
    await saveConfig(config);
  }

  const logs = await getLogs();
  const todayAppliedCount = countToday(logs);
  const excludedJobKeys = getExcludedJobKeys(logs);

  if (isDailyLimitReached(todayAppliedCount, config.dailyLimit)) {
    await pause('已达到今日投递上限');
    return { ok: false, reason: '已达到今日投递上限' };
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.id || !tab.url?.includes('zhipin.com')) {
    await pause('当前页面不是 Boss 直聘目标页面');
    return { ok: false, reason: '当前页面不是 Boss 直聘目标页面' };
  }
  const tabId = tab.id;
  let activeTabUrl: string | undefined = tab.url;
  let hasLeftInitialWaitingChat = !shouldRedirectWaitingChatToSearch(previousState.status, activeTabUrl ?? '');

  await saveConfig({ ...config, enabled: true });
  await setState({ status: 'running', todayAppliedCount, nextRunAt: undefined, debugInfo: undefined });

  try {
    if (shouldRedirectWaitingChatToSearch(previousState.status, activeTabUrl ?? '')) {
      const searchUrl = buildBackgroundJobSearchUrl(config);
      if (!searchUrl) {
        await pause('上一轮已完成投递，但未配置岗位关键词，无法返回岗位列表查找下一个岗位');
        return { ok: false, reason: '上一轮已完成投递，但未配置岗位关键词，无法返回岗位列表查找下一个岗位' };
      }

      await setState({
        status: 'running',
        todayAppliedCount,
        lastReason: '上一轮已完成投递，正在返回岗位列表查找下一个岗位',
      });
      await chrome.tabs.update(tabId, { url: searchUrl });
      await waitForUsableTab(tabId, SEARCH_NAVIGATION_TIMEOUT_MS);
      activeTabUrl = (await chrome.tabs.get(tabId)).url;
      hasLeftInitialWaitingChat = true;
    }

    let lastWaitReason = '';
    for (let step = 0; step < MAX_RUN_STEPS; step += 1) {
      await waitForUsableTab(tabId, SEARCH_NAVIGATION_TIMEOUT_MS);
      activeTabUrl = (await chrome.tabs.get(tabId)).url;
      const allowChatPageSend = shouldAllowChatPageSend(previousState.status, hasLeftInitialWaitingChat);
      const result = await sendContentRunMessage(tabId, activeTabUrl, config, todayAppliedCount, excludedJobKeys, allowChatPageSend);
      if (result.ok && result.status === 'searched') {
        lastWaitReason = result.reason ?? '已打开岗位搜索页，继续筛选岗位';
        await setState({
          status: 'running',
          todayAppliedCount,
          lastReason: lastWaitReason,
        });
        await chrome.tabs.update(tabId, { url: result.searchUrl });
        await waitForUsableTab(tabId, SEARCH_NAVIGATION_TIMEOUT_MS);
        activeTabUrl = (await chrome.tabs.get(tabId)).url;
        hasLeftInitialWaitingChat = true;
        continue;
      }

      if (result.ok && result.status === 'loading') {
        lastWaitReason = result.reason ?? '页面仍在加载，稍后重试';
        await setState({
          status: 'running',
          todayAppliedCount,
          lastReason: lastWaitReason,
        });
        await delay(CONTENT_RETRY_DELAY_MS);
        activeTabUrl = (await chrome.tabs.get(tabId)).url;
        continue;
      }

      await handleContentResult(result);
      return { ok: result.ok, result };
    }

    const reason = `${lastWaitReason || 'Boss 页面加载超时'}，已超过最大等待次数；请确认 Boss 页面已加载完成后重试`;
    await pause(reason);
    return { ok: false, reason };
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
  excludedJobKeys: string[],
  allowChatPageSend: boolean,
): Promise<ContentResult> {
  try {
    return (await chrome.tabs.sendMessage(tabId, {
      type: 'CONTENT_RUN',
      config,
      todayAppliedCount,
      excludedJobKeys,
      allowChatPageSend,
    })) as ContentResult;
  } catch (firstError) {
    const currentTab = await chrome.tabs.get(tabId);
    // 页面跳转时旧 content script 会被销毁，必须先等新页面稳定再重试通信。
    if (currentTab.status === 'loading' || isBossSecurityCheckPage(currentTab.url ?? '')) {
      await waitForUsableTab(tabId, SEARCH_NAVIGATION_TIMEOUT_MS);
    }
    const stableTab = await chrome.tabs.get(tabId);
    if (stableTab.url !== tabUrl && stableTab.url?.includes('/web/geek/chat')) {
      throw new Error('页面在发送过程中跳转到聊天页，无法确认消息是否已发送，请检查聊天记录后重试');
    }
    try {
      return (await chrome.tabs.sendMessage(tabId, {
        type: 'CONTENT_RUN', config, todayAppliedCount, excludedJobKeys, allowChatPageSend,
      })) as ContentResult;
    } catch {
      // 已打开的旧页面可能没有自动注入脚本，此时再补注入。
    }
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    try {
      return (await chrome.tabs.sendMessage(tabId, {
        type: 'CONTENT_RUN',
        config,
        todayAppliedCount,
        excludedJobKeys,
        allowChatPageSend,
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
  if (result.ok && result.status === 'searched') {
    await setState({ status: 'running', lastReason: result.reason ?? '已打开岗位搜索页' });
    return;
  }

  if (result.ok && result.status === 'loading') {
    await setState({ status: 'running', lastReason: result.reason ?? '职位列表仍在加载' });
    return;
  }

  if (!result.ok) {
    consecutiveFailures += 1;
    await appendLog(makeResultLog(result.reason, result.status, result.job));
    if (consecutiveFailures >= FAILURE_THRESHOLD) {
      await pause('连续失败次数达到阈值');
      return;
    }
    await setState({
      status: result.status === 'paused' ? 'waiting_for_user' : 'error',
      lastReason: result.reason,
      nextRunAt: undefined,
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
  await scheduleNextRun(delay, todayAppliedCount);
}

async function scheduleNextRun(delaySec: number, todayAppliedCount: number): Promise<void> {
  const nextRunAt = getNextRunAt(Date.now(), delaySec);
  chrome.alarms.create(NEXT_RUN_ALARM_NAME, { when: Date.parse(nextRunAt) });
  await setState({
    status: 'waiting',
    todayAppliedCount,
    lastReason: `等待 ${delaySec} 秒后投递下一个`,
    nextRunAt,
    debugInfo: undefined,
  });
}

async function runIfEnabled(): Promise<void> {
  const config = await getConfig();
  if (config.enabled) {
    await runOnActiveTab();
  }
}

async function waitForUsableTab(tabId: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let tab = await chrome.tabs.get(tabId);
  while ((tab.status !== 'complete' || isBossSecurityCheckPage(tab.url ?? '')) && Date.now() < deadline) {
    await delay(250);
    tab = await chrome.tabs.get(tabId);
  }
  if (isBossSecurityCheckPage(tab.url ?? '')) {
    throw new Error('Boss 安全验证页面尚未结束，请在网页完成验证后重新启动插件');
  }
  if (tab.status !== 'complete') {
    throw new Error('Boss 页面加载超时，请等待页面加载完成后重新启动插件');
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function pause(reason: string, debugInfo?: RuntimeState['debugInfo']): Promise<void> {
  await clearNextRunAlarm();
  const config = await getConfig();
  await saveConfig({ ...config, enabled: false });
  await setState({ status: 'paused', todayAppliedCount: countToday(await getLogs()), lastReason: reason, nextRunAt: undefined, debugInfo });
}

async function clearNextRunAlarm(): Promise<void> {
  await chrome.alarms.clear(NEXT_RUN_ALARM_NAME);
}

async function setState(partial: Partial<RuntimeState>): Promise<void> {
  const previous = await getRuntimeState();
  await saveRuntimeState({ ...previous, ...partial, updatedAt: new Date().toISOString() });
}

function countToday(logs: ApplyLog[]): number {
  const key = todayKey();
  return logs.filter((log) => log.status === 'applied' && log.createdAt.startsWith(key)).length;
}

function makeResultLog(reason: string, status: 'paused' | 'failed', job?: JobInfo): ApplyLog {
  return {
    id: crypto.randomUUID(),
    jobTitle: job?.jobTitle ?? '',
    company: job?.company ?? '',
    city: job?.city ?? '',
    salary: job?.salary ?? '',
    url: job?.url ?? '',
    status,
    reason,
    createdAt: new Date().toISOString(),
  };
}
