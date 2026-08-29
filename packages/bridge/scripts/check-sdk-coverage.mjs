import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sdkRoot = join(root, 'node_modules', '@remnote', 'plugin-sdk');
const namespaceRoot = join(sdkRoot, 'dist', 'name_spaces');
const snapshotPath = join(root, 'sdk-capabilities.json');
const packageJson = JSON.parse(await readFile(join(sdkRoot, 'package.json'), 'utf8'));
const update = process.argv.includes('--update');

const sourceFiles = await listFiles(join(root, 'src'));
const source = (
  await Promise.all(sourceFiles.filter((path) => /\.(ts|tsx)$/.test(path)).map((path) => readFile(path, 'utf8')))
).join('\n');

const files = (await readdir(namespaceRoot)).filter((name) => name.endsWith('.d.ts')).sort();
const namespaces = {};
for (const file of files) {
  const namespace = file.replace(/\.d\.ts$/, '');
  const declarations = await readFile(join(namespaceRoot, file), 'utf8');
  const methods = extractPublicMethods(declarations);
  if (methods.length === 0) continue;
  namespaces[namespace] = Object.fromEntries(
    methods.map((method) => [
      method,
      source.includes(`.${method}(`)
        ? { status: 'used', reason: 'Called by the current bridge implementation.' }
        : { status: 'not_exposed', reason: 'Not yet exposed by the curated agent API.' },
    ])
  );
}

const current = { sdkVersion: packageJson.version, namespaces };
if (update) {
  await writeFile(snapshotPath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  process.stdout.write(`Updated SDK capability lock for @remnote/plugin-sdk ${packageJson.version}.\n`);
  process.exit(0);
}

let expected;
try {
  expected = JSON.parse(await readFile(snapshotPath, 'utf8'));
} catch {
  fail('SDK capability lock is missing. Run check:sdk-coverage:update and review the result.');
}

if (JSON.stringify(expected) !== JSON.stringify(current)) {
  const changes = diffCoverage(expected, current);
  fail(
    `RemNote SDK coverage changed for @remnote/plugin-sdk ${packageJson.version}. ` +
      `Review and run check:sdk-coverage:update.\n${changes.join('\n')}`
  );
}

const entries = Object.values(namespaces).flatMap((methods) => Object.values(methods));
const used = entries.filter((entry) => entry.status === 'used').length;
process.stdout.write(
  `SDK capability lock verified: ${used}/${entries.length} public methods currently used; ` +
    `${entries.length - used} explicitly not exposed.\n`
);

function extractPublicMethods(sourceText) {
  const methods = new Set();
  for (const line of sourceText.split(/\r?\n/)) {
    if (/^\s*(private|protected)\b/.test(line)) continue;
    const property = line.match(/^\s{4}([A-Za-z][A-Za-z0-9]*):\s*(?:<[^;]+>\s*)?\(/);
    const declaration = line.match(/^\s{4}([A-Za-z][A-Za-z0-9]*)\([^)]*\):\s*Promise</);
    const name = property?.[1] ?? declaration?.[1];
    if (name && name !== 'constructor' && name !== 'call' && name !== '_call') methods.add(name);
  }
  return [...methods].sort();
}

function diffCoverage(before, after) {
  const beforeKeys = flattenKeys(before?.namespaces ?? {});
  const afterKeys = flattenKeys(after.namespaces);
  const added = [...afterKeys].filter((key) => !beforeKeys.has(key));
  const removed = [...beforeKeys].filter((key) => !afterKeys.has(key));
  const lines = [];
  if (before?.sdkVersion !== after.sdkVersion) lines.push(`SDK version: ${before?.sdkVersion ?? 'missing'} -> ${after.sdkVersion}`);
  if (added.length) lines.push(`Added methods: ${added.join(', ')}`);
  if (removed.length) lines.push(`Removed methods: ${removed.join(', ')}`);
  if (!lines.length) lines.push('Usage classification changed in bridge source.');
  return lines;
}

function flattenKeys(value) {
  return new Set(
    Object.entries(value).flatMap(([namespace, methods]) =>
      Object.keys(methods).map((method) => `${namespace}.${method}`)
    )
  );
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else files.push(path);
  }
  return files;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
