import { describe, expect, it } from 'vitest';
import { getJobKey } from './jobIdentity';
import { selectNextJobCandidate } from './jobSelection';
import type { JobInfo } from './types';

describe('selectNextJobCandidate', () => {
  it('skips already processed jobs and chooses the next matching visible candidate', () => {
    const first = makeJob('前端开发', '甲公司');
    const second = makeJob('React前端开发', '乙公司');
    const third = makeJob('Java开发', '丙公司');

    const selected = selectNextJobCandidate({
      candidates: [{ job: first }, { job: second }, { job: third }],
      excludedJobKeys: [getJobKey(first)!],
      matchesConfig: (job) => ({ matched: job.jobTitle.includes('前端') }),
    });

    expect(selected?.job.company).toBe('乙公司');
  });

  it('does not fall back to the currently open detail job when visible candidates are exhausted', () => {
    const alreadyProcessed = makeJob('前端开发', '甲公司');

    const selected = selectNextJobCandidate({
      candidates: [{ job: alreadyProcessed }],
      currentJob: alreadyProcessed,
      excludedJobKeys: [getJobKey(alreadyProcessed)!],
      matchesConfig: () => ({ matched: true }),
    });

    expect(selected).toBeNull();
  });

  it('can still use current job details on non-list pages when it has not been processed', () => {
    const currentJob = makeJob('前端开发', '甲公司');

    const selected = selectNextJobCandidate({
      candidates: [],
      currentJob,
      excludedJobKeys: [],
      matchesConfig: () => ({ matched: true }),
    });

    expect(selected?.job).toEqual(currentJob);
  });
});

function makeJob(jobTitle: string, company: string): JobInfo {
  return {
    jobTitle,
    company,
    city: '北京',
    salary: '10-15K',
    url: 'https://www.zhipin.com/web/geek/job?query=front',
  };
}
