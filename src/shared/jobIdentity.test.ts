import { describe, expect, it } from 'vitest';
import { getExcludedJobKeys, getJobKey, isExcludedJob } from './jobIdentity';

describe('job identity', () => {
  it('normalizes whitespace and case for stable duplicate detection', () => {
    expect(getJobKey({ jobTitle: ' React  前端开发 ', company: ' ACME ' })).toBe(
      getJobKey({ jobTitle: 'react 前端开发', company: 'acme' }),
    );
  });

  it('does not create keys for incomplete job metadata', () => {
    expect(getJobKey({ jobTitle: '前端开发', company: '' })).toBeNull();
  });

  it('builds a de-duplicated excluded-key list from historical logs', () => {
    const logs = [
      makeLog('前端开发', '甲公司'),
      makeLog('前端开发', '甲公司'),
      makeLog('后端开发', '乙公司'),
    ];

    expect(getExcludedJobKeys(logs)).toHaveLength(2);
    expect(isExcludedJob({ jobTitle: ' 前端开发 ', company: '甲公司' }, getExcludedJobKeys(logs))).toBe(true);
  });
});

function makeLog(jobTitle: string, company: string) {
  return {
    id: crypto.randomUUID(),
    jobTitle,
    company,
    city: '北京',
    salary: '10-15K',
    url: 'https://www.zhipin.com/web/geek/job?query=front',
    status: 'applied' as const,
    createdAt: new Date().toISOString(),
  };
}
