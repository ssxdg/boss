import { describe, expect, it } from 'vitest';
import { formatErrorMessage, makeDebugInfo } from './diagnostics';

describe('formatErrorMessage', () => {
  it('keeps browser runtime error messages visible', () => {
    const error = new Error('Could not establish connection. Receiving end does not exist.');
    expect(formatErrorMessage(error)).toBe('Could not establish connection. Receiving end does not exist.');
  });

  it('serializes unknown thrown values for diagnostics', () => {
    expect(formatErrorMessage({ code: 'NO_RECEIVER', tabId: 3 })).toBe('{"code":"NO_RECEIVER","tabId":3}');
  });
});

describe('makeDebugInfo', () => {
  it('records phase, url, message and timestamp', () => {
    const info = makeDebugInfo({
      phase: 'send-message',
      tabUrl: 'https://www.zhipin.com/web/geek/job',
      error: new Error('Receiving end does not exist.'),
    });

    expect(info.phase).toBe('send-message');
    expect(info.tabUrl).toBe('https://www.zhipin.com/web/geek/job');
    expect(info.message).toBe('Receiving end does not exist.');
    expect(info.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
