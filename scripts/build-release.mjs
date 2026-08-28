import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { deflateRawSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
const version = packageJson.version;
const releaseRoot = join(root, ".release");
const runtimeRoot = join(releaseRoot, "runtime");
const serverTarget = join(runtimeRoot, "server");
const bridgeTarget = join(runtimeRoot, "bridge");
const artifacts = join(root, "artifacts");
const runtimeArchive = join(artifacts, `remnote-agent-runtime-${version}.zip`);
const bridgeArchive = join(artifacts, `remnote-agent-bridge-${version}.zip`);
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

await rm(releaseRoot, { recursive: true, force: true });
await rm(artifacts, { recursive: true, force: true });
await mkdir(runtimeRoot, { recursive: true });
await mkdir(artifacts, { recursive: true });

const pnpmCli = process.env.npm_execpath;
if (!pnpmCli)
  throw new Error(
    "Run the release builder through pnpm so npm_execpath is available.",
  );
const deploy = spawnSync(
  process.execPath,
  [
    pnpmCli,
    "--filter",
    "@remnote-agent/server",
    "deploy",
    "--prod",
    "--config.inject-workspace-packages=true",
    "--config.node-linker=hoisted",
    serverTarget,
  ],
  { cwd: root, stdio: "inherit" },
);
if (deploy.status !== 0)
  throw new Error(`pnpm deploy failed with exit code ${deploy.status}`);

await Promise.all(
  [".modules.yaml", ".pnpm-workspace-state-v1.json"].map((name) =>
    rm(join(serverTarget, "node_modules", name), { force: true }),
  ),
);

smokeTestRuntimeTree(serverTarget, "Release-stage");

const bridgeRoot = join(root, "packages", "bridge");
await mkdir(join(bridgeTarget, "scripts"), { recursive: true });
for (const path of [
  "bin",
  "dist",
  "scripts/serve-dist.js",
  "package.json",
  "LICENSE",
]) {
  await cp(join(bridgeRoot, path), join(bridgeTarget, path), {
    recursive: true,
    dereference: true,
  });
}

await createZip(runtimeRoot, runtimeArchive);
await smokeTestRuntimeArchive(runtimeArchive);
await createZip(join(bridgeRoot, "dist"), bridgeArchive);

const manifest = {
  version,
  runtime: {
    file: relative(root, runtimeArchive),
    sha256: await sha256(runtimeArchive),
  },
  bridge: {
    file: relative(root, bridgeArchive),
    sha256: await sha256(bridgeArchive),
  },
};
await writeFile(
  join(artifacts, "release-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);

async function sha256(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function smokeTestRuntimeArchive(archivePath) {
  const smokeRoot = join(releaseRoot, "smoke-extract");
  await rm(smokeRoot, { recursive: true, force: true });
  await mkdir(smokeRoot, { recursive: true });
  try {
    const systemTar = join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "tar.exe",
    );
    const useSystemTar = process.platform === "win32" && existsSync(systemTar);
    const extractor = useSystemTar ? systemTar : "unzip";
    const extractArgs = useSystemTar
      ? ["-xf", archivePath, "-C", smokeRoot]
      : ["-q", archivePath, "-d", smokeRoot];
    const extraction = spawnSync(extractor, extractArgs, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (extraction.status !== 0) {
      throw new Error(
        `Release archive extraction failed: ${extraction.stderr || extraction.stdout}`,
      );
    }

    smokeTestRuntimeTree(join(smokeRoot, "server"), "Extracted release");
  } finally {
    await rm(smokeRoot, { recursive: true, force: true });
  }
}

function smokeTestRuntimeTree(serverRoot, label) {
  const smokeTest = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "await import('./dist/websocket-server.js'); process.stdout.write('ok')",
    ],
    {
      cwd: serverRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    },
  );
  if (smokeTest.status !== 0 || smokeTest.stdout !== "ok") {
    const detail =
      smokeTest.error?.message || smokeTest.stderr || smokeTest.stdout;
    throw new Error(`${label} server smoke test failed: ${detail}`);
  }
}

async function createZip(sourceDir, destinationPath) {
  const files = await listFiles(sourceDir);
  const output = createWriteStream(destinationPath);
  const records = [];
  let offset = 0;
  for (const filePath of files) {
    const name = Buffer.from(
      relative(sourceDir, filePath).split(sep).join("/"),
    );
    const data = await readFile(filePath);
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = localHeader(name, data.length, compressed.length, crc);
    output.write(local);
    output.write(compressed);
    records.push(
      centralHeader(name, data.length, compressed.length, crc, offset),
    );
    offset += local.length + compressed.length;
  }
  const centralOffset = offset;
  for (const record of records) {
    output.write(record);
    offset += record.length;
  }
  output.write(
    endRecord(records.length, offset - centralOffset, centralOffset),
  );
  output.end();
  await once(output, "finish");
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

function localHeader(name, size, compressedSize, crc) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressedSize, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, name]);
}

function centralHeader(name, size, compressedSize, crc, localOffset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(compressedSize, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(localOffset, 42);
  return Buffer.concat([header, name]);
}

function endRecord(count, centralSize, centralOffset) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(count, 8);
  record.writeUInt16LE(count, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}
