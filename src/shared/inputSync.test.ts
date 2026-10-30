/* @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { readInputText, waitForInputClear, waitForInputText } from './inputSync';

describe('waitForInputClear', () => {
  it('waits for the sent draft to leave the chat input', async () => {
    const input = document.createElement('textarea');
    input.value = '您好，想了解岗位';
    setTimeout(() => { input.value = ''; }, 30);
    await expect(waitForInputClear(input, '您好，想了解岗位', 200, 10)).resolves.toBe(true);
  });

  it('does not report a send while the draft remains in the chat input', async () => {
    const input = document.createElement('textarea');
    input.value = '您好，想了解岗位';
    await expect(waitForInputClear(input, '您好，想了解岗位', 30, 10)).resolves.toBe(false);
  });
});

describe('waitForInputText', () => {
  it('waits for contenteditable text to settle after async page rendering', async () => {
    document.body.innerHTML = '<div id="chat-input" contenteditable="true"></div>';
    const input = document.querySelector<HTMLElement>('#chat-input')!;

    window.setTimeout(() => {
      input.textContent = 'hello boss';
    }, 20);

    await expect(waitForInputText(input, 'hello boss', 300, 10)).resolves.toBe(true);
  });

  it('normalizes whitespace while checking message text', async () => {
    document.body.innerHTML = '<div id="chat-input" contenteditable="true">hello&nbsp;boss</div>';
    const input = document.querySelector<HTMLElement>('#chat-input')!;

    await expect(waitForInputText(input, 'hello boss', 50, 10)).resolves.toBe(true);
  });
});

describe('readInputText', () => {
  it('reads native input values', () => {
    document.body.innerHTML = '<input id="chat-input" value="hello boss" />';
    const input = document.querySelector<HTMLElement>('#chat-input')!;

    expect(readInputText(input)).toBe('hello boss');
  });
});
