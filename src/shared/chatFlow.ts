export type ChatPageAction = 'send_current_job' | 'return_to_search' | 'wait_for_current_job';

export function decideChatPageAction(input: {
  allowChatPageSend: boolean;
  hasCurrentJob: boolean;
  isCurrentJobExcluded: boolean;
}): ChatPageAction {
  if (!input.allowChatPageSend) {
    return 'return_to_search';
  }

  if (!input.hasCurrentJob) {
    return 'wait_for_current_job';
  }

  return input.isCurrentJobExcluded ? 'return_to_search' : 'send_current_job';
}
