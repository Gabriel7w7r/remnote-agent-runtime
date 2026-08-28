import { Buffer } from 'node:buffer';
import { log } from 'node:console';
import { accessSync, createWriteStream, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { deflateRawSync } from 'node:zlib';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = join(rootDir, 'mcpb', 'remnote-local');
const outputPath = join(extensionDir, 'remnote-local.mcpb');
const stageDir = await mkdtemp(join(tmpdir(), 'remnote-local-mcpb-'));
const CRC_TABLE = createCrcTable();

try {
  await stageExtension();
  await createZip(stageDir, outputPath);
  log(`Built ${relative(rootDir, outputPath)}`);
} finally {
  await rm(stageDir, { recursive: true, force: true });
}

async function stageExtension() {
  await mkdir(stageDir, { recursive: true });

  for (const file of ['manifest.json', 'package.json', 'README.md']) {
    await cp(join(extensionDir, file), join(stageDir, file));
  }

  await cp(join(extensionDir, 'server'), join(stageDir, 'server'), { recursive: true });

  const packageJson = JSON.parse(await readFile(join(extensionDir, 'package.json'), 'utf8'));
  const dependencies = Object.keys(packageJson.dependencies ?? {});
  const copied = new Set();

  for (const dependency of dependencies) {
    await copyPackageClosure(dependency, copied, join(extensionDir, 'package.json'));
  }
}

async function copyPackageClosure(packageName, copied, parentPackageJsonPath) {
  if (copied.has(packageName)) {
    return;
  }

  const packageDir = resolvePackageDir(packageName, parentPackageJsonPath);
  const packageJsonPath = join(packageDir, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const destination = join(stageDir, 'node_modules', ...packageName.split('/'));

  copied.add(packageName);
  await mkdir(dirname(destination), { recursive: true });
  await cp(packageDir, destination, {
    recursive: true,
    dereference: true,
    filter: (source) => shouldIncludePackagePath(source),
  });

  const childDependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.optionalDependencies ?? {}),
  };

  for (const childName of Object.keys(childDependencies)) {
    try {
      await copyPackageClosure(childName, copied, packageJsonPath);
    } catch (error) {
      if (!packageJson.optionalDependencies?.[childName]) {
        throw error;
      }
    }
  }
}

function resolvePackageDir(packageName, parentPackageJsonPath) {
  const packageRequire = createRequire(parentPackageJsonPath);
  try {
    return dirname(packageRequire.resolve(`${packageName}/package.json`));
  } catch (packageJsonError) {
    try {
      let current = dirname(packageRequire.resolve(packageName));
      while (dirname(current) !== current) {
        const candidate = join(current, 'package.json');
        try {
          accessSync(candidate);
          if (JSON.parse(readFileSync(candidate, 'utf8')).name === packageName) {
            return current;
          }
        } catch {
          // Keep walking toward the filesystem root.
        }
        current = dirname(current);
      }
    } catch {
      // Fall through to the error with parent context below.
    }

    throw new Error(
      `Could not resolve package directory for ${packageName} from ${parentPackageJsonPath}`,
      { cause: packageJsonError }
    );
  }
}

function shouldIncludePackagePath(source) {
  const name = basename(source);
  return ![
    '.git',
    '.github',
    '.nyc_output',
    'coverage',
    'test',
    'tests',
    '__tests__',
    '.DS_Store',
  ].includes(name);
}

async function createZip(sourceDir, destinationPath) {
  const files = await listFiles(sourceDir);
  const output = createWriteStream(destinationPath);
  const centralDirectoryRecords = [];
  let offset = 0;

  for (const filePath of files) {
    const archivePath = relative(sourceDir, filePath).split(sep).join('/');
    const data = await readFile(filePath);
    const compressedData = deflateRawSync(data, { level: 9 });
    const nameBuffer = Buffer.from(archivePath);
    const crc = crc32(data);
    const localHeader = createLocalFileHeader(nameBuffer, data.length, compressedData.length, crc);

    output.write(localHeader);
    output.write(compressedData);

    centralDirectoryRecords.push(
      createCentralDirectoryHeader(nameBuffer, data.length, compressedData.length, crc, offset)
    );
    offset += localHeader.length + compressedData.length;
  }

  const centralDirectoryOffset = offset;
  let centralDirectorySize = 0;

  for (const record of centralDirectoryRecords) {
    output.write(record);
    centralDirectorySize += record.length;
    offset += record.length;
  }

  output.write(
    createEndOfCentralDirectoryRecord(
      centralDirectoryRecords.length,
      centralDirectorySize,
      centralDirectoryOffset
    )
  );
  output.end();
  await once(output, 'finish');
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }

  return files.sort();
}

function createLocalFileHeader(nameBuffer, size, compressedSize, crc) {
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
  header.writeUInt16LE(nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBuffer]);
}

function createCentralDirectoryHeader(nameBuffer, size, compressedSize, crc, localHeaderOffset) {
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
  header.writeUInt16LE(nameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(localHeaderOffset, 42);
  return Buffer.concat([header, nameBuffer]);
}

function createEndOfCentralDirectoryRecord(
  entryCount,
  centralDirectorySize,
  centralDirectoryOffset
) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(entryCount, 8);
  record.writeUInt16LE(entryCount, 10);
  record.writeUInt32LE(centralDirectorySize, 12);
  record.writeUInt32LE(centralDirectoryOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function createCrcTable() {
  return Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });
}
