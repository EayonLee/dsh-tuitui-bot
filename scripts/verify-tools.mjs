#!/usr/bin/env node
/**
 * 工具注册验收脚本。
 *
 * 背景（issue #14）：dsh 要求工具声明 output，缺了会静默注册失败，模型那边
 * 一个工具都没有，而启动日志里只有一行 warn。这个脚本把"工具到底有没有真的
 * 出现在机器人身上"变成一条可执行的断言，重启后跑一次就知道。
 *
 * 用法：
 *   node scripts/verify-tools.mjs                 # 只看启动日志
 *   node scripts/verify-tools.mjs --live <groupId> # 再用真实 SDK 查一次群成员
 *
 * 退出码：0 全通过 / 1 有失败项。
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LOG_PATH = join(homedir(), '.dsh', 'tuitui.log');
const PROFILE_PATCH = join(homedir(), '.dsh', 'profiles', 'web', 'cordis.patch.yml');

/** 期望注册成功的工具（9 个） */
const EXPECTED_TOOLS = [
  'tuitui_describe_image',
  'tuitui_draw',
  'tuitui_file',
  'tuitui_group',
  'tuitui_history',
  'tuitui_send',
  'tuitui_send_file',
  'tuitui_teams',
  'tuitui_bot',
];

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? '✅ ' : '❌ ') + name + (detail ? ' — ' + detail : ''));
}

/** 找出最后一次启动之后的那段日志，避免老记录骗人 */
function lastStartupSlice() {
  if (!existsSync(LOG_PATH)) return { text: '', at: null };
  const all = readFileSync(LOG_PATH, 'utf8').split('\n');
  let start = 0;
  for (let i = all.length - 1; i >= 0; i -= 1) {
    if (all[i].includes('tuitui client initialized')) { start = i; break; }
  }
  return { text: all.slice(start).join('\n'), at: all[start]?.slice(0, 19) ?? null };
}

const { text: recent, at } = lastStartupSlice();
check('找到启动日志', recent !== '', at === null ? '日志里没有启动记录' : '最近一次启动 ' + at);

check(
  '启动汇总为 9/9',
  /可选能力注册 9\/9/.test(recent),
  /可选能力注册 (\d+)\/(\d+)/.exec(recent)?.[0] ?? '没有这行（可能还是旧进程）',
);

const missing = EXPECTED_TOOLS.filter((name) => !new RegExp(name + ' 工具已注册').test(recent));
check('九个工具都注册了', missing.length === 0, missing.length === 0 ? '' : '缺: ' + missing.join(', '));

const failures = [...recent.matchAll(/registration failed: (.+)/g)].map((m) => m[1]);
check('没有注册失败', failures.length === 0, failures.length === 0 ? '' : failures[0]);

// ── 可选：真实调用一次（需要凭据，且会打网络） ──
const liveIndex = process.argv.indexOf('--live');
if (liveIndex > -1) {
  const groupId = process.argv[liveIndex + 1];
  if (!groupId) {
    check('--live 需要 groupId', false, '用法: --live <groupId>');
  } else if (!existsSync(PROFILE_PATCH)) {
    check('读取 profile 配置', false, '找不到 ' + PROFILE_PATCH);
  } else {
    try {
      const { parse } = await import('yaml');
      const config = parse(readFileSync(PROFILE_PATCH, 'utf8')).find((item) => item.id === 'im-tuitui')?.config;
      const sdkPath = join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', '@qihoo', 'tuitui-bot-sdk', 'dist', 'index.js');
      const sdk = await import('file://' + sdkPath);
      const client = new sdk.TuituiBotClient(config.appId, config.appSecret, {});

      const groups = await client.group.robotIn();
      check('robot_in 可调用', Array.isArray(groups), groups.length + ' 个群');

      const members = await client.group.members(groupId);
      const names = members.map((m) => m.name + '/' + m.account + (m.is_bot ? '[bot]' : ''));
      check('members 可调用', members.length > 0, groupId + ' → ' + names.join(', '));

      const found = await client.group.userIsIn({ user: 'lizhengtai', groups: [groupId] });
      check('user_is_in 可调用', true, '命中 ' + found.length + ' 个群');
    } catch (error) {
      check('真实调用', false, String(error?.message ?? error).slice(0, 160));
    }
  }
}

const failed = results.filter((r) => !r.ok);
console.log('');
if (failed.length > 0) {
  console.log('结果：' + failed.length + ' 项未通过（' + results.length + ' 项检查）');
  process.exit(1);
}
console.log('结果：全部通过（' + results.length + ' 项检查）');

