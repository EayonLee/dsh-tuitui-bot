/**
 * 杂项命令
 *
 * - /bot-ping /bot-version /bot-me：推推插件特有（连通性测试、版本、身份）
 * - /stop：中止当前生成（对应底层 agent cancel，通用能力）
 *
 * 推推 SDK 不会自动把 handler 的返回字符串发出去，因此每个命令自己调
 * replyText 发送（所以 ping 也需要拿到 config）。
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
/** /bot-ping — 测试当前 dsh 与推推连接的网络延迟 */
export declare function pingCommand({ config }: CommandDeps): CategorizedCommand;
/** /bot-version — 查看版本信息 */
export declare function versionCommand({ manager, config }: CommandDeps): CategorizedCommand;
/**
 * /bot-me — 查看发送者身份标识
 *
 * 私聊返回域账号与 uid、群聊额外返回 group_id、帖子额外返回频道定位
 * （分别对应 access.c2cAllow / groupAllow / postAllow 的名单 key）。
 * 首次配置白名单时最常用的一条命令，未显式 @ 也能拿到自己的账号。
 */
export declare function meCommand({ config }: CommandDeps): CategorizedCommand;
/** /stop — 中止当前生成（隐藏） */
export declare function stopCommand({ manager, config }: CommandDeps): CategorizedCommand;
//# sourceMappingURL=misc.d.ts.map