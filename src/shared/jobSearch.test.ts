import { describe, expect, it } from 'vitest';
import {
  buildBossJobSearchUrl,
  hasBossSalaryFilter,
  isBossChatPage,
  isBossJobSearchPage,
  shouldRedirectWaitingChatToSearch,
  shouldStartJobSearch,
} from './jobSearch';
import { DEFAULT_CONFIG } from './domain';

describe('buildBossJobSearchUrl', () => {
  it('builds a Boss job search URL from configured keywords and city', () => {
    const url = buildBossJobSearchUrl({
      ...DEFAULT_CONFIG,
      keywords: ['前端', 'React'],
      city: '上海',
      salaryMin: 10,
      salaryMax: 15,
    });

    expect(url).toBe('https://www.zhipin.com/web/geek/jobs?query=%E5%89%8D%E7%AB%AF+React&city=101020100&salary=405');
  });

  it('keeps non-standard salary ranges for local filtering instead of guessing a Boss bucket', () => {
    const url = buildBossJobSearchUrl({
      ...DEFAULT_CONFIG,
      keywords: ['前端开发'],
      city: '北京',
      salaryMin: 11,
      salaryMax: 17,
    });

    expect(url).toBe('https://www.zhipin.com/web/geek/jobs?query=%E5%89%8D%E7%AB%AF%E5%BC%80%E5%8F%91&city=101010100');
  });

  it('returns null when no search keyword is configured', () => {
    expect(buildBossJobSearchUrl({ ...DEFAULT_CONFIG, keywords: [] })).toBeNull();
  });
});

describe('job search page detection', () => {
  it('detects Boss search result pages', () => {
    expect(isBossJobSearchPage('https://www.zhipin.com/web/geek/job?query=React')).toBe(true);
    expect(isBossJobSearchPage('https://www.zhipin.com/')).toBe(false);
  });

  it('detects Boss chat pages separately from search result pages', () => {
    expect(isBossChatPage('https://www.zhipin.com/web/geek/chat')).toBe(true);
    expect(isBossJobSearchPage('https://www.zhipin.com/web/geek/chat')).toBe(false);
  });

  it('only starts search from Boss pages before a job list is available', () => {
    expect(shouldStartJobSearch('https://www.zhipin.com/', false)).toBe(true);
    expect(shouldStartJobSearch('https://www.zhipin.com/web/geek/job?query=React', false)).toBe(false);
    expect(shouldStartJobSearch('https://www.zhipin.com/web/geek/chat', false)).toBe(false);
    expect(shouldStartJobSearch('https://www.zhipin.com/', true)).toBe(false);
  });
});

describe('hasBossSalaryFilter', () => {
  it('detects when Boss search URL already carries a salary bucket', () => {
    expect(hasBossSalaryFilter('https://www.zhipin.com/web/geek/job?query=%E5%89%8D%E7%AB%AF&city=101010100&salary=405')).toBe(true);
  });

  it('returns false when salary is not filtered in the URL', () => {
    expect(hasBossSalaryFilter('https://www.zhipin.com/web/geek/job?query=%E5%89%8D%E7%AB%AF&city=101010100')).toBe(false);
  });
});

describe('shouldRedirectWaitingChatToSearch', () => {
  it('redirects the next scheduled run away from Boss chat before doing more work', () => {
    expect(shouldRedirectWaitingChatToSearch('waiting', 'https://www.zhipin.com/web/geek/chat')).toBe(true);
  });

  it('does not redirect a manual running pass away from chat', () => {
    expect(shouldRedirectWaitingChatToSearch('running', 'https://www.zhipin.com/web/geek/chat')).toBe(false);
  });
});
