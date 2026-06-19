import { describe, expect, it } from 'vitest';
import { shouldReplaceConfigFromSnapshot } from './popupState';

describe('shouldReplaceConfigFromSnapshot', () => {
  it('does not replace local form config while there are unsaved edits', () => {
    expect(shouldReplaceConfigFromSnapshot({ hasUnsavedChanges: true })).toBe(false);
  });

  it('allows replacing config when the form has no unsaved edits', () => {
    expect(shouldReplaceConfigFromSnapshot({ hasUnsavedChanges: false })).toBe(true);
  });

  it('allows a forced replacement for explicit config import/save flows', () => {
    expect(shouldReplaceConfigFromSnapshot({ hasUnsavedChanges: true, force: true })).toBe(true);
  });
});
