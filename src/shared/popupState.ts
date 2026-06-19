export function shouldReplaceConfigFromSnapshot(input: { hasUnsavedChanges: boolean; force?: boolean }): boolean {
  return Boolean(input.force || !input.hasUnsavedChanges);
}
