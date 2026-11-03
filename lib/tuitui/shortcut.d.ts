/**
 * 推推快捷指令同步
 *
 * 推推机器人支持在聊天输入框的"快捷指令"面板里展示固定指令，
 * 与 QQ 的 `/help` 文本提示相比更易发现。启动时把插件命令全量同步一次
 * （SDK 的 setShortcutCommands 是全量覆盖语义）。
 *
 * 失败不影响启动：私有化部署或未开通权限时会直接返回错误。
 */
import type { TuituiBotClient, TuituiShortcutCommand } from '@qihoo/tuitui-bot-sdk';
import type { Logger } from '../types.ts';
/** 默认指令表（与 commands/ 的注册表保持一致；由 bootstrap 兜底使用） */
export declare const DEFAULT_SHORTCUTS: TuituiShortcutCommand[];
/** 全量同步快捷指令（幂等；失败只记日志） */
export declare function syncShortcutCommands(client: TuituiBotClient, commands: TuituiShortcutCommand[], logger: Logger): Promise<boolean>;
//# sourceMappingURL=shortcut.d.ts.map