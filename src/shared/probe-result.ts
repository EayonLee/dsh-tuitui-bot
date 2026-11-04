/**
 * 把「连接测试」接口的响应翻译成一句人话。
 *
 * 抽成纯函数的原因：之前这层逻辑写在组件里，detail 字段名写岔了一个字，
 * 页面上就成了「✗ undefined」——错在渲染，但看着像配置错了，排查方向全跑偏。
 * 放这里之后有单测兜着，且保证 detail 永远是非空字符串。
 */

export interface ProbeOutcome {
  ok: boolean;
  /** 一定会是给人看的非空字符串，不会出现 undefined */
  detail: string;
}

/** 服务端路由不存在时的提示（旧进程 / 没重启） */
const STALE_SERVER = '这个接口不存在——服务端插件还是旧进程，先跑 ~/bin/dsh-restart';

function pickMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const record = body as Record<string, unknown>;
  for (const key of ['detail', 'error', 'message'] as const) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return undefined;
}

export function interpretTestResponse(status: number, body: unknown): ProbeOutcome {
  if (status === 404 || status === 405) return { ok: false, detail: STALE_SERVER };

  const message = pickMessage(body);
  const recorded = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['ok'] : undefined;

  if (recorded === true) {
    return { ok: true, detail: message ?? '连接正常，鉴权通过' };
  }
  if (recorded === false) {
    return { ok: false, detail: message ?? `测试失败（HTTP ${String(status)}）` };
  }
  if (message !== undefined) {
    // 有话说但没给 ok 标记：按 HTTP 状态判，别把 500 说成成功
    return { ok: status < 400, detail: message };
  }
  return { ok: status < 400, detail: `服务端返回 HTTP ${String(status)}，没有给出原因` };
}
