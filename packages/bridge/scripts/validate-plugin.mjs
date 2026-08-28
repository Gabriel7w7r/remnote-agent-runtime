import { access, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { parseManifest } = require('@remnote/plugin-sdk/dist/lib');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(root, 'public', 'manifest.json'), 'utf8'));

const parsedManifest = parseManifest(manifest);
if (!parsedManifest.success) {
  const details = parsedManifest.errors
    .map(({ field, message }) => `${field}: ${message}`)
    .join('\n');
  throw new Error(`RemNote SDK manifest validation failed:\n${details}`);
}

const manifestVersion = [
  manifest.version?.major,
  manifest.version?.minor,
  manifest.version?.patch,
].join('.');
if (manifestVersion !== packageJson.version) {
  throw new Error(
    `Manifest version ${manifestVersion} does not match package version ${packageJson.version}`
  );
}
if (!manifest.id || !manifest.name || !manifest.description || !manifest.author) {
  throw new Error('Plugin manifest must define id, name, description, and author');
}

await Promise.all(['mcp-icon.svg'].map((asset) => access(join(root, 'public', asset))));
process.stdout.write(`Validated RemNote plugin ${manifest.name} ${manifestVersion}.\n`);
