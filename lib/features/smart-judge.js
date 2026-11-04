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
import { DEFAULT_SMART_PROMPT } from "../shared/smart-prompt.js";
/** 冷却表：key → 上次判定时间戳（进程内，与会话生命周期同量级，无需持久化） */
const cooldowns = new Map();
/** 清空冷却表（测试 / 重载时用） */
export function clearSmartJudgeCooldowns() {
    cooldowns.clear();
}
export { DEFAULT_SMART_PROMPT } from "../shared/smart-prompt.js";
/** 生效提示词：用户改过就用用户的，空串/空白视为未改 */
function activePrompt(options) {
    const custom = options.prompt;
    return custom !== undefined && custom.trim() !== '' ? custom : DEFAULT_SMART_PROMPT;
}
/** 把对话压成提示词正文 */
function renderPrompt(options) {
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
/**
 * 从模型输出里抠出 JSON（容忍代码块与多余文字）。
 *
 * 认两种写法：
 *   新：{"act":"text|emoji|silent","emoji":"😂","why":"..."}
 *   旧：{"join":true|false,"why":"..."}（还有老提示词/老配置在用，别让它们失效）
 */
function parseVerdict(text) {
    const match = /\{[^{}]*\}/.exec(text);
    if (match === null) {
        // 退路：模型只回了 join/true 之类的单词
        const lowered = text.toLowerCase();
        if (/\bjoin\b|\btrue\b|\byes\b/.test(lowered) && !/\bfalse\b|\bskip\b/.test(lowered)) {
            return { join: true, act: 'text', reason: 'fallback-text' };
        }
        return undefined;
    }
    try {
        const parsed = JSON.parse(match[0]);
        const reason = typeof parsed.why === 'string' ? parsed.why.slice(0, 60) : undefined;
        const emoji = typeof parsed.emoji === 'string' ? parsed.emoji.trim().slice(0, 8) : undefined;
        const act = typeof parsed.act === 'string' ? parsed.act.trim().toLowerCase() : undefined;
        if (act === 'emoji' && emoji !== undefined && emoji !== '')
            return { join: false, act: 'emoji', emoji, ...(reason === undefined ? {} : { reason }) };
        if (act === 'text')
            return { join: true, act: 'text', ...(reason === undefined ? {} : { reason }) };
        if (act === 'silent' || act === 'none' || act === 'skip')
            return { join: false, act: 'silent', ...(reason === undefined ? {} : { reason }) };
        const join = parsed.join === true || parsed.join === 'true';
        return { join, act: join ? 'text' : 'silent', ...(reason === undefined ? {} : { reason }) };
    }
    catch {
        return undefined;
    }
}
/**
 * 判断一条消息要不要插嘴。
 *
 * 失败语义：任何异常/超时/服务缺失都返回 join:false，调用方不需要 try/catch。
 */
export async function judgeShouldJoin(options) {
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
        const source = { kind: 'plugin:dsh-tuitui-bot' };
        const generate = {
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
        for await (const chunk of llm.stream(generate))
            assembler.push(chunk);
        // 思考型模型会把 token 先花在 reasoning 上：maxTokens 小的时候正文可能是空的，
        // JSON 反而藏在 reasoning 里。两边都翻一遍，别因为拿错抽屉就判「不回」。
        const blocks = assembler.blocks();
        const kindOf = (b) => b.type ?? b.blockType ?? '';
        const pick = (kinds) => blocks
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
    }
    catch (err) {
        if (log !== undefined) {
            log.warn('[tuitui/smart] 判定失败，判为不插嘴: ' + (err instanceof Error ? err.message : String(err)));
        }
        return { join: false, reason: 'error' };
    }
    finally {
        clearTimeout(timer);
    }
}
//# sourceMappingURL=smart-judge.js.map