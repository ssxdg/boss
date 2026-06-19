import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  canContinueAfterFailure,
  isDailyLimitReached,
  isDelayInRange,
  jobMatchesConfig,
  parseKeywords,
  parseSalaryRange,
  renderMessageTemplate,
  selectMessageTemplate,
} from './domain';
import type { AutoApplyConfig, JobInfo } from './types';

const baseConfig: AutoApplyConfig = {
  ...DEFAULT_CONFIG,
  keywords: ['前端', 'React'],
  city: '上海',
  salaryMin: 15,
  salaryMax: 30,
};

const baseJob: JobInfo = {
  jobTitle: 'React 前端工程师',
  company: '星河科技',
  city: '上海',
  salary: '20-30K',
  url: 'https://www.zhipin.com/job_detail/abc.html',
};

describe('jobMatchesConfig', () => {
  it('matches jobs by keyword, city and salary range', () => {
    expect(jobMatchesConfig(baseJob, baseConfig).matched).toBe(true);
  });

  it('skips jobs when no configured keyword appears in the title', () => {
    const result = jobMatchesConfig({ ...baseJob, jobTitle: 'Java 工程师' }, baseConfig);
    expect(result).toEqual({ matched: false, reason: '岗位关键词不匹配' });
  });

  it('skips jobs in a different city', () => {
    const result = jobMatchesConfig({ ...baseJob, city: '杭州' }, baseConfig);
    expect(result).toEqual({ matched: false, reason: '城市不匹配' });
  });

  it('skips jobs outside the configured salary range', () => {
    const result = jobMatchesConfig({ ...baseJob, salary: '35-45K' }, baseConfig);
    expect(result).toEqual({ matched: false, reason: '薪资范围不匹配' });
  });
});

describe('parseSalaryRange', () => {
  it('parses K salary ranges', () => {
    expect(parseSalaryRange('20-35K')).toEqual({ min: 20, max: 35 });
  });

  it('parses above salary ranges', () => {
    expect(parseSalaryRange('30K以上')).toEqual({ min: 30, max: null });
  });

  it('returns nulls for unknown salaries', () => {
    expect(parseSalaryRange('薪资面议')).toEqual({ min: null, max: null });
  });
});

describe('parseKeywords', () => {
  it('splits keywords by common Chinese and English separators', () => {
    expect(parseKeywords('前端, React，Vue、Node.js  TypeScript\nJavaScript')).toEqual([
      '前端',
      'React',
      'Vue',
      'Node.js',
      'TypeScript',
      'JavaScript',
    ]);
  });

  it('drops empty keyword fragments', () => {
    expect(parseKeywords('  前端 ,, ， React  ')).toEqual(['前端', 'React']);
  });
});

describe('renderMessageTemplate', () => {
  it('replaces known variables and records missing variable warnings', () => {
    const result = renderMessageTemplate('您好，我想了解 {jobTitle}，地点 {city}，未知 {unknown}', baseJob);
    expect(result.message).toBe('您好，我想了解 React 前端工程师，地点 上海，未知 ');
    expect(result.warnings).toEqual(['模板变量 unknown 缺失']);
  });
});

describe('selectMessageTemplate', () => {
  it('rotates templates by applied count', () => {
    const templates = ['模板 A', '模板 B', '模板 C'];
    expect(selectMessageTemplate(templates, 4)).toBe('模板 B');
  });
});

describe('rate limit helpers', () => {
  it('detects daily limit reached', () => {
    expect(isDailyLimitReached(30, 30)).toBe(true);
    expect(isDailyLimitReached(29, 30)).toBe(false);
  });

  it('validates random delay range', () => {
    expect(isDelayInRange(90, 60, 180)).toBe(true);
    expect(isDelayInRange(30, 60, 180)).toBe(false);
  });

  it('pauses after three consecutive failures', () => {
    expect(canContinueAfterFailure(2, 3)).toBe(true);
    expect(canContinueAfterFailure(3, 3)).toBe(false);
  });
});
