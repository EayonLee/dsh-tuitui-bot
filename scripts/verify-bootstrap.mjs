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
 */
import { existsSync, readFileSync } from 'node:fs';
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

const appId = process.env.TUITUI_BOT_APPID?.trim();
const appSecret = process.env.TUITUI_BOT_SECRET?.trim();
if (!appId || !appSecret) {
  console.error('缺少 TUITUI_BOT_APPID / TUITUI_BOT_SECRET');
  process.exit(2);
}

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
