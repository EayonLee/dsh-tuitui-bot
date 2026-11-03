/**
 * 内置 tuitui_send_file 工具 — 将本地文件发送给推推单聊或群聊。
 *
 *   - 发送目标默认自动定位（exec.agent → SessionManager.findByAgent → replyTarget），
 *     无需模型手动传账号；显式 target 参数作为覆盖。
 *   - 图片走 sendImage，其余（视频/语音/文档）统一走 sendFile——推推只有一个
 *     附件通道，SDK 自行按 mediaType 区分 image / attachment。
 *   - 路径白名单：默认只允许访问 media 目录 + agent cwd，可开关 + 扩展白名单。
 */
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { isPathAllowed, resolveAgentCwd, sendMediaFile } from "./send-media.js";
/** 工具名（tuitui 前缀避免与其他通道的同名工具冲突） */
export const SEND_FILE_TOOL_NAME = 'tuitui_send_file';
const DESCRIPTION = 'Send a local file (image, video, audio, or generic file) to the Tuitui single chat or group '
    + 'of the current conversation. Pass the absolute path of a file that already exists on disk. '
    + 'Use this when the user asks you to deliver a generated file (chart, report, exported data, '
    + 'screenshot, etc.) or to send an existing media/file back to them.';
/**
 * 解析显式 target（"c2c:account" / "group:group_id"），非法返回 undefined。
 *
 * 团队帖子需要 team/channel/post 三元组，单个标识无法表达，因此帖子场景
 * 一律走「当前会话自动定位」——不在工具参数里造一个半成品语法。
 */
function parseTarget(input) {
    const idx = input.indexOf(':');
    if (idx <= 0)
        return undefined;
    const scope = input.slice(0, idx);
    const targetId = input.slice(idx + 1);
    if (!targetId || (scope !== 'c2c' && scope !== 'group'))
        return undefined;
    return { scope, targetId };
}
/** 注册 tuitui_send_file 工具（tools 服务缺失时优雅降级，不阻断插件启动） */
export function registerSendFileTool(ctx, sender, manager, config, logger) {
    const tools = ctx.get('tools');
    if (!tools?.register) {
        logger.warn('im-tuitui: tools 服务不可用，tuitui_send_file 工具未注册');
        return;
    }
    const cwd = resolveAgentCwd(config.cwd);
    // 收窄成发送原语子集：依赖方向与交付物投递一致，也避免工具误用流式/卡片接口
    const bot = sender;
    const definition = {
        name: SEND_FILE_TOOL_NAME,
        description: DESCRIPTION,
        parameters: {
            type: 'object',
            properties: {
                file_path: {
                    type: 'string',
                    description: 'Absolute path to the local file to send (image/video/audio/generic file).',
                },
                target: {
                    type: 'string',
                    description: 'Optional send target as "c2c:account" or "group:group_id". Omit to send to the current conversation.',
                },
            },
            required: ['file_path'],
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    fileName: { type: 'string' },
                    fileSize: { type: 'integer' },
                    target: { type: 'string' },
                    messageId: { type: 'string' },
                },
                required: ['fileName', 'fileSize', 'target'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const v = value;
                return [{ type: 'text', text: `已发送 ${v.fileName} → ${v.target}` }];
            },
        },
        async execute(args, exec) {
            const { file_path, target } = args;
            if (typeof file_path !== 'string' || file_path.length === 0) {
                throw new Error('tuitui_send_file: `file_path` must be a non-empty string');
            }
            // 1. 解析发送目标：显式 target > 当前会话（exec.agent → SessionRecord）
            let replyTarget;
            if (target !== undefined && target !== '') {
                replyTarget = parseTarget(target);
                if (replyTarget === undefined) {
                    throw new Error(`tuitui_send_file: target 格式错误，需要 c2c:account 或 group:group_id，收到: ${target}`);
                }
            }
            else if (exec.agent !== undefined) {
                replyTarget = manager.findByAgent(exec.agent)?.replyTarget;
            }
            if (replyTarget === undefined) {
                throw new Error('tuitui_send_file: 无法确定发送目标，请显式传 target 参数');
            }
            // 2. 校验文件 + 路径白名单
            const absPath = resolve(file_path);
            if (!isPathAllowed(absPath, config.sendFile, cwd)) {
                throw new Error(`tuitui_send_file: file_path 不在允许的目录内: ${absPath}`);
            }
            if (!existsSync(absPath)) {
                throw new Error(`tuitui_send_file: 文件不存在: ${absPath}`);
            }
            // 3. 分类发送（与交付物投递共用 send-media 的实现）
            const fileName = basename(absPath);
            const result = await sendMediaFile(bot, replyTarget, absPath);
            if (result.outcome === 'missing') {
                throw new Error(`tuitui_send_file: 文件不存在或不可读: ${absPath}`);
            }
            if (result.outcome === 'failed') {
                throw new Error(`tuitui_send_file: 发送失败: ${result.error}`);
            }
            logger.info(`im-tuitui: tuitui_send_file 发送 ${fileName} (${result.size} bytes) → ${replyTarget.scope}:${replyTarget.targetId}`);
            return {
                fileName,
                fileSize: result.size,
                target: `${replyTarget.scope}:${replyTarget.targetId}`,
                ...(result.messageId !== undefined ? { messageId: result.messageId } : {}),
            };
        },
    };
    tools.register(definition);
    logger.info('im-tuitui: tuitui_send_file 工具已注册');
}
//# sourceMappingURL=send-file-tool.js.map