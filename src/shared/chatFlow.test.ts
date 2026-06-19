import { describe, expect, it } from 'vitest';
import { decideChatPageAction } from './chatFlow';

describe('decideChatPageAction', () => {
  it('continues sending when a chat page has an unprocessed current job', () => {
    expect(decideChatPageAction({ allowChatPageSend: true, hasCurrentJob: true, isCurrentJobExcluded: false })).toBe('send_current_job');
  });

  it('returns to search when the current chat job was already processed', () => {
    expect(decideChatPageAction({ allowChatPageSend: true, hasCurrentJob: true, isCurrentJobExcluded: true })).toBe('return_to_search');
  });

  it('waits when chat job metadata has not rendered yet', () => {
    expect(decideChatPageAction({ allowChatPageSend: true, hasCurrentJob: false, isCurrentJobExcluded: false })).toBe('wait_for_current_job');
  });

  it('returns to search instead of sending on a chat page during a scheduled continuation', () => {
    expect(decideChatPageAction({ allowChatPageSend: false, hasCurrentJob: true, isCurrentJobExcluded: false })).toBe('return_to_search');
  });
});
