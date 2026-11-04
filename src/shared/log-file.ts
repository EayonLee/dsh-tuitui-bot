/**
 * 插件自带的落地日志。
 *
 * 宿主 logger 的输出落到哪里不受我们控制（实测进不了 web.log），出了「该回却没回」
 * 这种事就无从查起。这里把插件的每条日志同步写一份到 $DSH_HOME/tuitui.log：
 * 打开就能看，tail -f 就能盯，grep 就能查。
 *
 * 绝不因为写日志把机器人搞挂：任何 IO 异常都吞掉。
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Logger } from '../types.ts';

/** 单文件上限：超过就滚成 .1（只留一份历史，够查最近两天） */
const MAX_BYTES = 5 * 1024 * 1024;

function logPath(): string {
  const env: string | undefined = process.env['DSH_HOME'];
  const home = env !== undefined && env !== '' ? env : join(homedir(), '.dsh');
  return join(home, 'tuitui.log');
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** 本地时间戳（给人看的日志，用本地时区） */
function stamp(): string {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
    + '.' + pad(d.getMilliseconds(), 3);
}

function rotateIfNeeded(file: string): void {
  try {
    if (!existsSync(file)) return;
    if (statSync(file).size < MAX_BYTES) return;
    renameSync(file, file + '.1');
  } catch {
    /* 轮转失败就继续写，不阻塞 */
  }
}

/** 消息里的换行压平：一条日志一行，grep 友好 */
function oneLine(msg: string): string {
  return msg.replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 4000);
}

/** 在宿主 logger 外面套一层：原样转发 + 落文件 */
export function withFileLog(base: Logger): Logger {
  const file = logPath();
  // debug 默认不落盘（太吵）；要排查时 export TUITUI_LOG_DEBUG=1
  const mirrorDebug = process.env['TUITUI_LOG_DEBUG'] === '1';

  const write = (level: string, msg: string): void => {
    try {
      mkdirSync(dirname(file), { recursive: true });
      rotateIfNeeded(file);
      appendFileSync(file, stamp() + ' [' + level + '] ' + oneLine(msg) + '\n');
    } catch {
      /* 写不进去就算了，不能影响机器人本身 */
    }
  };

  return {
    info: (msg, ...args) => { write('info', msg); base.info(msg, ...args); },
    warn: (msg, ...args) => { write('warn', msg); base.warn(msg, ...args); },
    error: (msg, ...args) => { write('error', msg); base.error(msg, ...args); },
    debug: (msg, ...args) => {
      if (mirrorDebug) write('debug', msg);
      base.debug(msg, ...args);
    },
  };
}
