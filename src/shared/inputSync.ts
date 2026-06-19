export function readInputText(input: HTMLElement): string {
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    return input.value;
  }
  return input.innerText || input.textContent || '';
}

export function waitForInputText(
  input: HTMLElement,
  expectedText: string,
  timeoutMs = 2000,
  intervalMs = 100,
): Promise<boolean> {
  const expected = normalizeInputText(expectedText);
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const tick = () => {
      if (normalizeInputText(readInputText(input)).includes(expected)) {
        resolve(true);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        resolve(false);
        return;
      }

      setTimeout(tick, intervalMs);
    };

    tick();
  });
}

function normalizeInputText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
