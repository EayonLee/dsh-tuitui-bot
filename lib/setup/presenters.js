/** 插件包名（向导里提示文档位置时使用） */
const PACKAGE_NAME = '@qihoo/dsh-tuitui-bot';
/**
 * 是否运行在 DSH Desktop 宿主中。
 *
 * Desktop 的 Host 以 ELECTRON_RUN_AS_NODE=1 的 Electron 子进程运行
 * （Desktop 宿主的启动约定），stdout 对用户不可见，终端呈现无意义。
 */
export function isDesktopHost() {
    return process.env.ELECTRON_RUN_AS_NODE === '1' && typeof process.versions?.electron === 'string';
}
/** 绑定向导文案（终端呈现与日志共用；改文案只需改这里） */
export const BIND_GUIDE_LINES = [
    '未检测到推推机器人凭据（appId / appSecret）。',
    '请按以下步骤完成绑定：',
    '  1. 在推推机器人管理后台创建自建机器人，取得 AppID 与 AppSecret；',
    '  2. 打开 dsh 设置页 →「推推机器人」，填入后点「校验并保存」；凭据校验通过即写入 profile 并自动重载；',
    '  3. 无界面环境（CI / 守护进程）改用环境变量 TUITUI_BOT_APPID / TUITUI_BOT_SECRET。',
    `文档：${PACKAGE_NAME} 的 README.md「绑定推推机器人」章节。`,
];
/**
 * 终端呈现（CLI / `dsh web` 运营者通道）
 *
 * 绑定引导是用户直接交互内容，必须用普通 console.log 输出：
 * 不带时间戳/级别前缀，不受日志级别配置影响。
 */
export function createTerminalPresenter() {
    return {
        id: 'terminal',
        onGuide() {
            for (const line of BIND_GUIDE_LINES)
                console.log(line);
        },
        onPhase(phase) {
            if (phase.kind === 'bound') {
                console.log(`✔ 推推机器人凭据校验通过: ${phase.appId}\n`);
                return;
            }
            if (phase.kind === 'failed') {
                console.log(`✘ 凭据校验失败: ${phase.reason}\n`);
            }
        },
    };
}
//# sourceMappingURL=presenters.js.map