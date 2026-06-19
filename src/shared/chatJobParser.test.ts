import { describe, expect, it } from 'vitest';
import { parseChatHeaderJob } from './chatJobParser';

describe('parseChatHeaderJob', () => {
  it('extracts current job metadata from Boss chat header text', () => {
    const text = [
      '高女士 纬致科技北京 招聘专员',
      'react前端开发工程师 13-20K 北京',
      '按Enter键发送，按Ctrl+Enter键换行',
    ].join('\n');

    expect(parseChatHeaderJob(text, 'https://www.zhipin.com/web/geek/chat')).toEqual({
      jobTitle: 'react前端开发工程师',
      company: '纬致科技北京',
      salary: '13-20K',
      city: '北京',
      url: 'https://www.zhipin.com/web/geek/chat',
    });
  });

  it('extracts job metadata when Boss renders title salary and city as separate nodes', () => {
    const text = [
      '刘女士 慧博云通 招聘经理 在线',
      'AI前端开发工程师',
      '14-20K',
      '北京',
      '按Enter键发送，按Ctrl+Enter键换行',
    ].join('\n');

    expect(parseChatHeaderJob(text, 'https://www.zhipin.com/web/geek/chat')).toEqual({
      jobTitle: 'AI前端开发工程师',
      company: '慧博云通',
      salary: '14-20K',
      city: '北京',
      url: 'https://www.zhipin.com/web/geek/chat',
    });
  });

  it('extracts job metadata when Boss collapses the chat header into one line', () => {
    const text = '刘女士 慧博云通 招聘经理 在线 AI前端开发工程师 14-20K 北京';

    expect(parseChatHeaderJob(text, 'https://www.zhipin.com/web/geek/chat')).toEqual({
      jobTitle: 'AI前端开发工程师',
      company: '慧博云通',
      salary: '14-20K',
      city: '北京',
      url: 'https://www.zhipin.com/web/geek/chat',
    });
  });

  it('returns null when no salary-bearing job line exists', () => {
    expect(parseChatHeaderJob('高女士 纬致科技北京 招聘专员', 'https://www.zhipin.com/web/geek/chat')).toBeNull();
  });
});
