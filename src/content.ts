import type {
  AutoApplyConfig,
  ContentMessage,
  ContentResult,
  DebugInfo,
  JobInfo,
  MatchResult,
  TemplateRenderResult,
} from './shared/types';

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

  const jobSelection = readBestJob(message.config);
  if (!jobSelection) {
    const chatInput = await waitForElement(findMessageInput, 8000);
    if (chatInput) {
      const fallbackJob = makeFallbackChatJob();
      const template = selectMessageTemplate(message.config.messageTemplates, message.todayAppliedCount);
      const rendered = renderMessageTemplate(template, fallbackJob);
      const action = await fillAndSendMessage(rendered.message);
      if (!action.ok) {
        return {
          ok: false,
          status: action.status,
          reason: action.reason,
          debugInfo: makeDebugInfo({
            phase: 'fill-chat-without-job-metadata',
            tabUrl: location.href,
            details: collectPageDiagnostics(),
          }),
        };
      }
      return { ok: true, job: fallbackJob, status: 'applied', warnings: rendered.warnings };
    }

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

function readBestJob(config: AutoApplyConfig): { job: JobInfo; sourceElement?: HTMLElement } | null {
  const listJobs = readJobList();
  const matched = listJobs.find(({ job }) => jobMatchesConfig(job, config).matched);
  if (matched) {
    return matched;
  }

  if (listJobs.length > 0) {
    return listJobs[0];
  }

  const currentJob = readCurrentJob();
  return currentJob ? { job: currentJob } : null;
}

function readJobList(): Array<{ job: JobInfo; sourceElement: HTMLElement }> {
  const titleElements = Array.from(document.querySelectorAll<HTMLElement>('.job-title, [class*="job-title"]'));
  return titleElements
    .map((titleElement) => {
      const card =
        closestJobCard(titleElement) ??
        titleElement.closest<HTMLElement>('li, [class*="job"], [class*="card"], [class*="item"]') ??
        titleElement;
      const jobTitle = titleElement.textContent?.trim() ?? '';
      const company =
        textFromWithin(card, '.company-name') ||
        textFromWithin(card, '[class*="company"]') ||
        textFromWithin(card, '.name') ||
        textFrom('[class*="company"]') ||
        '';
      const city =
        textFromWithin(card, '[class*="city"]') ||
        inferFromElementText(card, /(北京|上海|广州|深圳|杭州|成都|武汉|南京|苏州|西安|重庆|天津)/) ||
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
  if (!findMessageInput() && sourceElement) {
    sourceElement.scrollIntoView({ block: 'center', inline: 'nearest' });
    sourceElement.click();
    await waitForPageHydration();
  }

  const contactButton = findButton(['立即沟通', '继续沟通', '沟通']);
  if (contactButton) {
    contactButton.click();
    await waitForElement(findMessageInput, 10000);
  }

  const input = await waitForElement(findMessageInput, 10000);
  if (!input) {
    return { ok: false, status: 'failed', reason: '未找到沟通输入框或投递入口' };
  }

  input.focus();
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    input.value = message;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    input.textContent = message;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: message }));
  }

  const sendButton = findButton(['发送', '投递', '立即发送']);
  if (!sendButton || sendButton.hasAttribute('disabled')) {
    return { ok: false, status: 'failed', reason: '发送按钮不可用' };
  }

  sendButton.click();
  return { ok: true };
}

function closestJobCard(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element;
  for (let depth = 0; current && depth < 6; depth += 1) {
    const text = current.innerText;
    if (/\d+(?:\.\d+)?-\d+(?:\.\d+)?K/.test(text) && /公司|经验|学历|本科|大专|年/.test(text)) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
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
      document.readyState === 'complete' ||
      document.body.innerText.trim().length > 20 ||
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

function makeFallbackChatJob(): JobInfo {
  return {
    jobTitle: '',
    company: '',
    city: '',
    salary: '',
    url: location.href,
  };
}

function jobMatchesConfig(job: JobInfo, config: AutoApplyConfig): MatchResult {
  const keywords = config.keywords.map((keyword) => keyword.trim()).filter(Boolean);
  if (keywords.length > 0 && !keywords.some((keyword) => job.jobTitle.includes(keyword))) {
    return { matched: false, reason: '岗位关键词不匹配' };
  }

  if (config.city.trim() && !job.city.includes(config.city.trim())) {
    return { matched: false, reason: '城市不匹配' };
  }

  if (!salaryMatches(job.salary, config.salaryMin, config.salaryMax)) {
    return { matched: false, reason: '薪资范围不匹配' };
  }

  return { matched: true };
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

function findButton(labels: string[]): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, a, .btn, [role="button"]'));
  return candidates.find((item) => labels.some((label) => item.innerText.includes(label))) ?? null;
}

function findMessageInput(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('textarea') ||
    document.querySelector<HTMLElement>('input[type="text"]') ||
    document.querySelector<HTMLElement>('[contenteditable="true"]')
  );
}

function collectPageDiagnostics(): string[] {
  return [
    `url=${location.href}`,
    `title=${document.title}`,
    `readyState=${document.readyState}`,
    `.job-title=${document.querySelectorAll('.job-title').length}`,
    `.name=${document.querySelectorAll('.name').length}`,
    `[class*="company"]=${document.querySelectorAll('[class*="company"]').length}`,
    `textarea=${document.querySelectorAll('textarea').length}`,
    `[contenteditable="true"]=${document.querySelectorAll('[contenteditable="true"]').length}`,
    `button=${document.querySelectorAll('button, a, .btn, [role="button"]').length}`,
    `bodyTextPrefix=${document.body.innerText.slice(0, 160).replace(/\s+/g, ' ')}`,
  ];
}
