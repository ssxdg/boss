import type { ApplyLog, JobInfo } from './types';

const JOB_KEY_SEPARATOR = '\u0000';

export function getJobKey(job: Pick<JobInfo, 'jobTitle' | 'company'>): string | null {
  const title = normalizeJobField(job.jobTitle);
  const company = normalizeJobField(job.company);
  if (!title || !company) {
    return null;
  }

  return `${title}${JOB_KEY_SEPARATOR}${company}`;
}

export function getExcludedJobKeys(logs: ApplyLog[]): string[] {
  const keys = logs
    .map((log) => getJobKey(log))
    .filter((key): key is string => Boolean(key));
  return Array.from(new Set(keys));
}

export function isExcludedJob(job: Pick<JobInfo, 'jobTitle' | 'company'>, excludedJobKeys: readonly string[]): boolean {
  const key = getJobKey(job);
  return Boolean(key && excludedJobKeys.includes(key));
}

function normalizeJobField(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}
