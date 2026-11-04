/**
 * 智能插话判定 — 让模型自己决定要不要开口
 *
 * 把最近的群聊记录 + 最新一条消息交给模型，由它按自己的处境决定要不要开口：
 * 感兴趣、不同意、无聊、手上有信息、被人叫到、觉得该拍板——都算理由。
 * 判定失败/超时一律不插嘴：宁可漏一句，也不瞎抢话。
 *
 * 成本控制：同一会话 cooldownMs 内只判一次。
 */
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, MessageSource, StreamChunk } from '@deepseek-ai/dsh-llm';
import { DEFAULT_SMART_PROMPT } from '../shared/smart-prompt.ts';
import type { Logger } from '../types.ts';

/** llm 服务最小接口（与 media/vision-tool 保持一致的收窄） */
interface LlmRuntimeLike {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}

/** 一条群聊记录（只留判断需要的最小信息） */
export interface JudgeLine {
  /** 说话人显示名 */
  sender: string;
  /** 文本内容（已清洗） */
  text: string;
  /** 是否是机器人自己发的 */
  self?: boolean;
}

export interface SmartJudgeOptions {
  /** ctx.llm 服务；不可用时直接判否 */
  llm: LlmRuntimeLike | undefined;
  /** 本次判定使用的模型路线 */
  route: { provider: string; model: string } | undefined;
  /** 最近的对话（按时间正序，不含本条） */
  history: readonly JudgeLine[];
  /** 最新一条待判断的消息 */
  message: JudgeLine;
  /** 自定义判定提示词（设置页可编辑）；空则用 DEFAULT_SMART_PROMPT */
  prompt?: string;
  /** 超时毫秒（默认 8000） */
  timeoutMs?: number;
  /** 输出上限 token（默认 120） */
  maxTokens?: number;
  /** 同会话冷却键（群 id）；给了 cooldownMs 才生效 */
  cooldownKey?: string;
  /** 冷却毫秒（默认 20000） */
  cooldownMs?: number;
  logger?: Logger;
}

export interface SmartJudgeResult {
  /** true=插嘴，false=不插嘴 */
  join: boolean;
  /** 模型给的一句话理由（调试/日志用） */
  reason?: string;
}

/** 冷却表：key → 上次判定时间戳（进程内，与会话生命周期同量级，无需持久化） */
const cooldowns = new Map<string, number>();

/** 清空冷却表（测试 / 重载时用） */
export function clearSmartJudgeCooldowns(): void {
  cooldowns.clear();
}

export { DEFAULT_SMART_PROMPT } from '../shared/smart-prompt.ts';

/** 生效提示词：用户改过就用用户的，空串/空白视为未改 */
function activePrompt(options: SmartJudgeOptions): string {
  const custom = options.prompt;
  return custom !== undefined && custom.trim() !== '' ? custom : DEFAULT_SMART_PROMPT;
}

/** 把对话压成提示词正文 */
function renderPrompt(options: SmartJudgeOptions): string {
  const history = options.history
    .slice(-20)
    .map((line) => (line.self === true ? '[你]' : line.sender) + ': ' + line.text)
    .join('\n');

  return [
    '【最近对话】',
    history === '' ? '（无）' : history,
    '',
    '【新消息】',
    options.message.sender + ': ' + options.message.text,
    '',
    '这条消息要回吗？只输出 JSON。',
  ].join('\n');
}

/** 从模型输出里抠出 JSON（容忍代码块与多余文字） */
function parseVerdict(text: string): SmartJudgeResult | undefined {
  const match = /\{[^{}]*\}/.exec(text);
  if (match === null) {
    // 退路：模型只回了 join/true 之类的单词
    const lowered = text.toLowerCase();
    if (/\bjoin\b|\btrue\b|\byes\b/.test(lowered) && !/\bfalse\b|\bskip\b/.test(lowered)) {
      return { join: true, reason: 'fallback-text' };
    }
    return undefined;
  }
  try {
    const parsed = JSON.parse(match[0]) as { join?: unknown; why?: unknown };
    const join = parsed.join === true || parsed.join === 'true';
    return { join, reason: typeof parsed.why === 'string' ? parsed.why.slice(0, 60) : undefined };
  } catch {
    return undefined;
  }
}

/**
 * 判断一条消息要不要插嘴。
 *
 * 失败语义：任何异常/超时/服务缺失都返回 join:false，调用方不需要 try/catch。
 */
export async function judgeShouldJoin(options: SmartJudgeOptions): Promise<SmartJudgeResult> {
  const log = options.logger;
  const cooldownKey = options.cooldownKey;
  const cooldownMs = options.cooldownMs === undefined ? 5000 : options.cooldownMs;

  // 冷却：同一会话短时间内只判一次，控制成本与延迟
  if (cooldownKey !== undefined && cooldownKey !== '') {
    const last = cooldowns.get(cooldownKey);
    const now = Date.now();
    if (last !== undefined && now - last < cooldownMs) {
      return { join: false, reason: 'cooldown' };
    }
    cooldowns.set(cooldownKey, now);
  }

  const llm = options.llm;
  const route = options.route;
  if (llm === undefined || route === undefined || route.provider === '' || route.model === '') {
    return { join: false, reason: 'llm-unavailable' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, options.timeoutMs === undefined ? 8000 : options.timeoutMs);

  try {
    // producer-owned source kind（与 media/vision-tool 同款桥接）
    const source = { kind: 'plugin:dsh-tuitui-bot' } as unknown as MessageSource;
    const generate: GenerateOptions = {
      provider: route.provider,
      model: route.model,
      messages: [createUserMessage({
        content: [{ type: 'text', text: activePrompt(options) + '\n\n' + renderPrompt(options) }],
        source,
      })],
      maxTokens: options.maxTokens === undefined ? 400 : options.maxTokens,
      signal: controller.signal,
    };

    const assembler = new BlockAssembler();
    for await (const chunk of llm.stream(generate)) assembler.push(chunk);

    // 思考型模型会把 token 先花在 reasoning 上：maxTokens 小的时候正文可能是空的，
    // JSON 反而藏在 reasoning 里。两边都翻一遍，别因为拿错抽屉就判「不回」。
    const blocks = assembler.blocks() as unknown as { type?: string; blockType?: string; text?: string }[];
    const kindOf = (b: { type?: string; blockType?: string }): string => b.type ?? b.blockType ?? '';
    const pick = (kinds: string[]): string => blocks
      .filter((b) => kinds.includes(kindOf(b)))
      .map((b) => b.text ?? '')
      .join(' ')
      .trim();
    const answer = pick(['text']);
    const thinking = pick(['reasoning']);

    const verdict = parseVerdict(answer) ?? parseVerdict(thinking);
    if (verdict === undefined) {
      const kinds = blocks.map((b) => kindOf(b) || '?').join(',');
      if (log !== undefined) {
        log.warn('[tuitui/smart] 模型输出无法解析，判为不插嘴: blocks=[' + kinds + '] text="'
          + answer.slice(0, 60) + '" reasoning="' + thinking.slice(0, 60) + '"');
      }
      return { join: false, reason: answer === '' && thinking === '' ? 'empty-output' : 'unparsable' };
    }
    return verdict;
  } catch (err) {
    if (log !== undefined) {
      log.warn('[tuitui/smart] 判定失败，判为不插嘴: ' + (err instanceof Error ? err.message : String(err)));
    }
    return { join: false, reason: 'error' };
  } finally {
    clearTimeout(timer);
  }
}