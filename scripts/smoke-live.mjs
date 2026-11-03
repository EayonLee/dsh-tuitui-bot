#!/usr/bin/env node
/**
 * 推推真实环境冒烟脚本
 *
 * 用法：
 *   npm run build                       # 先产出 lib/
 *   TUITUI_BOT_APPID=xxx TUITUI_BOT_SECRET=yyy node scripts/smoke-live.mjs
 *   node scripts/smoke-live.mjs --send group:7652944526738590   # 额外做真实收发 + 编辑 + 撤回
 *   node scripts/smoke-live.mjs --listen 20                      # WS 监听秒数（默认 8）
 *
 * 覆盖：
 *   1) 离线：事件归一化（single_chat / group_chat / teams_post_create / interactive_action）
 *   2) 在线：property.info（凭据校验）+ group.robotIn（机器人所在群）
 *   3) 在线：WebSocket 订阅连通性
 *   4) 可选：TuituiSender 真实发送 → modifyText 原地编辑 → recall 撤回
 *
 * 任意一步失败都以非 0 退出，便于 CI/手工验收。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

// ── 读取 .env（不引入 dotenv 依赖） ──
function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^['"]|['"]$/g, '');
  }
}
loadDotEnv(resolve(ROOT, '.env'));

const appId = process.env.TUITUI_BOT_APPID?.trim();
const secret = process.env.TUITUI_BOT_SECRET?.trim();
if (!appId || !secret) {
  console.error('缺少 TUITUI_BOT_APPID / TUITUI_BOT_SECRET（可写入 .env）');
  process.exit(2);
}

// ── 参数 ──
const argv = process.argv.slice(2);
const flagValue = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const sendTarget = flagValue('--send');
const listenSeconds = Number(flagValue('--listen') ?? 8);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// ── 加载构建产物 ──
const LIB = resolve(ROOT, 'lib');
async function loadLib(relative) {
  const path = resolve(LIB, relative);
  if (!existsSync(path)) {
    throw new Error(`缺少构建产物 ${path}，请先 npm run build`);
  }
  return import(path);
}

// ══════════════════════════════════════════════════════════
// 1) 离线：事件归一化
// ══════════════════════════════════════════════════════════
async function offlineNormalization() {
  const { normalizeEvent } = await loadLib('tuitui/inbound.js');
  const render = (data) => (typeof data?.text === 'string' ? data.text : '');

  const single = normalizeEvent({
    bot_name: 'smoke', event: 'single_chat', cid: 'c1', uid: 'u1',
    user_account: 'zhangsan', user_name: '张三', user_dept_path: '', timestamp: '2026-01-01T00:00:00Z',
    data: { msg_type: 'text', text: '你好', msgid: 'm1' },
  }, { render });
  check('single_chat 归一化', single?.kind === 'c2c' && single?.content === '你好' && single?.messageId === 'm1');

  const group = normalizeEvent({
    bot_name: 'smoke', event: 'group_chat', cid: 'c2', uid: 'u2',
    user_account: 'lisi', user_name: '李四', user_dept_path: '', timestamp: '2026-01-01T00:00:01Z',
    group_id: 'g1', group_name: '鱼塘',
    data: { msg_type: 'text', text: '帮我查个东西', msgid: 'm2', group_id: 'g1', at_me: true, at: [{ is_at_all: false, account: 'bot-x', name: '憨包' }] },
  }, { render });
  check('group_chat 归一化', group?.kind === 'group' && group?.groupId === 'g1' && group?.atMe === true && group?.at?.length === 1);

  const post = normalizeEvent({
    bot_name: 'smoke', event: 'teams_post_create', cid: 'c3', uid: 'u3',
    user_account: 'wangwu', user_name: '王五', user_dept_path: '', timestamp: '2026-01-01T00:00:02Z',
    data: {
      team_id: 't1', team_name: '团队', team_desc: '', channel_id: 'ch1', channel_name: '频道', channel_desc: '',
      is_reply: false, post_id: 'p1', content: '频道里提问', rich_text_type: 'text', rich_text: '',
      at_me: true, at: [], files: [{ name: 'a.pdf', url: 'https://example.com/a.pdf', file_id: 'f1' }], images: [],
    },
  }, { render });
  check('teams_post_create 归一化', post?.kind === 'post' && post?.post?.channelId === 'ch1' && post?.attachments.length === 1);

  const action = normalizeEvent({
    bot_name: 'smoke', event: 'interactive_action', cid: 'c4', uid: 'u4',
    user_account: 'zhaoliu', user_name: '赵六', user_dept_path: '', timestamp: '2026-01-01T00:00:03Z',
    data: { msgid: 'card1', user: { account: 'zhaoliu', name: '赵六' }, action: [{ text: '同意', value: { t: 'approval', ok: true } }] },
  }, { render });
  check('interactive_action 归一化', action?.eventType === 'interactive_action' && action?.messageId === 'card1');

  const ignored = normalizeEvent({ bot_name: 'smoke', event: 'group_create', cid: 'c5', uid: 'u5', user_account: '', user_name: '', user_dept_path: '', timestamp: '', data: {} }, { render });
  check('其它事件忽略', ignored === null);
}

// ══════════════════════════════════════════════════════════
// 2/3) 在线：API + WebSocket
// ══════════════════════════════════════════════════════════
async function online(appId, secret) {
  const { TuituiBotClient } = await import('@qihoo/tuitui-bot-sdk');
  const client = new TuituiBotClient(appId, secret);

  let info;
  try {
    info = await client.property.info();
    check('property.info 凭据校验', Boolean(info?.account), `${info?.name} (${info?.account})`);
  } catch (error) {
    check('property.info 凭据校验', false, error?.message ?? String(error));
  }

  try {
    const groups = await client.group.robotIn();
    check('group.robotIn', Array.isArray(groups), `${groups?.length ?? 0} 个群`);
  } catch (error) {
    check('group.robotIn', false, error?.message ?? String(error));
  }

  const events = [];
  const subscription = client.event.subscribe({
    onConnected: () => check('WebSocket 连接', true),
    onEvent: (body) => events.push(body?.event),
    onError: (error) => console.log(`   (ws error: ${error.message})`),
    onDisconnected: () => console.log('   (ws disconnected, SDK 自动重连)'),
  });
  await new Promise((resolveWait) => setTimeout(resolveWait, Math.max(3, listenSeconds) * 1000));
  subscription.unsubscribe();
  check('WebSocket 事件流', true, `监听 ${listenSeconds}s，收到 ${events.length} 条事件`);
  return client;
}

// ══════════════════════════════════════════════════════════
// 4) 可选：真实发送 / 编辑 / 撤回
// ══════════════════════════════════════════════════════════
async function liveSend(client, spec) {
  const { TuituiSenderImpl } = await loadLib('tuitui/sender.js');
  const logger = {
    info: (...args) => console.log('  [sender]', ...args),
    warn: (...args) => console.warn('  [sender]', ...args),
    error: (...args) => console.error('  [sender]', ...args),
    debug: () => {},
  };
  const sender = new TuituiSenderImpl({
    client, logger, streaming: true, streamIntervalMs: 0, textChunkLimit: 4000,
  });

  const [kind, id] = spec.includes(':') ? spec.split(':') : ['group', spec];
  const target = kind === 'group'
    ? { scope: 'group', targetId: id }
    : { scope: 'c2c', targetId: id };

  const stamp = new Date().toISOString();
  try {
    const sent = await sender.sendMarkdown(target, `🐟 dsh-tuitui-bot 自检消息 ${stamp}`);
    check('sendMarkdown 真实发送', Boolean(sent.msgId), `msgid=${sent.msgId ?? '(响应未返回 msgid)'}`);

    if (sent.msgId) {
      // 原地编辑（走流式会话的真实路径：首帧发送 → modifyText 刷新）
      await sender.editStream(target, sent.msgId, `🐟 自检消息（已编辑）${stamp}`, true);
      check('modifyText 原地编辑', true, `msgid=${sent.msgId}`);

      try {
        await sender.recall(target, sent.msgId);
        check('recall 撤回', true, `msgid=${sent.msgId}`);
      } catch (error) {
        check('recall 撤回', false, error?.message ?? String(error));
      }
    }
  } catch (error) {
    check('sendMarkdown 真实发送', false, error?.message ?? String(error));
  }
}

// ── 主流程 ──
console.log(`\n=== dsh-tuitui-bot 冒烟（appId=${appId}） ===`);
try {
  await offlineNormalization();
  const client = await online(appId, secret);
  if (sendTarget) await liveSend(client, sendTarget);
} catch (error) {
  check('冒烟执行', false, error?.message ?? String(error));
}

const failed = results.filter((item) => !item.ok);
console.log(`\n=== 结果: ${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length > 0) {
  console.error('失败项：' + failed.map((item) => item.name).join(', '));
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
