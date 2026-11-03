/**
 * 智能插话判定 — 让模型自己决定要不要开口
 *
 * 旧实现（别名/追问窗口的硬规则）本质是「出现名字就回」，僵且吵。
 * 这里换成真正的判断：把最近的群聊记录 + 最新一条消息交给模型，
 * 让它在「群里其他人正在聊天」的语境里判断这条是不是冲自己来的、
 * 自己插嘴是否有价值。判定失败/超时一律不插嘴——宁可漏答，不能刷屏。
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
  /** 机器人名字（用于提示词，让它知道「自己」是谁） */
  botName?: string;
  /** 用户给机器人起过的称呼（作为线索，不作为硬规则） */
  aliases?: readonly string[];
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
  const names = [options.botName === undefined ? '' : options.botName, ...(options.aliases === undefined ? [] : options.aliases)]
    .map((name) => name.trim())
    .filter((name) => name !== '');
  const selfLine = names.length === 0
    ? '你就是群里的这个机器人。'
    : '你就是「' + names[0] + '」，别人可能这样叫你：' + names.join('、') + '。';

  const history = options.history
    .slice(-20)
    .map((line) => (line.self === true ? '[你]' : line.sender) + ': ' + line.text)
    .join('\n');

  return [
    selfLine,
    '',
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
  const cooldownMs = options.cooldownMs === undefined ? 20000 : options.cooldownMs;

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
      maxTokens: options.maxTokens === undefined ? 120 : options.maxTokens,
      signal: controller.signal,
    };

    const assembler = new BlockAssembler();
    for await (const chunk of llm.stream(generate)) assembler.push(chunk);

    const text = assembler.blocks()
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join(' ')
      .trim();

    const verdict = parseVerdict(text);
    if (verdict === undefined) {
      if (log !== undefined) log.debug('[smart-judge] 模型输出无法解析，判为不插嘴: ' + text.slice(0, 120));
      return { join: false, reason: 'unparsable' };
    }
    return verdict;
  } catch (err) {
    if (log !== undefined) {
      log.debug('[smart-judge] 判定失败，判为不插嘴: ' + (err instanceof Error ? err.message : String(err)));
    }
    return { join: false, reason: 'error' };
  } finally {
    clearTimeout(timer);
  }
}