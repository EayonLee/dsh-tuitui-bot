/**
 * /bind — 查看机器人凭据绑定状态与设置入口
 *
 * 上游靠扫二维码绑定（setup/binding-service），推推没有扫码，凭据只能在
 * dsh 设置页的插件面板里填（写进 profile 的 cordis.patch.yml），再用
 * property.info() 在线校验。命令侧只做"当前是什么状态 + 去哪里改"的说明，
 * 真正的写入/校验由 setup/（W6）负责——这里不复制那份逻辑。
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
/** /bind — 查看绑定状态与设置页提示 */
export declare function bindCommand({ config }: CommandDeps): CategorizedCommand;
//# sourceMappingURL=bind.d.ts.map