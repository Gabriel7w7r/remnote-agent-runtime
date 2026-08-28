import { chmod } from 'node:fs/promises';

const bins = ['dist/index.js', 'dist/remnote-cli/index.js', 'mcpb/remnote-local/server/index.js'];

await Promise.all(bins.map((bin) => chmod(bin, 0o755)));
