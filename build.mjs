import * as esbuild from 'esbuild';
import { mkdir, access, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function build() {
  const startTime = performance.now();
  await mkdir(distDir, { recursive: true });

  const jsEntry = path.join(__dirname, 'src', 'main.js');
  const cssEntry = path.join(__dirname, 'styles.css');
  const htmlEntry = path.join(__dirname, 'index.html');

  // 1. Standard unminified dist bundle for index.html
  const jsResult = await esbuild.build({
    entryPoints: [jsEntry],
    bundle: true,
    format: 'iife',
    globalName: 'TinyGladeApp',
    target: 'es2022',
    outfile: path.join(distDir, 'glade.js'),
    metafile: true,
    logLevel: 'info',
  });

  const hasCss = await exists(cssEntry);
  if (hasCss) {
    await esbuild.build({
      entryPoints: [cssEntry],
      bundle: true,
      target: 'es2022',
      outfile: path.join(distDir, 'glade.css'),
      logLevel: 'info',
    });
  }

  // 2. Self-contained minified single-file HTML (tiny-glade-aaa.html)
  const minJsResult = await esbuild.build({
    entryPoints: [jsEntry],
    bundle: true,
    minify: true,
    format: 'iife',
    globalName: 'TinyGladeApp',
    target: 'es2022',
    write: false,
    logLevel: 'warning',
  });
  const minifiedJs = minJsResult.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

  let minifiedCss = '';
  if (hasCss) {
    const minCssResult = await esbuild.build({
      entryPoints: [cssEntry],
      bundle: true,
      minify: true,
      target: 'es2022',
      write: false,
      logLevel: 'warning',
    });
    minifiedCss = minCssResult.outputFiles[0].text.replace(/<\/style/gi, '<\\/style');
  }

  const indexTemplate = await readFile(htmlEntry, 'utf8');
  const linkRegex = /<link\s+rel=["']stylesheet["']\s+href=["']\.\/dist\/glade\.css["']\s*\/?>/i;
  const scriptRegex = /<script\s+defer\s+src=["']\.\/dist\/glade\.js["']\s*><\/script>/i;

  if (!linkRegex.test(indexTemplate) || !scriptRegex.test(indexTemplate)) {
    throw new Error('index.html is missing expected ./dist/glade.css or ./dist/glade.js tags');
  }

  // Function replacers ensure $& / $$ / $' in minified JS/CSS are never mangled
  const standaloneHtml = indexTemplate
    .replace(linkRegex, () => `<style>${minifiedCss}</style>`)
    .replace(scriptRegex, () => `<script>${minifiedJs}</script>`);

  if (standaloneHtml.includes('./dist/glade.js') || standaloneHtml.includes('./dist/glade.css')) {
    throw new Error('Standalone HTML still contains external ./dist/ references');
  }

  const rootSingleHtml = path.join(__dirname, 'tiny-glade-aaa.html');
  const distSingleHtml = path.join(distDir, 'tiny-glade-aaa.html');
  await writeFile(rootSingleHtml, standaloneHtml, 'utf8');
  await writeFile(distSingleHtml, standaloneHtml, 'utf8');

  const singleStat = await stat(rootSingleHtml);
  const elapsedMs = (performance.now() - startTime).toFixed(0);
  const outBytes = Object.values(jsResult.metafile?.outputs ?? {}).reduce(
    (sum, item) => sum + (item.bytes || 0),
    0
  );
  console.log(
    `[tiny-glade] Built dist/glade.js (${(outBytes / 1024).toFixed(1)} KB), dist/glade.css, and single-file tiny-glade-aaa.html (${(singleStat.size / 1024).toFixed(1)} KB) in ${elapsedMs}ms`
  );
}

build().catch((err) => {
  console.error('[tiny-glade] Build failed:', err);
  process.exit(1);
});
