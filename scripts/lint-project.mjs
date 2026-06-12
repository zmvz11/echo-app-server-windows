import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const forbidden = [new RegExp('em'+'ail','i'), new RegExp('e-'+'mail','i'), new RegExp('mail'+' address','i'), new RegExp('The '+'League','i'), new RegExp('Download '+'Center','i')];
const roots = ['src', 'docs'];

function walk(dir) {
  for (const item of readdirSync(dir)) {
    const full = join(dir, item);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(ts|tsx|md|json|yml|yaml)$/.test(full)) {
      const text = readFileSync(full, 'utf8');
      for (const rx of forbidden) {
        if (rx.test(text)) {
          console.error(`Forbidden text ${rx} in ${full}`);
          process.exit(1);
        }
      }
    }
  }
}

for (const r of roots) walk(r);
console.log('Lint passed.');
