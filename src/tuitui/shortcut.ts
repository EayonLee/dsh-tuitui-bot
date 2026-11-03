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
import { describeApiError } from './client.ts';

/** 默认指令表（与 commands/ 的注册表保持一致；由 bootstrap 兜底使用） */
export const DEFAULT_SHORTCUTS: TuituiShortcutCommand[] = [
  { name: 'new', content: '/new', description: '开始新会话（清空上下文）', tag: '会话' },
  { name: 'stop', content: '/stop', description: '中止当前生成', tag: '会话' },
  { name: 'compact', content: '/compact', description: '压缩会话历史', tag: '会话' },
  { name: 'status', content: '/status', description: '查看当前会话状态', tag: '查询' },
  { name: 'model', content: '/model', description: '查看或切换模型', tag: '设置' },
  { name: 'preset', content: '/preset', description: '查看或切换 agent preset', tag: '设置' },
  { name: 'help', content: '/bot-help', description: '查看全部指令', tag: '帮助' },
];

/** 全量同步快捷指令（幂等；失败只记日志） */
export async function syncShortcutCommands(
  client: TuituiBotClient,
  commands: TuituiShortcutCommand[],
  logger: Logger,
): Promise<boolean> {
  if (commands.length === 0) return false;
  try {
    await client.property.setShortcutCommands(commands);
    logger.info(`shortcut commands synced (${commands.length})`);
    return true;
  } catch (error) {
    logger.warn(`shortcut command sync failed: ${describeApiError(error)}`);
    return false;
  }
}
