import type { MediaSource, ReplyTarget, TuituiSender } from '../types.ts';
import type { SendFileConfig } from '../config.ts';
import { resolveAgentCwd } from '../shared/dirs.ts';
export { resolveAgentCwd };
/**
 * 发送器最小接口（TuituiSender 满足）。
 *
 * 交付物投递与工具只需要这两条原语；用结构子集而非整个 TuituiSender，
 * 测试才能注入假发送器而不必实现流式/卡片/撤回等无关方法。
 */
export type MediaSenderLike = Pick<TuituiSender, 'sendImage' | 'sendFile'>;
/**
 * 判断 filePath 是否位于 root 目录内（含 root 本身）。
 *
 * root 侧 realpath 解析符号链接；file 不存在时按最近存在祖先解析
 * （存在性由调用方 existsSync/stat 兜底，不应把「文件不存在」误报成
 * 「路径不允许」）；root 不存在则该 root 无效。
 */
export declare function isWithinRoot(filePath: string, root: string): boolean;
/**
 * 敏感路径判定 —— 凭据与密钥不允许作为附件发送。
 *
 * 宿主的 profile 目录（`$DSH_HOME/profiles/**`）整体视为敏感：凭据就写在
 * 里面的 cordis.patch.yml，按目录拒绝比按文件名拒绝更难绕过（profile 可能被
 * 复制成 cordis.patch.yml.bak 之类的名字）。
 */
export declare function isSensitivePath(filePath: string): boolean;
/**
 * 路径白名单校验。
 *
 * 两道闸，顺序不能换：
 * 1. 敏感路径（凭据/私钥/profile 目录）**永远拒绝**，与 restrictPaths 无关；
 * 2. restrictPaths 打开时限定 media + cwd + extraRoots，关闭时放行其余任意路径。
 */
export declare function isPathAllowed(filePath: string, config: SendFileConfig, cwd: string): boolean;
/** sendMediaFile 的结果：成功附带元数据；缺失不抛错；失败携带原因供日志与错误信息透出 */
export type SendMediaResult = {
    outcome: 'sent';
    size: number;
    messageId?: string;
} | {
    outcome: 'missing';
} | {
    outcome: 'failed';
    error: string;
};
/**
 * 发送一个媒体文件
 *
 * 本地文件不存在、不是普通文件时返回 missing（不抛错，调用方决定降级文案）；
 * 平台发送失败返回 failed。文件名透传给通用文件通道；caption 交给发送器
 * 决定投递方式（单聊先发说明文本再发附件，团队帖子由 teams.sendFile 自带
 * 文本字段），这里不做第二次发送，避免与发送器语义重复。
 */
export declare function sendMediaFile(bot: MediaSenderLike, target: ReplyTarget, input: MediaSource, opts?: {
    fileName?: string;
    caption?: string;
}): Promise<SendMediaResult>;
//# sourceMappingURL=send-media.d.ts.map