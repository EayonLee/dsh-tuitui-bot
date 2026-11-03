import { getScopePeer } from "../shared/scope.js";
/** 卡片按钮文案上限：卡片底部按钮排成一行，过长会把整张卡片撑变形 */
export const BUTTON_LABEL_MAX = 10;
/** 截断按钮文案，超长补省略号（正文保留完整文本，按钮只是操作入口） */
export function buttonLabel(text) {
    const s = String(text ?? '').trim();
    return s.length > BUTTON_LABEL_MAX ? s.slice(0, BUTTON_LABEL_MAX - 1) + '…' : s;
}
/**
 * 编码按钮 value。
 *
 * 推推的 value 允许直接放对象，因此这里返回对象本身——少一次序列化/转义，
 * 也让 SDK 侧不需要再 parse。
 * 显式重建而不是展开原对象：避免调用方多塞的字段（如调试信息）进到用户可点击的载荷里。
 */
export function encodeButtonData(data) {
    if (data.t === 'question')
        return { t: 'question', q: data.q, i: data.i };
    return data.n === undefined
        ? { t: 'approval', d: data.d }
        : { t: 'approval', d: data.d, n: data.n };
}
/**
 * 解码按钮 value；非法载荷或缺少合法 `t` 时返回 undefined。
 *
 * 同时接受对象与 JSON 字符串：SDK 的 value 类型是 `string | Record`，若中转链路
 * 把它序列化成字符串，语义不应丢失。字段做类型校验而不是直接断言——推推卡片的
 * value 是开放结构，弱校验会把别的卡片载荷误判成本通道的点击。
 */
export function decodeButtonData(raw) {
    const parsed = typeof raw === 'string' ? parseJson(raw) : raw;
    if (!isRecord(parsed))
        return undefined;
    const t = parsed.t;
    if (t === 'question') {
        if (typeof parsed.q !== 'string' || typeof parsed.i !== 'number')
            return undefined;
        return { t: 'question', q: parsed.q, i: parsed.i };
    }
    if (t === 'approval') {
        const d = parsed.d;
        if (d !== 'allow' && d !== 'deny')
            return undefined;
        return typeof parsed.n === 'string'
            ? { t: 'approval', d, n: parsed.n }
            : { t: 'approval', d };
    }
    return undefined;
}
export const DEFAULT_CARD_THEME = {
    headBgColor: '#1F6FEB',
    headTextColor: '#FFFFFF',
};
/** 把配置里的配色投影成主题；未配置的字段回落到默认值 */
export function resolveCardTheme(theme) {
    return {
        headBgColor: theme?.headBgColor || DEFAULT_CARD_THEME.headBgColor,
        headTextColor: theme?.headTextColor || DEFAULT_CARD_THEME.headTextColor,
    };
}
/**
 * 从归一化入站消息提取点击视图；没有按钮载荷时返回 undefined。
 *
 * 会话定位复用 getScopePeer：它和会话管理、入站推导是同一份逻辑，
 * 否则群聊卡片点击会算出与 pending 不匹配的 sessionKey（审批永远 settle 不了）。
 */
export function getInteractiveAction(message) {
    const value = interactiveValueOf(message);
    if (value === undefined)
        return undefined;
    const { scope, peerId } = getScopePeer(message);
    if (!peerId)
        return undefined;
    return {
        scope,
        targetId: peerId,
        ...(message.senderAccount ? { account: message.senderAccount } : {}),
        ...(message.senderId ? { uid: message.senderId } : {}),
        ...(message.messageId ? { messageId: message.messageId } : {}),
        value,
    };
}
/**
 * 从原始事件体里取被点击按钮的 value。
 *
 * SDK 会把回调体放在 `body.data`（TuituiInteractiveMessageCallback），但事件体的
 * data 类型是开放 Record，个别网关版本会把字段平铺到 body 上，所以两处都看。
 */
function interactiveValueOf(message) {
    const body = isRecord(message.raw) ? message.raw : undefined;
    const data = (body && isRecord(body.data) ? body.data : body) ?? undefined;
    if (!data)
        return undefined;
    const action = Array.isArray(data.action) ? data.action[0] : undefined;
    const fromAction = isRecord(action) ? action.value : undefined;
    if (fromAction !== undefined)
        return fromAction;
    return data.value;
}
/**
 * 构建单行按钮：推推的 action 是一维数组，
 * name 是稳定的按钮标识（重放回调时可核对），text 是用户看到的文案。
 */
export function buildAction(options) {
    return {
        name: options.name,
        text: options.text,
        value: encodeButtonData(options.value),
    };
}
function parseJson(raw) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return undefined;
    }
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=button-utils.js.map