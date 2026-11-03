/**
 * 绑定呈现策略（BindPresenter）
 *
 * 校验/落盘与呈现解耦：BindingService 只依赖本接口，具体实现由宿主形态决定。
 *
 * 与上游（QrPresenter）的差异：推推没有二维码，也没有可一次性打开的绑定 URL——
 * 凭据由用户在推推机器人管理后台创建后手填，绑定向导只存在于端内设置页。
 * 因此这里不再有「二维码 / 刷新二维码 / 拉起浏览器兜底」这些没有目标物件的通道，
 * 终端呈现只负责把「去哪里拿凭据、怎么填」打给运营者。
 */
import type { BindPhase } from './binding-service.ts';
/** 呈现策略接口：绑定向导与相位变化的通知接收方 */
export interface BindPresenter {
    /** 实现标识（诊断用） */
    readonly id: string;
    /** 打印绑定向导（start 时一次） */
    onGuide(): void;
    /** 相位变化（校验成功/失败、已绑定） */
    onPhase?(phase: BindPhase): void;
}
/**
 * 是否运行在 DSH Desktop 宿主中。
 *
 * Desktop 的 Host 以 ELECTRON_RUN_AS_NODE=1 的 Electron 子进程运行
 * （Desktop 宿主的启动约定），stdout 对用户不可见，终端呈现无意义。
 */
export declare function isDesktopHost(): boolean;
/** 绑定向导文案（终端呈现与日志共用；改文案只需改这里） */
export declare const BIND_GUIDE_LINES: readonly string[];
/**
 * 终端呈现（CLI / `dsh web` 运营者通道）
 *
 * 绑定引导是用户直接交互内容，必须用普通 console.log 输出：
 * 不带时间戳/级别前缀，不受日志级别配置影响。
 */
export declare function createTerminalPresenter(): BindPresenter;
//# sourceMappingURL=presenters.d.ts.map