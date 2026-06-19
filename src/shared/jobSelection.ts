import { isExcludedJob } from './jobIdentity';
import type { JobInfo, MatchResult } from './types';

export interface JobCandidate<TSource = unknown> {
  job: JobInfo;
  sourceElement?: TSource;
}

export function selectNextJobCandidate<TSource>(input: {
  candidates: Array<JobCandidate<TSource>>;
  currentJob?: JobInfo | null;
  excludedJobKeys: readonly string[];
  matchesConfig: (job: JobInfo) => MatchResult;
}): JobCandidate<TSource> | null {
  const availableCandidates = input.candidates.filter((candidate) => {
    return !isExcludedJob(candidate.job, input.excludedJobKeys);
  });

  const matched = availableCandidates.find((candidate) => input.matchesConfig(candidate.job).matched);
  if (matched) {
    return matched;
  }

  if (availableCandidates.length > 0) {
    return availableCandidates[0];
  }

  if (input.candidates.length > 0) {
    return null;
  }

  if (input.currentJob && !isExcludedJob(input.currentJob, input.excludedJobKeys)) {
    return { job: input.currentJob };
  }

  return null;
}
