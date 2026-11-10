#!/usr/bin/env node
// Push хийх commit бүрийн content/pages/ файлд ноорогийн/дотоод тэмдэглэл үлдсэн эсэхийг шалгана.
// .githooks/pre-push дуудна: build --check зөвхөн push-ийн сүүлийн commit дээр ажилладаг тул завсрын
// commit-д үлдсэн тэмдэглэл (repo нийтэд нээлттэй — түүхэнд мөнхөд үлдэнэ) зөвхөн энд баригдана.
// build-тэй ЯГ ижил шалгуур (tools/lib/content.mjs rawLeaks) + status 'draft'.
//
// Хэрэглээ: node tools/leak-scan.mjs <commit>...   — олдвол stderr-д хэвлээд 1-ээр гарна.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rawLeaks } from './lib/content.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
const DRAFT = /\bstatus['"]?\s*:\s*['"`]draft/;

let bad = 0;
for (const c of process.argv.slice(2)) {
  const files = git('ls-tree', '-r', '-z', '--name-only', c, '--', 'content/pages').split('\0').filter((f) => f.endsWith('.mjs'));
  for (const f of files) {
    const src = git('show', `${c}:${f}`);
    const hits = rawLeaks(src);
    if (DRAFT.test(src)) hits.push("status: 'draft'");
    if (hits.length) {
      bad++;
      console.error(`          ${c.slice(0, 7)} ${f}: «${hits.join('», «')}»`);
    }
  }
}
process.exit(bad ? 1 : 0);
