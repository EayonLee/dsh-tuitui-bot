/**
 * 版本条的展示逻辑（纯函数，不含 React / DOM）
 *
 * 抽出来的理由很实际：状态有七种、按钮有三种、提示有一堆分支，
 * 混在 JSX 里既难看也没法测。这里只做「输入 → 该显示什么」，
 * 组件负责把它画出来，单测直接怼这张表。
 *
 * 三条硬规则（都是用户在真实使用中提过的）：
 *   1. 版本号**永不省略**：读不到就不显示这块，绝不用「…」占位。
 *   2. 「检查更新」**永远能按**（只在检查/更新进行中禁用）：已是最新时按下去，
 *      要有明确反馈「已是最新」，而不是按了没反应。
 *   3. 每个状态都要有**颜色**：待重启、检查失败、已是最新都不能是灰字小透明。
 */
import type { AboutWire, UpdateStatusWire } from './about-protocol.ts';
/** 版本条状态机 */
export type AboutPhase = 'loading' | 'idle' | 'checking' | 'applying' | 'latest' | 'update' | 'ahead' | 'failed' | 'unavailable';
/** 状态标签的色调（对应 CSS 类名后缀） */
export type ChipTone = 'muted' | 'info' | 'warn' | 'ok';
/** 一个可点按钮的展示信息 */
export interface AboutButtonView {
    label: string;
    enabled: boolean;
}
/** 状态标签 */
export interface AboutChipView {
    label: string;
    tone: ChipTone;
    /** 悬停说明（失败原因、支持范围等） */
    title: string | null;
}
/** 版本条要画出来的全部内容 */
export interface AboutView {
    /** 「v0.1.30」；null = 还没读到，不渲染版本块（不允许出现省略号） */
    versionLabel: string | null;
    versionTitle: string | null;
    repoUrl: string;
    repoTitle: string;
    /** 检查更新按钮（始终存在） */
    check: AboutButtonView;
    /** 更新按钮：只有确实有新版时才出现 */
    apply: AboutButtonView | null;
    chip: AboutChipView | null;
    note: string | null;
}
/** 展示输入 */
export interface AboutViewInput {
    about: AboutWire | null;
    status: UpdateStatusWire | null;
    phase: AboutPhase;
    note: string | null;
}
/** 检查/更新进行中 */
export declare function isBusy(phase: AboutPhase): boolean;
/**
 * 把状态翻译成「显示什么」。
 *
 * 状态 → 按钮/标签对照：
 *   loading     ：检查更新可按（还没读到版本也能点）
 *   idle        ：同上
 *   checking    ：按钮「检查中…」禁用
 *   applying    ：按钮「更新中…」禁用 + 更新按钮禁用
 *   update      ：「更新到 vX」主按钮 + 检查更新（仍可按，用于复核）
 *   latest      ：「已是最新」绿色标签，检查更新仍可按
 *   ahead       ：「本地更新」标签（自己改过没发布）
 *   failed      ：「检查失败」橙色标签 + 原因
 *   unavailable ：「待重启」橙色标签（服务端还是旧代码）
 */
export declare function deriveAboutView(input: AboutViewInput): AboutView;
/**
 * 手动检查完之后的提示语。
 *
 * 自动检查（打开页面时那次）不出声，手动点才给回执 —— 否则每次进设置页
 * 都跳一句「已是最新」，很快就没人看了。
 */
export declare function manualCheckNote(status: UpdateStatusWire): string | null;
//# sourceMappingURL=about-view.d.ts.map