import type { AutoApplyConfig, JobInfo, MatchResult, TemplateRenderResult } from './types';

export const DEFAULT_CONFIG: AutoApplyConfig = {
  keywords: [],
  city: '',
  salaryMin: null,
  salaryMax: null,
  dailyLimit: 30,
  delayMinSec: 60,
  delayMaxSec: 180,
  messageTemplates: [
    '您好，我对贵公司的 {jobTitle} 岗位很感兴趣，希望有机会进一步沟通。',
    '您好，我关注到 {company} 的 {jobTitle} 岗位，想了解更多岗位信息，谢谢。',
  ],
  enabled: false,
};

export function parseKeywords(value: string): string[] {
  return value
    .split(/[\s,，、;；]+/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

export function parseSalaryRange(salary: string): { min: number | null; max: number | null } {
  const normalized = salary.replace(/\s/g, '').toUpperCase();
  const range = normalized.match(/(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)K/);
  if (range) {
    return { min: Number(range[1]), max: Number(range[2]) };
  }

  const above = normalized.match(/(\d+(?:\.\d+)?)K?(以上|\+)/);
  if (above) {
    return { min: Number(above[1]), max: null };
  }

  const single = normalized.match(/^(\d+(?:\.\d+)?)K$/);
  if (single) {
    const value = Number(single[1]);
    return { min: value, max: value };
  }

  return { min: null, max: null };
}

export function jobMatchesConfig(job: JobInfo, config: AutoApplyConfig): MatchResult {
  const keywords = parseKeywords(config.keywords.join(' '));
  if (keywords.length > 0 && !keywords.some((keyword) => job.jobTitle.includes(keyword))) {
    return { matched: false, reason: '岗位关键词不匹配' };
  }

  if (config.city.trim() && !job.city.includes(config.city.trim())) {
    return { matched: false, reason: '城市不匹配' };
  }

  if (!salaryMatches(job.salary, config.salaryMin, config.salaryMax)) {
    return { matched: false, reason: '薪资范围不匹配' };
  }

  return { matched: true };
}

export function salaryMatches(salary: string, min: number | null, max: number | null): boolean {
  if (min === null && max === null) {
    return true;
  }

  const parsed = parseSalaryRange(salary);
  if (parsed.min === null && parsed.max === null) {
    return false;
  }

  const jobMin = parsed.min ?? parsed.max ?? 0;
  const jobMax = parsed.max ?? parsed.min ?? Number.POSITIVE_INFINITY;
  if (min !== null && jobMax < min) {
    return false;
  }
  if (max !== null && jobMin > max) {
    return false;
  }
  return true;
}

export function renderMessageTemplate(template: string, job: JobInfo): TemplateRenderResult {
  const warnings: string[] = [];
  const values: Record<string, string> = {
    jobTitle: job.jobTitle,
    company: job.company,
    city: job.city,
    salary: job.salary,
  };

  const message = template.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return values[key] ?? '';
    }
    warnings.push(`模板变量 ${key} 缺失`);
    return '';
  });

  return { message, warnings };
}

export function selectMessageTemplate(templates: string[], appliedCount: number): string {
  const usable = templates.map((template) => template.trim()).filter(Boolean);
  if (usable.length === 0) {
    return DEFAULT_CONFIG.messageTemplates[0];
  }
  return usable[appliedCount % usable.length];
}

export function isDailyLimitReached(todayAppliedCount: number, dailyLimit: number): boolean {
  return todayAppliedCount >= dailyLimit;
}

export function getRandomDelaySec(min: number, max: number, random = Math.random): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.floor(low + random() * (high - low + 1));
}

export function isDelayInRange(delaySec: number, min: number, max: number): boolean {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return delaySec >= low && delaySec <= high;
}

export function canContinueAfterFailure(consecutiveFailures: number, threshold: number): boolean {
  return consecutiveFailures < threshold;
}

export function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
