/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clickElementSafely,
  findChatMessageInput,
  findChatSendButton,
  findContactButton,
  findJobCardContainer,
  hasUploadAttachmentDialog,
  isDisabledAction,
} from './domActions';

describe('clickElementSafely', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('dispatches page click handlers without invoking native click on javascript links', () => {
    document.body.innerHTML = '<a id="contact" href="javascript:void(0)">绔嬪嵆娌熼€?/a>';
    const nativeClick = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    const link = document.querySelector<HTMLElement>('#contact')!;
    let handled = false;
    link.addEventListener('click', (event) => {
      handled = true;
      event.preventDefault();
    });

    clickElementSafely(link);

    expect(handled).toBe(true);
    expect(nativeClick).not.toHaveBeenCalled();
  });

  it('prevents javascript link default navigation while preserving page click handlers', () => {
    document.body.innerHTML = '<a id="contact" href="javascript:window.__bossTest = 1">Contact</a>';
    const link = document.querySelector<HTMLElement>('#contact')!;
    let handled = false;
    let defaultPrevented = false;
    link.addEventListener('click', (event) => {
      handled = true;
      defaultPrevented = event.defaultPrevented;
    });

    clickElementSafely(link);

    expect(handled).toBe(true);
    expect(defaultPrevented).toBe(true);
  });
});

describe('findChatSendButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('chooses the send button near the chat input instead of a page delivery button', () => {
    document.body.innerHTML = `
      <main>
        <section class="job-actions">
          <button id="delivery">投递</button>
          <button id="upload">上传附件</button>
        </section>
        <section class="chat-panel">
          <textarea id="chat-input"></textarea>
          <button id="send">发送</button>
        </section>
      </main>
    `;

    const input = document.querySelector<HTMLElement>('#chat-input')!;

    expect(findChatSendButton(input)?.id).toBe('send');
  });

  it('does not treat delivery text as a chat send action', () => {
    document.body.innerHTML = `
      <section class="chat-panel">
        <textarea id="chat-input"></textarea>
        <button id="delivery">投递</button>
      </section>
    `;

    const input = document.querySelector<HTMLElement>('#chat-input')!;

    expect(findChatSendButton(input)).toBeNull();
  });

  it('finds the disabled send button near the chat editor when requested', () => {
    document.body.innerHTML = `
      <section class="chat-panel">
        <div id="editor" class="input-area" role="textbox"></div>
        <button id="send" class="btn disabled">发送</button>
      </section>
    `;

    const input = document.querySelector<HTMLElement>('#editor')!;

    expect(findChatSendButton(input)).toBeNull();
    expect(findChatSendButton(input, document, { allowDisabled: true })?.id).toBe('send');
  });
});

describe('findChatMessageInput', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('ignores the contact search box and chooses the editor near the send button', () => {
    document.body.innerHTML = `
      <aside>
        <input id="contact-search" type="text" placeholder="搜索30天内的联系人" />
      </aside>
      <section class="chat-panel">
        <div id="editor" class="input-area" role="textbox">按Enter键发送</div>
        <button id="send" class="btn disabled">发送</button>
      </section>
    `;

    expect(findChatMessageInput()?.id).toBe('editor');
  });

  it('does not use the whole page body as the send-button scope for unrelated inputs', () => {
    document.body.innerHTML = `
      <aside>
        <input id="other-input" type="text" />
      </aside>
      <section class="chat-panel">
        <button id="send" class="btn">发送</button>
      </section>
    `;

    expect(findChatMessageInput()).toBeNull();
  });

  it('returns the editor container when the Enter hint is rendered in a child node', () => {
    document.body.innerHTML = `
      <section class="chat-panel">
        <div id="editor" class="input-area">
          <span>按Enter键发送</span>
        </div>
        <button id="send" class="btn disabled">发送</button>
      </section>
    `;

    expect(findChatMessageInput()?.id).toBe('editor');
  });

  it('chooses the blank editor sibling instead of the Enter-key hint text', () => {
    document.body.innerHTML = `
      <section class="chat-panel">
        <div class="toolbar">
          <button type="button">发简历</button>
        </div>
        <div id="editor"></div>
        <span id="hint">按Enter键发送，按Ctrl+Enter键换行</span>
        <button id="send" class="btn disabled">发送</button>
      </section>
    `;

    expect(findChatMessageInput()?.id).toBe('editor');
  });
});

describe('isDisabledAction', () => {
  it('detects class-based disabled buttons used by Boss chat', () => {
    document.body.innerHTML = '<button id="send" class="btn disabled">发送</button>';

    expect(isDisabledAction(document.querySelector<HTMLElement>('#send')!)).toBe(true);
  });
});

describe('hasUploadAttachmentDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('detects the Boss attachment upload modal', () => {
    document.body.innerHTML = `
      <div role="dialog">
        <h2>上传附件</h2>
        <p>附件状态</p>
        <button>重新选择</button>
      </div>
    `;

    expect(hasUploadAttachmentDialog()).toBe(true);
  });
});

describe('findContactButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('does not choose a communication history navigation item as the contact action', () => {
    document.body.innerHTML = `
      <a id="history" role="button">沟通记录</a>
      <button id="contact">立即沟通</button>
    `;

    expect(findContactButton()?.id).toBe('contact');
  });

  it('finds Boss start-chat elements even when they are not native buttons', () => {
    document.body.innerHTML = `
      <div id="contact" class="op-btn btn-startchat">立即沟通</div>
    `;

    expect(findContactButton()?.id).toBe('contact');
  });

  it('skips hidden contact templates and chooses the visible entry', () => {
    document.body.innerHTML = `
      <button id="hidden-contact" style="display: none">立即沟通</button>
      <button id="visible-contact">立即沟通</button>
    `;

    expect(findContactButton()?.id).toBe('visible-contact');
  });
});

describe('findJobCardContainer', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('uses the ancestor containing city and salary instead of the title node itself', () => {
    document.body.innerHTML = `
      <div id="card" class="recommend-card">
        <div class="title-wrap">
          <span id="title" class="job-title-text">前端开发</span>
        </div>
        <span>北京·昌平区·北七家</span>
        <span>20-30K</span>
      </div>
    `;

    const title = document.querySelector<HTMLElement>('#title')!;

    expect(findJobCardContainer(title)?.id).toBe('card');
  });
});
