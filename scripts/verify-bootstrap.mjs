#!/usr/bin/env node
/**
 * 启动接线自检（不需要 dsh CLI / LLM Key）
 *
 * 目的：在真实凭据下验证 `bootstrapGateway` 的整条接线是否自洽 ——
 * 客户端构造、发送器、会话管理器、中间件链装配、工具注册、WS 订阅、
 * property.info 自检、快捷指令同步、生命周期清理。
 *
 * 用假 ctx（cordis 三层接口 get/on/effect）替代宿主，因为这些接口在
 * 本插件里只被用作"取可选服务"和"注册生命周期"，没有真正的 DI 语义。
 *
 *   npm run build && node scripts/verify-bootstrap.mjs
 *   npm run verify -- --profile web     # 凭据从 profile 的 cordis.patch.yml 取
 *
 * 凭据优先级：环境变量 / .env → --profile <name> → 自动扫 ~/.dsh/profiles/*。
 * 只从配置里取值，绝不回显（输出的是来源，不是密钥）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] === undefined) process.env[key] = raw.replace(/^['"]|['"]$/g, '');
  }
}
loadDotEnv(resolve(ROOT, '.env'));

/**
 * 凭据来源，优先级：环境变量 / .env → --profile <name> → 已安装的 profile。
 *
 * 自检要连真实的推推服务，没有 AppID/AppSecret 就无从验证；以前只认环境变量，
 * 于是「本地装了插件、能跑起来」的人反而要手工再 export 一遍。
 * 这里直接读 profile 的 cordis.patch.yml（只取值、不回显），并把来源打出来。
 */
function readProfileCredentials(patchFile) {
  if (!existsSync(patchFile)) return null;
  const text = readFileSync(patchFile, 'utf8');
  if (!text.includes('im-tuitui')) return null;
  const pick = (key) => {
    const match = text.match(new RegExp('^\\s*' + key + '\\s*:\\s*(.+)$', 'm'));
    if (!match) return null;
    const value = match[1].trim().replace(/^['"]|['"]$/g, '');
    return value === '' ? null : value;
  };
  const id = pick('appId');
  const secret = pick('appSecret');
  return id && secret ? { appId: id, appSecret: secret } : null;
}

function resolveCredentials() {
  const envId = process.env.TUITUI_BOT_APPID?.trim();
  const envSecret = process.env.TUITUI_BOT_SECRET?.trim();
  if (envId && envSecret) return { appId: envId, appSecret: envSecret, source: '环境变量/.env' };

  const flagIndex = process.argv.indexOf('--profile');
  if (flagIndex >= 0 && process.argv[flagIndex + 1] !== undefined) {
    const name = process.argv[flagIndex + 1];
    const file = resolve(process.env.HOME ?? '', '.dsh', 'profiles', name, 'cordis.patch.yml');
    const found = readProfileCredentials(file);
    if (found) return { ...found, source: 'profile ' + name };
    console.error('profile ' + name + ' 里没有可用的 im-tuitui 凭据：' + file);
    process.exit(2);
  }

  // 没指名 profile 就扫一遍 ~/.dsh/profiles/*（按名字排序，取第一个配置完整的）
  const profilesDir = resolve(process.env.HOME ?? '', '.dsh', 'profiles');
  if (existsSync(profilesDir)) {
    for (const name of readdirSync(profilesDir).sort()) {
      const found = readProfileCredentials(resolve(profilesDir, name, 'cordis.patch.yml'));
      if (found) return { ...found, source: 'profile ' + name };
    }
  }
  console.error('缺少 TUITUI_BOT_APPID / TUITUI_BOT_SECRET');
  console.error('可以 export 这两个变量，或用 --profile <name> 指定已安装的 profile');
  process.exit(2);
}

const credentials = resolveCredentials();
const appId = credentials.appId;
const appSecret = credentials.appSecret;
console.log('凭据来源：' + credentials.source);

const { ConfigSchema } = await import(resolve(ROOT, 'lib/config.js'));
const { bootstrapGateway } = await import(resolve(ROOT, 'lib/gateway/bootstrap.js'));

/** 假 cordis ctx：只实现本插件实际用到的三个接口 */
let disposal;
const ctx = {
  get: () => undefined,
  on: () => undefined,
  effect: (fn) => {
    disposal = fn();
  },
};

const logger = {
  info: (msg) => console.log('INFO ', msg),
  warn: (msg) => console.warn('WARN ', msg),
  error: (msg) => console.error('ERROR', msg),
  debug: () => {},
};

const config = ConfigSchema({ appId, appSecret, debug: false, streaming: true, agentSteps: { enabled: true } });

console.log('=== bootstrap wiring check ===');
try {
  await bootstrapGateway(ctx, /** @type {any} */ ({}), config, logger);
  console.log('INFO  bootstrapGateway returned (lifecycle registered: %s)', typeof disposal === 'function');
} catch (error) {
  console.error('ERROR bootstrapGateway threw:', error?.stack ?? error);
  process.exit(1);
}

await new Promise((resolveWait) => setTimeout(resolveWait, 8000));

if (typeof disposal === 'function') {
  console.log('INFO  disposing...');
  await disposal();
  console.log('INFO  disposed cleanly');
}
process.exit(0);
