import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const OUT = resolve(process.cwd(), 'public/fonts');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const FAMILIES = [
  { query: 'IBM+Plex+Sans:wght@400..600', name: 'Plex Sans', file: 'plex-sans', weights: ['400 600'] },
  { query: 'IBM+Plex+Mono:wght@400;500', name: 'Plex Mono', file: 'plex-mono', weights: ['400', '500'] },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const faces = [];

  for (const family of FAMILIES) {
    const url = `https://fonts.googleapis.com/css2?family=${family.query}&display=swap`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    const css = await res.text();
    const blocks = css.split('@font-face').slice(1);

    for (const weight of family.weights) {
      const single = weight.includes(' ') ? null : weight;
      let src = null;
      for (const block of blocks) {
        const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1] ?? '';
        if (!range.includes('U+0000-00FF')) continue;
        const blockWeight = /font-weight:\s*([\d ]+);/.exec(block)?.[1] ?? '';
        if (single && blockWeight !== single) continue;
        if (!single && !blockWeight.includes('400')) continue;
        src = /src:\s*url\((https:[^)]+)\)/.exec(block)?.[1] ?? src;
      }
      if (!src) throw new Error(`no latin face for ${family.query} ${weight}`);
      const font = await fetch(src, { headers: { 'User-Agent': UA } });
      if (!font.ok) throw new Error(`${src} -> ${font.status}`);
      const bytes = Buffer.from(await font.arrayBuffer());
      const name = single ? `${family.file}-${single}.woff2` : `${family.file}.woff2`;
      await writeFile(resolve(OUT, name), bytes);
      faces.push(
        `@font-face{font-family:'${family.name}';font-style:normal;font-weight:${weight};font-display:swap;src:url('./fonts/${name}') format('woff2')}`,
      );
      console.log(`${name} ${(bytes.length / 1024).toFixed(1)}kB`);
    }
  }

  await writeFile(resolve(process.cwd(), 'public/fonts.css'), `${faces.join('\n')}\n`);
  console.log(`wrote ${faces.length} faces`);
}

main();
