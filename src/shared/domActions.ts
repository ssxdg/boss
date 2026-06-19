const BUTTON_SELECTOR = [
  'button',
  'a',
  '.btn',
  '[class*="btn"]',
  '[class*="startchat"]',
  '[class*="contact"]',
  '[class*="communicat"]',
  '[role="button"]',
].join(',');
const CHAT_INPUT_SELECTOR = [
  'textarea',
  'input[type="text"]',
  'input[type="search"]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[role="textbox"]',
  '[class*="input"]',
  '[class*="editor"]',
  '[class*="textarea"]',
  '[class*="text-area"]',
].join(',');
const SEND_LABELS = ['发送', '立即发送'];
const UNSAFE_ACTION_LABELS = ['投递', '上传', '附件', '简历', '作品', '重新选择', '选择文件'];
const UPLOAD_DIALOG_LABELS = ['上传附件', '上传简历', '上传作品集', '附件状态', '未获取到上传文件', '上传失败'];
const CITY_PATTERN = /(北京|上海|广州|深圳|杭州|成都|武汉|南京|苏州|西安|重庆|天津)/;
const SALARY_PATTERN = /\d+(?:\.\d+)?-\d+(?:\.\d+)?K|\d+(?:\.\d+)?K以上/;

interface FindSendButtonOptions {
  allowDisabled?: boolean;
}

export function findContactButton(root: ParentNode = document): HTMLElement | null {
  return getActionCandidates(root).find((item) => {
    const text = getElementText(item);
    return isContactActionText(text) && !isUnsafeAction(item);
  }) ?? null;
}

export function findChatMessageInput(root: ParentNode = document): HTMLElement | null {
  const candidates = uniqueElements([
    ...Array.from(root.querySelectorAll<HTMLElement>(CHAT_INPUT_SELECTOR)).filter(isLikelyMessageInput),
    ...findTextHintEditorCandidates(root),
  ]);

  return candidates.find((candidate) => findChatSendButton(candidate, root, { allowDisabled: true })) ?? null;
}

export function findChatSendButton(
  input: HTMLElement,
  root: ParentNode = document,
  options: FindSendButtonOptions = {},
): HTMLElement | null {
  const candidates = getActionCandidates(root, { includeDisabled: Boolean(options.allowDisabled) }).filter(isSafeSendButton);
  const ancestors = getAncestors(input, 8).filter(isScopedAncestor);

  for (const ancestor of ancestors) {
    const scoped = candidates.find((candidate) => ancestor.contains(candidate));
    if (scoped) {
      return scoped;
    }
  }

  return null;
}

export function isDisabledAction(element: HTMLElement): boolean {
  const className = typeof element.className === 'string' ? element.className : '';
  return (
    element.hasAttribute('disabled') ||
    element.getAttribute('aria-disabled') === 'true' ||
    element.getAttribute('data-disabled') === 'true' ||
    /\b(?:disabled|disable|btn-disabled|is-disabled)\b/i.test(className)
  );
}

export function hasUploadAttachmentDialog(root: ParentNode = document): boolean {
  const text = root instanceof Document ? getElementText(root.body) : getElementText(root);
  return UPLOAD_DIALOG_LABELS.some((label) => text.includes(label));
}

export function clickElementSafely(element: HTMLElement): void {
  element.dispatchEvent(createMouseEvent(element, 'mouseover'));
  element.dispatchEvent(createMouseEvent(element, 'mousedown'));
  element.dispatchEvent(createMouseEvent(element, 'mouseup'));

  if (hasJavascriptHref(element)) {
    dispatchJavascriptHrefClick(element);
    return;
  }

  element.click();
}

export function describeElement(element: HTMLElement | null): string {
  if (!element) {
    return 'null';
  }

  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : '';
  const className = typeof element.className === 'string' && element.className.trim()
    ? `.${element.className.trim().split(/\s+/).join('.')}`
    : '';
  const text = getElementText(element).slice(0, 40);
  return `${tag}${id}${className}${text ? ` text="${text}"` : ''}`;
}

export function findJobCardContainer(titleElement: HTMLElement): HTMLElement {
  const ancestors = getAncestors(titleElement, 8);
  return (
    ancestors.find((item) => {
      const text = getElementText(item);
      return SALARY_PATTERN.test(text) && CITY_PATTERN.test(text);
    }) ??
    ancestors.find((item) => {
      const text = getElementText(item);
      return SALARY_PATTERN.test(text) && /公司|经验|学历|本科|大专|年/.test(text);
    }) ??
    titleElement.closest<HTMLElement>('li, [class*="card"], [class*="item"]') ??
    titleElement
  );
}

function getActionCandidates(root: ParentNode, options: { includeDisabled?: boolean } = {}): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(BUTTON_SELECTOR)).filter((item) => {
    return !isHiddenElement(item) && (options.includeDisabled || !isDisabledAction(item));
  });
}

function isSafeSendButton(element: HTMLElement): boolean {
  const text = getElementText(element);
  return SEND_LABELS.some((label) => text.includes(label)) && !isUnsafeAction(element);
}

function isContactActionText(text: string): boolean {
  return text === '沟通' || text.includes('立即沟通') || text.includes('继续沟通');
}

function isUnsafeAction(element: HTMLElement): boolean {
  const text = getElementText(element);
  return UNSAFE_ACTION_LABELS.some((label) => text.includes(label));
}

function isHiddenElement(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current) {
    const style = current.getAttribute('style') ?? '';
    if (
      current.hidden ||
      current.getAttribute('aria-hidden') === 'true' ||
      /display\s*:\s*none/i.test(style) ||
      /visibility\s*:\s*hidden/i.test(style) ||
      /opacity\s*:\s*0(?:[;\s]|$)/i.test(style)
    ) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function hasJavascriptHref(element: HTMLElement): boolean {
  return Boolean(getJavascriptHrefLink(element));
}

function getJavascriptHrefLink(element: HTMLElement): HTMLAnchorElement | null {
  const link = element.closest<HTMLAnchorElement>('a[href]');
  return link?.getAttribute('href')?.trim().toLowerCase().startsWith('javascript:') ? link : null;
}

function dispatchJavascriptHrefClick(element: HTMLElement): void {
  const link = getJavascriptHrefLink(element);
  const preventDefault = (event: Event) => {
    event.preventDefault();
  };

  link?.addEventListener('click', preventDefault, true);
  try {
    element.dispatchEvent(createMouseEvent(element, 'click'));
  } finally {
    link?.removeEventListener('click', preventDefault, true);
  }
}

function createMouseEvent(element: HTMLElement, type: string): MouseEvent {
  const elementWindow = element.ownerDocument.defaultView ?? window;
  return new elementWindow.MouseEvent(type, { bubbles: true, cancelable: true });
}

function isScopedAncestor(element: HTMLElement): boolean {
  return element !== document.body && element !== document.documentElement;
}

function isLikelyMessageInput(element: HTMLElement): boolean {
  if (element.matches(BUTTON_SELECTOR)) {
    return false;
  }
  if (element instanceof HTMLInputElement) {
    const placeholder = element.placeholder || element.getAttribute('aria-label') || '';
    return !/搜索|查找|地图/.test(placeholder);
  }
  if (element.querySelector(BUTTON_SELECTOR)) {
    return false;
  }

  const className = typeof element.className === 'string' ? element.className : '';
  const text = getElementText(element);
  return (
    element instanceof HTMLTextAreaElement ||
    element.isContentEditable ||
    element.getAttribute('role') === 'textbox' ||
    /(?:input|editor|textarea|text-area)/i.test(className) ||
    /按Enter键发送|Ctrl\+Enter|输入/.test(text)
  );
}

function findTextHintEditorCandidates(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('div, span, p'))
    .filter(isEnterHintElement)
    .flatMap((hint) => {
      const nearby = findNearbyEditorCandidate(hint);
      const parent = hint.parentElement && isLikelyMessageInput(hint.parentElement) ? hint.parentElement : null;
      return [nearby, parent].filter((item): item is HTMLElement => Boolean(item));
    });
}

function findNearbyEditorCandidate(hint: HTMLElement): HTMLElement | null {
  let sibling = hint.previousElementSibling as HTMLElement | null;
  for (let depth = 0; sibling && depth < 4; depth += 1) {
    if (isPossibleBlankEditor(sibling)) {
      return sibling;
    }
    sibling = sibling.previousElementSibling as HTMLElement | null;
  }
  return null;
}

function isPossibleBlankEditor(element: HTMLElement): boolean {
  const className = typeof element.className === 'string' ? element.className : '';
  const text = getElementText(element);
  return (
    !isHiddenElement(element) &&
    !element.matches(BUTTON_SELECTOR) &&
    !element.querySelector(BUTTON_SELECTOR) &&
    !isEnterHintText(text) &&
    !/(?:toolbar|action|btn|button|operate|op-)/i.test(className)
  );
}

function isEnterHintElement(element: HTMLElement): boolean {
  return isEnterHintText(getElementText(element));
}

function isEnterHintText(text: string): boolean {
  return /按Enter键发送|Ctrl\+Enter|输入/.test(text);
}

function uniqueElements(elements: HTMLElement[]): HTMLElement[] {
  return Array.from(new Set(elements));
}

function getAncestors(element: HTMLElement, maxDepth: number): HTMLElement[] {
  const ancestors: HTMLElement[] = [];
  let current: HTMLElement | null = element;

  for (let depth = 0; current && depth <= maxDepth; depth += 1) {
    ancestors.push(current);
    current = current.parentElement;
  }

  return ancestors;
}

function getElementText(node: ParentNode): string {
  if (node instanceof HTMLElement) {
    return (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
  }
  return (node.textContent || '').replace(/\s+/g, ' ').trim();
}
