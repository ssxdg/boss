import type { JobInfo } from './types';

const SALARY_PATTERN = /\d+(?:\.\d+)?-\d+(?:\.\d+)?K(?:·\d+薪)?|\d+(?:\.\d+)?K以上/;
const CITY_PATTERN = /(北京|上海|广州|深圳|杭州|成都|武汉|南京|苏州|西安|重庆|天津)/;
const RECRUITER_ROLE_PATTERN = /(招聘专员|招聘顾问|招聘经理|招聘主管|人事主管|人事经理|人事专员|HRBP|HR|猎头顾问|经理|主管|专员)$/i;
const STATUS_WORDS = new Set(['在线', '离线', '刚刚活跃', '今日活跃']);

export function parseChatHeaderJob(text: string, url: string): JobInfo | null {
  const lines = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const salaryLineIndex = lines.findIndex((line) => SALARY_PATTERN.test(line));
  if (salaryLineIndex < 0) {
    return null;
  }

  const jobLine = lines[salaryLineIndex];
  const salary = jobLine.match(SALARY_PATTERN)?.[0] ?? '';
  const city = jobLine.match(CITY_PATTERN)?.[0] ?? findNearbyCity(lines, salaryLineIndex);
  const titleParts = extractJobTitleParts(lines, salaryLineIndex, salary);
  const jobTitle = titleParts.jobTitle;
  if (!jobTitle) {
    return null;
  }

  return {
    jobTitle,
    company: extractCompany(titleParts.companySource),
    city,
    salary,
    url,
  };
}

function extractJobTitleParts(
  lines: string[],
  salaryLineIndex: number,
  salary: string,
): { jobTitle: string; companySource: string } {
  const line = lines[salaryLineIndex];
  const salaryIndex = line.indexOf(salary);
  if (salaryIndex > 0) {
    const beforeSalary = line.slice(0, salaryIndex).replace(/[|｜·\s]+$/g, '').trim();
    const split = splitCollapsedHeader(beforeSalary);
    return {
      jobTitle: split.jobTitle,
      companySource: split.companySource || lines[salaryLineIndex - 1] || '',
    };
  }

  const titleLineIndex = findPreviousJobTitleLine(lines, salaryLineIndex);
  return {
    jobTitle: titleLineIndex >= 0 ? lines[titleLineIndex] : '',
    companySource: titleLineIndex >= 0 ? lines[titleLineIndex - 1] || '' : '',
  };
}

function splitCollapsedHeader(beforeSalary: string): { jobTitle: string; companySource: string } {
  const parts = beforeSalary.split(/\s+/).filter(Boolean);
  const markerIndex = findLastHeaderMarkerIndex(parts);
  if (markerIndex >= 0 && markerIndex < parts.length - 1) {
    return {
      jobTitle: parts.slice(markerIndex + 1).join(' ').trim(),
      companySource: parts.slice(0, markerIndex + 1).join(' ').trim(),
    };
  }

  return { jobTitle: beforeSalary, companySource: '' };
}

function findLastHeaderMarkerIndex(parts: string[]): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (STATUS_WORDS.has(parts[index]) || RECRUITER_ROLE_PATTERN.test(parts[index])) {
      return index;
    }
  }
  return -1;
}

function findPreviousJobTitleLine(lines: string[], salaryLineIndex: number): number {
  for (let index = salaryLineIndex - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line || STATUS_WORDS.has(line) || RECRUITER_ROLE_PATTERN.test(line) || CITY_PATTERN.test(line)) {
      continue;
    }
    return index;
  }
  return -1;
}

function findNearbyCity(lines: string[], salaryLineIndex: number): string {
  for (let index = salaryLineIndex; index <= Math.min(lines.length - 1, salaryLineIndex + 2); index += 1) {
    const city = lines[index].match(CITY_PATTERN)?.[0];
    if (city) {
      return city;
    }
  }
  return '';
}

function extractCompany(line: string): string {
  const parts = line
    .replace(/[|｜]/g, ' ')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part && !STATUS_WORDS.has(part));

  if (parts.length <= 1) {
    return '';
  }

  const withoutRole = parts.slice(1);
  while (withoutRole.length > 0 && RECRUITER_ROLE_PATTERN.test(withoutRole.at(-1) ?? '')) {
    withoutRole.pop();
  }

  return withoutRole.join(' ').trim();
}
