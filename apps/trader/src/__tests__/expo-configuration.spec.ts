// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const traderRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireFromTrader = createRequire(path.join(traderRoot, 'package.json'));
const configSource = fs.readFileSync(path.join(traderRoot, 'app.config.js'), 'utf8');

function evaluateConfig(env: Record<string, string>, rootEnv: string | null, localEnv?: string) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trader-expo-env-'));
  const fixtureTrader = path.join(fixtureRoot, 'apps/trader');
  fs.mkdirSync(fixtureTrader, { recursive: true });
  if (rootEnv !== null) fs.writeFileSync(path.join(fixtureRoot, '.env'), rootEnv);
  if (localEnv !== undefined) fs.writeFileSync(path.join(fixtureTrader, '.env.production'), localEnv);
  const script = `
    const vm = require('node:vm');
    const { createRequire } = require('node:module');
    const requireFromTrader = createRequire(${JSON.stringify(path.join(traderRoot, 'package.json'))});
    const moduleObject = { exports: undefined };
    vm.runInNewContext(${JSON.stringify(configSource)}, {
      __dirname: ${JSON.stringify(fixtureTrader)}, module: moduleObject, process, require: requireFromTrader,
    });
    const config = { name: 'Preserved App', web: { bundler: 'metro' }, plugins: ['expo-router'] };
    const result = moduleObject.exports({ config });
    const requireFromExpo = createRequire(requireFromTrader.resolve('expo/package.json'));
    requireFromExpo('@expo/env').load(${JSON.stringify(fixtureTrader)}, { silent: true });
    process.stdout.write(JSON.stringify({
      apiUrl: process.env.EXPO_PUBLIC_API_URL ?? null,
      label: process.env.EXPO_PUBLIC_LABEL ?? null,
      privateRootLoaded: process.env.OWNER_PASSWORD !== undefined || process.env.JWT_SECRET !== undefined,
      configPreserved: result === config,
    }) + '\\n');
  `;
  try {
    const result = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8', env: { PATH: process.env.PATH, ...env },
    });
    if (result.status !== 0) throw new Error(result.stderr || String(result.error));
    return JSON.parse(result.stdout.trim().split('\n').at(-1)!);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

afterEach(() => vi.unstubAllEnvs());

describe('Expo public environment configuration', () => {
  it('loads public root settings and preserves the app configuration without loading private settings', () => {
    const result = evaluateConfig({ NODE_ENV: 'development' }, [
      'EXPO_PUBLIC_API_URL=https://api.example.com',
      'EXPO_PUBLIC_LABEL=Trading',
      'OWNER_PASSWORD=isolated-private-password',
      'JWT_SECRET=isolated-private-secret',
    ].join('\n'));

    expect(result).toEqual({ apiUrl: 'https://api.example.com', label: 'Trading', privateRootLoaded: false, configPreserved: true });
  });

  it('loads app-local settings before the root fallback when NODE_ENV is already set', () => {
    const result = evaluateConfig({ NODE_ENV: 'production' }, 'EXPO_PUBLIC_API_URL=https://root.example.com',
      'EXPO_PUBLIC_API_URL=https://local.example.com/api/v1');
    expect(result.apiUrl).toBe('https://local.example.com/api/v1');
  });

  it('preserves shell settings over app-local and root dotenv files', () => {
    const result = evaluateConfig({ NODE_ENV: 'production', EXPO_PUBLIC_API_URL: 'https://override.example.com/api/v1' },
      'EXPO_PUBLIC_API_URL=https://root.example.com', 'EXPO_PUBLIC_API_URL=https://local.example.com/api/v1');
    expect(result.apiUrl).toBe('https://override.example.com/api/v1');
  });

  it('waits for Expo dotenv initialization during the first export config pass', () => {
    const result = evaluateConfig({}, 'EXPO_PUBLIC_API_URL=https://root.example.com');
    expect(result.apiUrl).toBeNull();
    expect(result.configPreserved).toBe(true);
  });

  it('works when no root environment file exists', () => {
    const result = evaluateConfig({ NODE_ENV: 'production' }, null);
    expect(result.apiUrl).toBeNull();
    expect(result.configPreserved).toBe(true);
  });

  it.each(['1', 'true'])('respects Expo dotenv opt-out %s', (flag) => {
    const result = evaluateConfig({ NODE_ENV: 'production', EXPO_NO_DOTENV: flag }, 'EXPO_PUBLIC_API_URL=https://root.example.com');
    expect(result.apiUrl).toBeNull();
  });

  it.each(['0', 'false'])('loads the root fallback when dotenv opt-out is %s', (flag) => {
    const result = evaluateConfig({ NODE_ENV: 'production', EXPO_NO_DOTENV: flag }, 'EXPO_PUBLIC_API_URL=https://root.example.com');
    expect(result.apiUrl).toBe('https://root.example.com');
  });

  it('inlines the API environment setting with the installed Expo Babel plugin', () => {
    vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://build.example.com/api/v1');
    const babel = requireFromTrader('@babel/core');
    const requireFromExpo = createRequire(requireFromTrader.resolve('expo/package.json'));
    const presetRoot = path.dirname(requireFromExpo.resolve('babel-preset-expo/package.json'));
    const { expoInlineEnvVars } = requireFromExpo(path.join(presetRoot, 'build/inline-env-vars.js'));
    const source = fs.readFileSync(path.join(traderRoot, 'src/services/api.ts'), 'utf8');
    const transformed = babel.transformSync(source, {
      filename: 'api.ts', configFile: false, babelrc: false, plugins: [expoInlineEnvVars],
    }).code;

    expect(transformed).toContain('resolveApiBaseUrl("https://build.example.com/api/v1")');
    expect(transformed).not.toContain('process.env');
  });
});
