import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const theme = read('src/styles/rekonvia-theme.css');
const families = ['midnight-navy', 'electric-indigo', 'signal-mint', 'cloud-white', 'slate', 'mist'];
const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const declaration = (css, name) => {
  const match = css.match(new RegExp(`${name}\\s*:\\s*(#[a-f0-9]{6})\\b`, 'i'));
  assert.ok(match, `Missing exact hex declaration: ${name}`);
  return match[1].toLowerCase();
};
const primitives = families.flatMap((family) => shades.map((shade) => {
  const name = `${family}-${shade}`;
  return [name, declaration(theme, `--color-${name}`)];
})).sort(([a], [b]) => a.localeCompare(b));
assert.equal(primitives.length, 66);
assert.equal([...theme.matchAll(/--color-(?:midnight-navy|electric-indigo|signal-mint|cloud-white|slate|mist)-\d+\s*:\s*#/g)].length, 66, 'Duplicate or extra primitive declaration');
// A compact immutable fingerprint also protects fresh checkouts without private research files.
assert.equal(hash(JSON.stringify(primitives)), 'c477bbe821f5f9c37d07c2810320ccc2674a5e63e21aedc9b4fa4eb5d6c86679', 'Owner-supplied palette changed');

const brandDocPath = resolve(root, 'docs/rekonvia-brand-palette-v1.0.md');
if (existsSync(brandDocPath)) {
  const brandDoc = readFileSync(brandDocPath, 'utf8');
  for (const family of families) {
    const row = brandDoc.split('\n').find((line) => line.startsWith(`| \`${family}\` |`));
    assert.ok(row, `Missing brand specification row: ${family}`);
    const values = [...row.matchAll(/#[a-f0-9]{6}/gi)].map(([value]) => value.toLowerCase());
    assert.equal(values.length, shades.length, `Invalid shade count: ${family}`);
    shades.forEach((shade, index) => assert.equal(declaration(theme, `--color-${family}-${shade}`), values[index], `${family}-${shade}`));
  }
}
for (const [name, value] of Object.entries({
  'midnight-navy-950': '#121c31', 'electric-indigo-600': '#514be8',
  'signal-mint-400': '#33cbbe', 'cloud-white-50': '#f6f8fc',
  'slate-600': '#566479', 'mist-100': '#e0e6ef',
})) assert.equal(declaration(theme, `--color-${name}`), value, `Changed anchor: ${name}`);
const statuses = {
  'confirmed-fg': '#167b64', 'confirmed-bg': '#e6f6ef',
  'pending-fg': '#996019', 'pending-bg': '#fff4e2',
  'blocked-fg': '#b93b48', 'blocked-bg': '#fdedee',
  'review-fg': '#315fa3', 'review-bg': '#ebf2ff',
};
for (const [name, value] of Object.entries(statuses)) {
  assert.equal(declaration(theme, `--rk-status-${name}`), value, `Changed workflow status: ${name}`);
}
const logos = {
  'logomark-flat.svg': '91be4b4dd23e95416fc3b4e3e44b5ccd2dd8409280813c89e3f8cc1730ed70a5',
  'logomark-gradient.svg': '549a669a603f65ffbb300089d7d469a51e7d556b4ed212cd6eed3032832cf4ed',
  'logotype-dark-mode.svg': '0e1eb9cca3656b0ef582a6868f45c1f2de465f7dbdffb6b9a0a13ed590f1c29f',
  'logotype-light-mode.svg': '14ecd32da867e69cedaf71118c73be695fea8a0b23773e2af3be4476afcd7782',
};
for (const [file, expected] of Object.entries(logos)) {
  assert.equal(hash(readFileSync(resolve(root, 'public/assets/logos', file))), expected, `Changed original SVG: ${file}`);
}
assert.match(theme, /@theme\s+static\s*\{/);
assert.match(theme, /@theme\s+inline\s*\{/);
assert.match(theme, /--rk-gradient-brand:\s*linear-gradient\(135deg,\s*var\(--color-electric-indigo-600\)\s+0%,\s*var\(--color-electric-indigo-700\)\s+100%\)/);
const sourceFiles = readdirSync(resolve(root, 'src'), { recursive: true }).filter((file) => /\.(?:css|tsx?)$/.test(file));
const sourceCss = sourceFiles.filter((file) => file.endsWith('.css')).map((file) => read(`src/${file}`)).join('\n');
assert.equal([...sourceCss.matchAll(/@import\s+["']tailwindcss["']/g)].length, 1, 'Expected one Tailwind import');
const cssImports = sourceFiles.filter((file) => /\.tsx?$/.test(file)).flatMap((file) => [...read(`src/${file}`).matchAll(/import\s+["']([^"']+\.css)["']/g)].map(([, path]) => [file, path]));
assert.deepEqual(cssImports, [['main.tsx', './styles/rekonvia-theme.css']], 'Expected one root CSS import');
for (const file of ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs', 'postcss.config.js', 'postcss.config.cjs', 'postcss.config.mjs']) {
  assert.ok(!existsSync(resolve(root, file)), `Unexpected legacy/duplicate configuration: ${file}`);
}
for (const font of ['inter-latin', 'inter-latin-ext', 'plus-jakarta-sans-latin', 'plus-jakarta-sans-latin-ext']) {
  assert.equal(readFileSync(resolve(root, `public/assets/fonts/${font}.woff2`)).subarray(0, 4).toString(), 'wOF2', `Invalid WOFF2: ${font}`);
}

if (!process.argv.includes('--source-only')) {
  const builtCss = readdirSync(resolve(root, 'dist/assets')).filter((file) => file.endsWith('.css')).map((file) => read(`dist/assets/${file}`)).join('\n');
  for (const [name, value] of primitives) assert.equal(declaration(builtCss, `--color-${name}`), value, `Production shade missing: ${name}`);
  for (const [name, value] of Object.entries(statuses)) assert.equal(declaration(builtCss, `--rk-status-${name}`), value, `Production status missing: ${name}`);
  for (const [file, expected] of Object.entries(logos)) assert.equal(hash(readFileSync(resolve(root, 'dist/assets/logos', file))), expected, `Built SVG changed: ${file}`);
  console.log('Brand contract passed: 66 production shades, six anchors, eight status values, four original SVGs, self-hosted fonts and one CSS entrypoint.');
} else {
  console.log('Brand source contract passed. Production output was not checked.');
}
