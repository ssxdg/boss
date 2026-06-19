import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const contentJs = readFileSync(resolve('dist/content.js'), 'utf8');
const topLevelModuleSyntax = /^\s*(?:import(?:[\s{*"']|$)|export(?:[\s{*]|$))/m;

if (topLevelModuleSyntax.test(contentJs)) {
  throw new Error('dist/content.js must be a classic content script without top-level import/export statements.');
}
