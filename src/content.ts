import type {
  AutoApplyConfig,
  ContentMessage,
  ContentResult,
  DebugInfo,
  JobInfo,
  MatchResult,
  TemplateRenderResult,
} from './shared/types';
import {
  clickElementSafely,
  describeElement,
  findChatMessageInput,
  findChatSendButton,
  findContactButton,
  findJobCardContainer,
  hasUploadAttachmentDialog,
  isDisabledAction,
} from './shared/domActions';
import { decideChatPageAction } from './shared/chatFlow';
import { parseChatHeaderJob } from './shared/chatJobParser';
import { waitForInputText } from './shared/inputSync';
import { buildBossJobSearchUrl, hasBossSalaryFilter, isBossChatPage, isBossJobSearchPage, shouldStartJobSearch } from './shared/jobSearch';

chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
  if (message.type === 'CONTENT_RUN') {
    void runOnce(message).then(sendResponse);
    return true;
  }
  return false;
});

async function runOnce(message: Extract<ContentMessage, { type: 'CONTENT_RUN' }>): Promise<ContentResult> {
  await waitForPageHydration();

  const pageStatus = detectPageStatus();
  if (!pageStatus.ok) {
    return {
      ok: false,
      status: 'paused',
      reason: pageStatus.reason,
      debugInfo: makeDebugInfo({
        phase: 'detect-page-status',
        tabUrl: location.href,
        details: pageStatus.details,
      }),
    };
  }

  if (isDailyLimitReached(message.todayAppliedCount, message.config.dailyLimit)) {
    return { ok: false, status: 'paused', reason: '已达到今日投递上限' };
  }

  const listJobs = readJobList();

  if (isBossChatPage(location.href)) {
    const currentJob = await waitUntil(() => readCurrentJob(), 8000);
    const action = decideChatPageAction({
      allowChatPageSend: message.allowChatPageSend,
      hasCurrentJob: Boolean(currentJob),
      isCurrentJobExcluded: currentJob ? isExcludedJob(currentJob, message.excludedJobKeys) : false,
    });

    if (action === 'wait_for_current_job') {
      return {
        ok: true,
        status: 'loading',
        reason: 'Boss 聊天页岗位信息仍在加载，等待当前沟通对象渲染完成',
        debugInfo: makeDebugInfo({
          phase: 'wait-chat-current-job',
          tabUrl: location.href,
          details: collectPageDiagnostics(),
        }),
      };
    }

    if (action === 'return_to_search') {
      const searchUrl = buildBossJobSearchUrl(message.config, location.origin);
      if (!searchUrl) {
        return {
          ok: false,
          status: 'paused',
          reason: '当前聊天岗位已处理，但未配置岗位关键词，无法返回岗位搜索列表',
          debugInfo: makeDebugInfo({
            phase: 'redirect-chat-to-search',
            tabUrl: location.href,
            details: collectPageDiagnostics(),
          }),
        };
      }

      return {
        ok: true,
        status: 'searched',
        searchUrl,
        reason: '当前聊天岗位已处理，返回岗位列表查找下一个岗位',
      };
    }

    const template = selectMessageTemplate(message.config.messageTemplates, message.todayAppliedCount);
    const rendered = renderMessageTemplate(template, currentJob!);
    const sendAction = await fillAndSendMessage(rendered.message);
    if (!sendAction.ok) {
      return {
        ok: false,
        status: sendAction.status,
        reason: sendAction.reason,
        job: currentJob!,
        debugInfo: makeDebugInfo({
          phase: 'fill-chat-page',
          tabUrl: location.href,
          details: collectPageDiagnostics(),
        }),
      };
    }
    return { ok: true, job: currentJob!, status: 'applied', warnings: rendered.warnings };
  }

  if (isBossJobSearchPage(location.href) && listJobs.length === 0 && isSearchResultStillLoading()) {
    return {
      ok: true,
      status: 'loading',
      reason: 'Boss 职位列表仍在加载，等待页面渲染完成',
      debugInfo: makeDebugInfo({
        phase: 'wait-job-search-results',
        tabUrl: location.href,
        details: collectPageDiagnostics(),
      }),
    };
  }

  if (shouldStartJobSearch(location.href, listJobs.length > 0)) {
    const searchUrl = buildBossJobSearchUrl(message.config, location.origin);
    if (!searchUrl) {
      return {
        ok: false,
        status: 'paused',
        reason: '请先在插件中配置岗位关键词，再从 Boss 首页启动自动搜索',
        debugInfo: makeDebugInfo({
          phase: 'prepare-job-search',
          tabUrl: location.href,
          details: collectPageDiagnostics(),
        }),
      };
    }

    return {
      ok: true,
      status: 'searched',
      searchUrl,
      reason: `已打开岗位搜索：${message.config.keywords.join(' ')}`,
    };
  }

  const jobSelection = readBestJob(message.config, listJobs, message.excludedJobKeys);
  if (!jobSelection) {
    return {
      ok: false,
      status: 'paused',
      reason: '页面结构不符合预期，未找到岗位信息',
      debugInfo: makeDebugInfo({
        phase: 'read-current-job',
        tabUrl: location.href,
        details: collectPageDiagnostics(),
      }),
    };
  }
  const { job, sourceElement } = jobSelection;

  const match = jobMatchesConfig(job, message.config);
  if (!match.matched) {
    return { ok: true, job, status: 'skipped', reason: match.reason };
  }

  const template = selectMessageTemplate(message.config.messageTemplates, message.todayAppliedCount);
  const rendered = renderMessageTemplate(template, job);
  const action = await fillAndSendMessage(rendered.message, sourceElement);
  if (!action.ok) {
    return {
      ok: false,
      status: action.status,
      reason: action.reason,
      job,
      debugInfo: makeDebugInfo({
        phase: 'fill-and-send-message',
        tabUrl: location.href,
        details: collectPageDiagnostics(),
      }),
    };
  }

  return { ok: true, job, status: 'applied', warnings: rendered.warnings };
}

function detectPageStatus(): { ok: true } | { ok: false; reason: string; details: string[] } {
  if (!location.hostname.includes('zhipin.com')) {
    return { ok: false, reason: '当前页面不是 Boss 直聘目标页面', details: collectPageDiagnostics() };
  }

  const bodyText = document.body.innerText;
  if (/登录|扫码登录|请先登录/.test(bodyText) && !/沟通|立即沟通|继续沟通/.test(bodyText)) {
    return { ok: false, reason: '未登录或登录已失效', details: collectPageDiagnostics() };
  }

  if (/验证码|安全验证|人机验证|拖动滑块|验证身份/.test(bodyText)) {
    return { ok: false, reason: '出现验证码或安全验证，需要人工处理', details: collectPageDiagnostics() };
  }

  return { ok: true };
}

function readBestJob(
  config: AutoApplyConfig,
  listJobs = readJobList(),
  excludedJobKeys: readonly string[] = [],
): { job: JobInfo; sourceElement?: HTMLElement } | null {
  const availableJobs = listJobs.filter(({ job }) => !isExcludedJob(job, excludedJobKeys));
  const matched = availableJobs.find(({ job }) => jobMatchesConfig(job, config).matched);
  if (matched) {
    return matched;
  }

  if (availableJobs.length > 0) {
    return availableJobs[0];
  }

  if (listJobs.length > 0) {
    return null;
  }

  const currentJob = readCurrentJob();
  return currentJob && !isExcludedJob(currentJob, excludedJobKeys) ? { job: currentJob } : null;
}

function readJobList(): Array<{ job: JobInfo; sourceElement: HTMLElement }> {
  const titleElements = Array.from(document.querySelectorAll<HTMLElement>('.job-title, [class*="job-title"]'));
  return titleElements
    .map((titleElement) => {
      const card = findJobCardContainer(titleElement);
      const jobTitle = titleElement.textContent?.trim() ?? '';
      const company =
        textFromWithin(card, '.company-name') ||
        textFromWithin(card, '[class*="company"]') ||
        textFromWithin(card, '.name') ||
        textFrom('[class*="company"]') ||
        '';
      const city =
        inferFromElementText(card, /(北京|上海|广州|深圳|杭州|成都|武汉|南京|苏州|西安|重庆|天津)/) ||
        textFromWithin(card, '[class*="city"]') ||
        '';
      const salary =
        textFromWithin(card, '.salary') ||
        textFromWithin(card, '[class*="salary"]') ||
        inferFromElementText(card, /\d+(?:\.\d+)?-\d+(?:\.\d+)?K|\d+(?:\.\d+)?K以上/) ||
        '';

      if (!jobTitle) {
        return null;
      }

      return {
        sourceElement: card,
        job: {
          jobTitle,
          company,
          city,
          salary,
          url: location.href,
        },
      };
    })
    .filter((item): item is { job: JobInfo; sourceElement: HTMLElement } => Boolean(item));
}

function readCurrentJob(): JobInfo | null {
  if (isBossChatPage(location.href)) {
    const chatJob = parseChatHeaderJob(readChatPageText(), location.href);
    if (chatJob) {
      return chatJob;
    }
  }

  const title =
    textFrom('.job-title') ||
    textFrom('.name') ||
    textFrom('[class*="job-title"]') ||
    textFrom('h1');
  const company =
    textFrom('.company-info .name') ||
    textFrom('[class*="company"] .name') ||
    textFrom('[class*="company"]');
  const city =
    textFrom('.job-primary .info-primary p') ||
    textFrom('[class*="job"] [class*="city"]') ||
    inferFromText(/(北京|上海|广州|深圳|杭州|成都|武汉|南京|苏州|西安|重庆|天津)/);
  const salary =
    textFrom('.salary') ||
    textFrom('[class*="salary"]') ||
    inferFromText(/\d+(?:\.\d+)?-\d+(?:\.\d+)?K|\d+(?:\.\d+)?K以上/);

  if (!title || !company) {
    return null;
  }

  return {
    jobTitle: title,
    company,
    city: city ?? '',
    salary: salary ?? '',
    url: location.href,
  };
}

async function fillAndSendMessage(
  message: string,
  sourceElement?: HTMLElement,
): Promise<{ ok: true } | { ok: false; status: 'paused' | 'failed'; reason: string }> {
  if (hasUploadAttachmentDialog()) {
    return makeUploadAttachmentPausedResult('before-action');
  }

  let input = findMessageInput();

  if (!input && sourceElement) {
    sourceElement.scrollIntoView({ block: 'center', inline: 'nearest' });
    clickElementSafely(sourceElement);
    await waitUntil(() => findMessageInput() || findContactButton() || (hasUploadAttachmentDialog() ? document.body : null), 5000);
    if (hasUploadAttachmentDialog()) {
      return makeUploadAttachmentPausedResult(`after-source-click ${describeElement(sourceElement)}`);
    }
    input = findMessageInput();
  }

  if (!input) {
    const contactButton = await waitForElement(findContactButton, 8000);
    if (!contactButton) {
      return { ok: false, status: 'failed', reason: '未找到立即沟通按钮或聊天输入框' };
    }

    clickElementSafely(contactButton);
    await waitUntil(() => findMessageInput() || (hasUploadAttachmentDialog() ? document.body : null), 10000);
    if (hasUploadAttachmentDialog()) {
      return makeUploadAttachmentPausedResult(`after-contact-click ${describeElement(contactButton)}`);
    }
    input = findMessageInput();
  }

  input = input ?? await waitForElement(findMessageInput, 10000);
  if (!input) {
    return { ok: false, status: 'failed', reason: '已点击立即沟通，但未进入聊天输入框' };
  }

  writeMessageToInput(input, message);
  if (!(await waitForInputText(input, message))) {
    return { ok: false, status: 'failed', reason: '已定位聊天输入区，但消息内容写入失败' };
  }

  const sendButtonCandidate = findChatSendButton(input, document, { allowDisabled: true });
  if (!sendButtonCandidate) {
    return { ok: false, status: 'failed', reason: '未找到聊天输入框附近可用的发送按钮' };
  }

  const sendButton = await waitForElement(() => {
    const button = findChatSendButton(input, document, { allowDisabled: true });
    return button && !isDisabledAction(button) ? button : null;
  }, 3000);
  if (!sendButton) {
    return { ok: false, status: 'failed', reason: '已填写沟通内容，但发送按钮仍未变为可用' };
  }

  sendButton.click();
  await waitUntil(() => (hasUploadAttachmentDialog() ? document.body : null), 800);
  if (hasUploadAttachmentDialog()) {
    return makeUploadAttachmentPausedResult(`after-send-click ${describeElement(sendButton)}`);
  }

  return { ok: true };
}

function readChatPageText(): string {
  const input = findMessageInput();
  let current = input?.parentElement ?? null;

  for (let depth = 0; current && depth < 8; depth += 1) {
    const text = current.innerText || current.textContent || '';
    if (/\d+(?:\.\d+)?-\d+(?:\.\d+)?K/.test(text)) {
      return text;
    }
    current = current.parentElement;
  }

  return document.body.innerText;
}

function writeMessageToInput(input: HTMLElement, message: string): void {
  input.click();
  input.focus();

  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    setNativeValue(input, message);
  } else {
    input.textContent = '';
    selectEditableContents(input);
    const inserted = tryInsertText(message);
    if (!inserted) {
      dispatchPasteText(input, message);
    }
    if (!inserted || !(input.textContent || '').includes(message)) {
      input.textContent = message;
    }
  }

  input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: message }));
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: message }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
}

function setNativeValue(input: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(input, value);
  if (input.value !== value) {
    input.value = value;
  }
}

function tryInsertText(message: string): boolean {
  try {
    return Boolean(document.execCommand?.('insertText', false, message));
  } catch {
    return false;
  }
}

function selectEditableContents(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function dispatchPasteText(element: HTMLElement, message: string): void {
  try {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', message);
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  } catch {
    element.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }));
  }
}

function makeUploadAttachmentPausedResult(stage: string): { ok: false; status: 'paused'; reason: string } {
  return {
    ok: false,
    status: 'paused',
    reason: `检测到 Boss 上传附件弹窗，已暂停自动操作。触发位置：${stage}。请关闭弹窗后重新启动。`,
  };
}

function textFromWithin(root: ParentNode, selector: string): string | null {
  const element = root.querySelector(selector);
  return element?.textContent?.trim() || null;
}

function inferFromElementText(element: HTMLElement, pattern: RegExp): string | null {
  return element.innerText.match(pattern)?.[0] ?? null;
}

async function waitForPageHydration(timeoutMs = 12000): Promise<void> {
  await waitUntil(
    () =>
      (document.readyState === 'complete' && !isBossJobSearchPage(location.href)) ||
      (!isBossJobSearchPage(location.href) && document.body.innerText.trim().length > 20) ||
      document.querySelectorAll('.job-title, [class*="job-title"], textarea, [contenteditable="true"]').length > 0,
    timeoutMs,
  );
}

async function waitForElement<T extends Element>(finder: () => T | null, timeoutMs: number): Promise<T | null> {
  const found = await waitUntil(() => finder(), timeoutMs);
  return found ?? null;
}

function waitUntil<T>(predicate: () => T | null | false, timeoutMs: number): Promise<T | null> {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const tick = () => {
      const result = predicate();
      if (result) {
        resolve(result);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        resolve(null);
        return;
      }

      window.setTimeout(tick, 250);
    };

    tick();
  });
}

function jobMatchesConfig(job: JobInfo, config: AutoApplyConfig): MatchResult {
  const keywords = parseConfigKeywords(config.keywords);
  if (keywords.length > 0 && !keywords.some((keyword) => job.jobTitle.includes(keyword))) {
    return { matched: false, reason: '岗位关键词不匹配' };
  }

  const configuredCity = config.city.trim();
  if (configuredCity && !job.city.includes(configuredCity)) {
    return {
      matched: false,
      reason: `城市不匹配：配置=${configuredCity}，岗位=${job.city || '未识别'}`,
    };
  }

  if (!hasBossSalaryFilter(location.href) && !salaryMatches(job.salary, config.salaryMin, config.salaryMax)) {
    return { matched: false, reason: '薪资范围不匹配' };
  }

  return { matched: true };
}

function parseConfigKeywords(keywords: string[]): string[] {
  return keywords
    .join(' ')
    .split(/[\s,，、;；]+/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

function isExcludedJob(job: Pick<JobInfo, 'jobTitle' | 'company'>, excludedJobKeys: readonly string[]): boolean {
  const key = getJobKey(job);
  return Boolean(key && excludedJobKeys.includes(key));
}

function getJobKey(job: Pick<JobInfo, 'jobTitle' | 'company'>): string | null {
  const title = normalizeJobField(job.jobTitle);
  const company = normalizeJobField(job.company);
  if (!title || !company) {
    return null;
  }

  return `${title}\u0000${company}`;
}

function normalizeJobField(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function salaryMatches(salary: string, min: number | null, max: number | null): boolean {
  if (min === null && max === null) {
    return true;
  }

  const parsed = parseSalaryRange(salary);
  if (parsed.min === null && parsed.max === null) {
    return false;
  }

  const jobMin = parsed.min ?? parsed.max ?? 0;
  const jobMax = parsed.max ?? parsed.min ?? Number.POSITIVE_INFINITY;
  if (min !== null && jobMax < min) {
    return false;
  }
  if (max !== null && jobMin > max) {
    return false;
  }
  return true;
}

function parseSalaryRange(salary: string): { min: number | null; max: number | null } {
  const normalized = salary.replace(/\s/g, '').toUpperCase();
  const range = normalized.match(/(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)K/);
  if (range) {
    return { min: Number(range[1]), max: Number(range[2]) };
  }

  const above = normalized.match(/(\d+(?:\.\d+)?)K?(以上|\+)/);
  if (above) {
    return { min: Number(above[1]), max: null };
  }

  const single = normalized.match(/^(\d+(?:\.\d+)?)K$/);
  if (single) {
    const value = Number(single[1]);
    return { min: value, max: value };
  }

  return { min: null, max: null };
}

function renderMessageTemplate(template: string, job: JobInfo): TemplateRenderResult {
  const warnings: string[] = [];
  const values: Record<string, string> = {
    jobTitle: job.jobTitle,
    company: job.company,
    city: job.city,
    salary: job.salary,
  };

  const message = template.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return values[key] ?? '';
    }
    warnings.push(`模板变量 ${key} 缺失`);
    return '';
  });

  return { message, warnings };
}

function selectMessageTemplate(templates: string[], appliedCount: number): string {
  const usable = templates.map((template) => template.trim()).filter(Boolean);
  if (usable.length === 0) {
    return '您好，我对贵公司的 {jobTitle} 岗位很感兴趣，希望有机会进一步沟通。';
  }
  return usable[appliedCount % usable.length];
}

function isDailyLimitReached(todayAppliedCount: number, dailyLimit: number): boolean {
  return todayAppliedCount >= dailyLimit;
}

function makeDebugInfo(input: {
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

function formatErrorMessage(error: unknown): string {
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

function textFrom(selector: string): string | null {
  const element = document.querySelector(selector);
  return element?.textContent?.trim() || null;
}

function inferFromText(pattern: RegExp): string | null {
  return document.body.innerText.match(pattern)?.[0] ?? null;
}

function isSearchResultStillLoading(): boolean {
  const bodyText = document.body.innerText.trim();
  return (
    bodyText.length === 0 ||
    /加载中|请稍候|正在加载|loading/i.test(bodyText) ||
    document.querySelectorAll('button, a, .btn, [role="button"]').length === 0
  );
}

function findMessageInput(): HTMLElement | null {
  return findChatMessageInput();
}

function collectPageDiagnostics(): string[] {
  const chatInput = findChatMessageInput();
  const sendButton = chatInput ? findChatSendButton(chatInput, document, { allowDisabled: true }) : null;
  const contactButton = findContactButton();
  return [
    `url=${location.href}`,
    `title=${document.title}`,
    `readyState=${document.readyState}`,
    `.job-title=${document.querySelectorAll('.job-title').length}`,
    `.name=${document.querySelectorAll('.name').length}`,
    `[class*="company"]=${document.querySelectorAll('[class*="company"]').length}`,
    `textarea=${document.querySelectorAll('textarea').length}`,
    `input[type="text"]=${document.querySelectorAll('input[type="text"]').length}`,
    `input[type="search"]=${document.querySelectorAll('input[type="search"]').length}`,
    `[contenteditable="true"]=${document.querySelectorAll('[contenteditable="true"]').length}`,
    `[role="textbox"]=${document.querySelectorAll('[role="textbox"]').length}`,
    `button=${document.querySelectorAll('button, a, .btn, [role="button"]').length}`,
    `contactButton=${describeElement(contactButton)}`,
    `chatInput=${describeElement(chatInput)}`,
    `chatSendButton=${describeElement(sendButton)} disabled=${sendButton ? isDisabledAction(sendButton) : 'n/a'}`,
    `bodyTextPrefix=${document.body.innerText.slice(0, 160).replace(/\s+/g, ' ')}`,
  ];
}
