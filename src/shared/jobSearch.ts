import type { AutoApplyConfig } from './types';

const CITY_CODES: Record<string, string> = {
  北京: '101010100',
  上海: '101020100',
  广州: '101280100',
  深圳: '101280600',
  杭州: '101210100',
  成都: '101270100',
  武汉: '101200100',
  南京: '101190100',
  苏州: '101190400',
  西安: '101110100',
  重庆: '101040100',
  天津: '101030100',
};

const SALARY_CODES: Array<{ min: number | null; max: number | null; code: string }> = [
  { min: null, max: 3, code: '402' },
  { min: 3, max: 5, code: '403' },
  { min: 5, max: 10, code: '404' },
  { min: 10, max: 15, code: '405' },
  { min: 15, max: 20, code: '406' },
  { min: 20, max: 30, code: '407' },
  { min: 30, max: 50, code: '408' },
  { min: 50, max: null, code: '409' },
];

export function buildBossJobSearchUrl(config: AutoApplyConfig, origin = 'https://www.zhipin.com'): string | null {
  const query = parseKeywords(config.keywords.join(' ')).join(' ');
  if (!query) {
    return null;
  }

  const url = new URL('/web/geek/jobs', origin);
  url.searchParams.set('query', query);

  const cityCode = CITY_CODES[config.city.trim()];
  if (cityCode) {
    url.searchParams.set('city', cityCode);
  }

  const salaryCode = getBossSalaryCode(config.salaryMin, config.salaryMax);
  if (salaryCode) {
    url.searchParams.set('salary', salaryCode);
  }

  return url.toString();
}

export function isBossJobSearchPage(urlLike: string): boolean {
  const url = parseUrl(urlLike);
  return Boolean(url?.hostname.includes('zhipin.com') && url.pathname.includes('/web/geek/job'));
}

export function isBossChatPage(urlLike: string): boolean {
  const url = parseUrl(urlLike);
  return Boolean(url?.hostname.includes('zhipin.com') && url.pathname.includes('/web/geek/chat'));
}

export function hasBossSalaryFilter(urlLike: string): boolean {
  const url = parseUrl(urlLike);
  return Boolean(url?.searchParams.get('salary'));
}

export function shouldStartJobSearch(urlLike: string, hasJobList: boolean): boolean {
  const url = parseUrl(urlLike);
  if (!url?.hostname.includes('zhipin.com')) {
    return false;
  }

  return !hasJobList && !isBossJobSearchPage(urlLike) && !isBossChatPage(urlLike);
}

export function shouldRedirectWaitingChatToSearch(status: string, urlLike: string): boolean {
  return status === 'waiting' && isBossChatPage(urlLike);
}

function parseUrl(urlLike: string): URL | null {
  try {
    return new URL(urlLike);
  } catch {
    return null;
  }
}

function parseKeywords(value: string): string[] {
  return value
    .split(/[\s,，、;；]+/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

function getBossSalaryCode(min: number | null, max: number | null): string | null {
  return SALARY_CODES.find((item) => item.min === min && item.max === max)?.code ?? null;
}
