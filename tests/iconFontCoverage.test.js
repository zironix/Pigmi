import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function collectVueFiles(directory, files = []) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectVueFiles(entryPath, files);
    else if (entry.name.endsWith('.vue')) files.push(entryPath);
  });
  return files;
}

describe('bundled icon font', () => {
  it('defines every Line Awesome icon used by Vue templates', () => {
    const css = fs.readFileSync('src/assets/icon-font/line-awesome.css', 'utf8');
    const defined = new Set(
      [...css.matchAll(/\.(la-[a-z0-9-]+)::before/g)].map((match) => match[1]),
    );
    const used = new Set(
      collectVueFiles('src')
        .flatMap((file) => [...fs.readFileSync(file, 'utf8').matchAll(/\bla-[a-z0-9-]+\b/g)])
        .map((match) => match[0]),
    );

    expect([...used].filter((icon) => !defined.has(icon))).toEqual([]);
  });
});
