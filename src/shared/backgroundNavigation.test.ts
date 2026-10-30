import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './domain';
import { buildBackgroundJobSearchUrl, isBossSecurityCheckPage, shouldAllowChatPageSend, shouldRedirectWaitingChatToSearch } from './backgroundNavigation';

describe('background navigation', () => {
  it('recognizes the Boss security redirect before injecting a content script', () => {
    expect(isBossSecurityCheckPage('https://www.zhipin.com/web/geek/jobs?_security_check=1_123')).toBe(true);
    expect(isBossSecurityCheckPage('https://www.zhipin.com/web/geek/jobs?query=React')).toBe(false);
  });
  it('redirects the next scheduled run away from Boss chat before doing more work', () => {
    expect(shouldRedirectWaitingChatToSearch('waiting', 'https://www.zhipin.com/web/geek/chat')).toBe(true);
  });

  it('starts a manual run from a job search instead of sending to the currently open chat', () => {
    expect(shouldRedirectWaitingChatToSearch('running', 'https://www.zhipin.com/web/geek/chat')).toBe(true);
    expect(shouldRedirectWaitingChatToSearch('idle', 'https://www.zhipin.com/web/geek/chat')).toBe(true);
  });

  it('blocks chat-page sending only until a scheduled run has left the old chat page', () => {
    expect(shouldAllowChatPageSend('waiting', false)).toBe(false);
    expect(shouldAllowChatPageSend('waiting', true)).toBe(true);
    expect(shouldAllowChatPageSend('running', false)).toBe(true);
  });

  it('builds the same search URL shape used by the content script', () => {
    expect(
      buildBackgroundJobSearchUrl({
        ...DEFAULT_CONFIG,
        keywords: ['前端开发'],
        city: '北京',
        salaryMin: 10,
        salaryMax: 15,
      }),
    ).toBe('https://www.zhipin.com/web/geek/jobs?query=%E5%89%8D%E7%AB%AF%E5%BC%80%E5%8F%91&city=101010100&salary=405');
  });
});
