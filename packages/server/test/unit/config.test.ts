import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getConfig as loadServerConfig, parseConfigToml } from '../../src/config.js';

describe('Config', () => {
  const originalEnv = process.env;
  let tempDir: string;

  beforeEach(async () => {
    // Reset environment variables
    process.env = { ...originalEnv };
    delete process.env.REMNOTE_WS_PORT;
    delete process.env.REMNOTE_HTTP_PORT;
    delete process.env.REMNOTE_HTTP_HOST;
    delete process.env.REMNOTE_MEDIA_ROOTS;
    tempDir = await mkdtemp(join(tmpdir(), 'remnote-config-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    process.env = originalEnv;
  });

  function getConfig(
    cliOptions: Parameters<typeof loadServerConfig>[0],
    loadOptions: Parameters<typeof loadServerConfig>[1] = {}
  ): ReturnType<typeof loadServerConfig> {
    return loadServerConfig(cliOptions, { homeDir: tempDir, ...loadOptions });
  }

  describe('Port Configuration', () => {
    it('should use default ports when no CLI or env vars provided', () => {
      const config = getConfig({});
      expect(config.wsPort).toBe(3002);
      expect(config.httpPort).toBe(3001);
    });

    it('should use environment variables', () => {
      process.env.REMNOTE_WS_PORT = '4002';
      process.env.REMNOTE_HTTP_PORT = '4001';

      const config = getConfig({});
      expect(config.wsPort).toBe(4002);
      expect(config.httpPort).toBe(4001);
    });

    it('should prefer CLI options over environment variables', () => {
      process.env.REMNOTE_WS_PORT = '4002';
      process.env.REMNOTE_HTTP_PORT = '4001';

      const config = getConfig({ wsPort: 5002, httpPort: 5001 });
      expect(config.wsPort).toBe(5002);
      expect(config.httpPort).toBe(5001);
    });

    it('should throw error if ports are the same', () => {
      expect(() => getConfig({ wsPort: 3000, httpPort: 3000 })).toThrow(
        'WebSocket port and HTTP port cannot be the same'
      );
    });

    it('should throw error if WebSocket port is out of range', () => {
      expect(() => getConfig({ wsPort: 0 })).toThrow('Invalid WebSocket port');
      expect(() => getConfig({ wsPort: 65536 })).toThrow('Invalid WebSocket port');
    });

    it('should throw error if HTTP port is out of range', () => {
      expect(() => getConfig({ httpPort: 0 })).toThrow('Invalid HTTP port');
      expect(() => getConfig({ httpPort: 65536 })).toThrow('Invalid HTTP port');
    });
  });

  describe('Log Level Configuration', () => {
    it('should default to info log level', () => {
      const config = getConfig({});
      expect(config.logLevel).toBe('info');
    });

    it('should use CLI log level', () => {
      const config = getConfig({ logLevel: 'debug' });
      expect(config.logLevel).toBe('debug');
    });

    it('should override log level with verbose flag', () => {
      const config = getConfig({ logLevel: 'info', verbose: true });
      expect(config.logLevel).toBe('debug');
    });

    it('should set file log level to match console level when log file is provided', () => {
      const config = getConfig({ logLevel: 'warn', logFile: '/tmp/test.log' });
      expect(config.logLevelFile).toBe('warn');
    });

    it('should use explicit file log level', () => {
      const config = getConfig({
        logLevel: 'info',
        logLevelFile: 'debug',
        logFile: '/tmp/test.log',
      });
      expect(config.logLevelFile).toBe('debug');
    });

    it('should not set file log level when no log file is provided', () => {
      const config = getConfig({ logLevel: 'info' });
      expect(config.logLevelFile).toBeUndefined();
    });
  });

  describe('File Logging Configuration', () => {
    it('should include log file path when provided', () => {
      const config = getConfig({ logFile: '/tmp/test.log' });
      expect(config.logFile).toBe('/tmp/test.log');
    });

    it('should include request log path when provided', () => {
      const config = getConfig({ requestLog: '/tmp/req.jsonl' });
      expect(config.requestLog).toBe('/tmp/req.jsonl');
    });

    it('should include response log path when provided', () => {
      const config = getConfig({ responseLog: '/tmp/resp.jsonl' });
      expect(config.responseLog).toBe('/tmp/resp.jsonl');
    });

    it('should not include file paths when not provided', () => {
      const config = getConfig({});
      expect(config.logFile).toBeUndefined();
      expect(config.requestLog).toBeUndefined();
      expect(config.responseLog).toBeUndefined();
    });
  });

  describe('Media Root Configuration', () => {
    it('auto-discovers conservative macOS RemNote files roots', async () => {
      const filesRoot = join(tempDir, 'remnote', 'remnote-kb-123', 'files');
      await mkdir(filesRoot, { recursive: true });

      const config = getConfig({});

      expect(config.mediaRoots).toEqual([filesRoot]);
    });

    it('prefers explicit CLI roots over environment roots', () => {
      process.env.REMNOTE_MEDIA_ROOTS = `/env/a${process.platform === 'win32' ? ';' : ':'}/env/b`;

      const config = getConfig({ mediaRoots: ['/cli/root'] });

      expect(config.mediaRoots).toEqual(['/cli/root']);
    });

    it('loads path-delimited media roots from TOML', () => {
      const separator = process.platform === 'win32' ? ';' : ':';
      const parsed = parseConfigToml(`[server]\nmediaRoots = "/media/a${separator}/media/b"\n`);

      expect(parsed.server?.mediaRoots).toEqual(['/media/a', '/media/b']);
    });
  });

  describe('Pretty Logs Configuration', () => {
    it('should set prettyLogs based on TTY status', () => {
      const config = getConfig({});
      // This will depend on the test environment's TTY status
      expect(typeof config.prettyLogs).toBe('boolean');
    });
  });

  describe('Host Configuration', () => {
    it('should default to localhost for both servers', () => {
      const config = getConfig({});
      expect(config.wsHost).toBe('127.0.0.1');
      expect(config.httpHost).toBe('127.0.0.1');
    });

    it('should reject a non-loopback HTTP host from the environment', () => {
      process.env.REMNOTE_HTTP_HOST = '0.0.0.0';

      expect(() => getConfig({})).toThrow('must bind to loopback');
    });

    it('should reject a non-loopback CLI HTTP host even when the environment is unsafe', () => {
      process.env.REMNOTE_HTTP_HOST = '0.0.0.0';

      expect(() => getConfig({ httpHost: '192.168.1.1' })).toThrow('must bind to loopback');
    });

    it('should ALWAYS use localhost for WebSocket server regardless of environment variable', () => {
      // This is a security feature - WebSocket server must never be exposed
      process.env.REMNOTE_WS_HOST = '0.0.0.0';

      const config = getConfig({});
      expect(config.wsHost).toBe('127.0.0.1'); // Hardcoded, ignores env var
    });

    it('should reject 0.0.0.0 for the privileged HTTP server', () => {
      expect(() => getConfig({ httpHost: '0.0.0.0' })).toThrow('must bind to loopback');
    });
  });

  describe('Complete Configuration', () => {
    it('should merge all configuration options correctly', () => {
      process.env.REMNOTE_WS_PORT = '4002';

      const config = getConfig({
        httpPort: 4001,
        logLevel: 'debug',
        logFile: '/tmp/test.log',
        requestLog: '/tmp/req.jsonl',
        responseLog: '/tmp/resp.jsonl',
      });

      expect(config).toMatchObject({
        wsPort: 4002, // from env
        wsHost: '127.0.0.1', // always localhost
        httpPort: 4001, // from CLI
        httpHost: '127.0.0.1', // default
        logLevel: 'debug',
        logLevelFile: 'debug', // derived from logLevel + logFile
        logFile: '/tmp/test.log',
        requestLog: '/tmp/req.jsonl',
        responseLog: '/tmp/resp.jsonl',
      });
    });
  });

  describe('TOML Configuration File', () => {
    it('ignores the default config path when it does not exist', () => {
      const config = getConfig({}, { homeDir: tempDir });

      expect(config.wsPort).toBe(3002);
      expect(config.httpPort).toBe(3001);
      expect(config.logLevel).toBe('info');
    });

    it('fails when an explicit config path does not exist', () => {
      expect(() => getConfig({ config: join(tempDir, 'missing.toml') })).toThrow(
        'Config file not found'
      );
    });

    it('loads all supported server options from TOML', async () => {
      const configPath = join(tempDir, 'config.toml');
      await writeFile(
        configPath,
        [
          '[server]',
          'wsPort = 4102',
          'httpPort = 4101',
          'httpHost = "localhost"',
          'logLevel = "warn"',
          'logLevelFile = "debug"',
          'verbose = false',
          'logFile = "/tmp/remnote.log"',
          'requestLog = "/tmp/requests.jsonl"',
          'responseLog = "/tmp/responses.jsonl"',
          '',
        ].join('\n'),
        'utf8'
      );

      const config = getConfig({ config: configPath });

      expect(config).toMatchObject({
        wsPort: 4102,
        httpPort: 4101,
        httpHost: '127.0.0.1',
        logLevel: 'warn',
        logLevelFile: 'debug',
        logFile: '/tmp/remnote.log',
        requestLog: '/tmp/requests.jsonl',
        responseLog: '/tmp/responses.jsonl',
      });
    });

    it('uses TOML verbose as a default debug shorthand', () => {
      const parsed = parseConfigToml('[server]\nverbose = true\n');
      expect(parsed.server?.verbose).toBe(true);

      const config = getConfigFromToml('[server]\nverbose = true\n');
      expect(config.logLevel).toBe('debug');
    });

    it('applies precedence as CLI over environment over TOML', async () => {
      const configPath = join(tempDir, 'config.toml');
      await writeFile(
        configPath,
        '[server]\nwsPort = 3102\nhttpPort = 3101\nhttpHost = "localhost"\nlogLevel = "warn"\n',
        'utf8'
      );
      process.env.REMNOTE_WS_PORT = '4202';
      process.env.REMNOTE_HTTP_PORT = '4201';
      process.env.REMNOTE_HTTP_HOST = 'localhost';

      const config = getConfig({ config: configPath, httpPort: 5201, logLevel: 'debug' });

      expect(config.wsPort).toBe(4202);
      expect(config.httpPort).toBe(5201);
      expect(config.httpHost).toBe('127.0.0.1');
      expect(config.logLevel).toBe('debug');
    });

    it('lets CLI log level override TOML verbose', () => {
      const config = getConfigFromToml('[server]\nverbose = true\nlogLevel = "warn"\n', {
        logLevel: 'error',
      });

      expect(config.logLevel).toBe('error');
    });

    it('rejects unknown sections and keys', () => {
      expect(() => parseConfigToml('[unknown]\nlogLevel = "debug"\n')).toThrow(
        'Unknown config section'
      );
      expect(() => parseConfigToml('[server]\nnoisy = true\n')).toThrow(
        'Unknown server config key'
      );
      expect(() => parseConfigToml('[daemon]\nhttpPort = 3001\n')).toThrow(
        'Unknown daemon config key'
      );
    });

    it('rejects invalid value types', () => {
      expect(() => parseConfigToml('[server]\nhttpPort = "3001"\n')).toThrow('must be a number');
      expect(() => parseConfigToml('[server]\nverbose = "true"\n')).toThrow('must be a boolean');
      expect(() => parseConfigToml('[server]\nlogLevel = "trace"\n')).toThrow('Invalid log level');
    });
  });

  function getConfigFromToml(
    toml: string,
    cliOptions: Parameters<typeof getConfig>[0] = {}
  ): ReturnType<typeof getConfig> {
    const configPath = join(tempDir, 'inline.toml');
    writeFileSync(configPath, toml, 'utf8');
    return getConfig({ ...cliOptions, config: configPath });
  }
});
