import type { Logger } from '../types.ts';
import { type FetchLike } from './version-check.ts';
export interface StartupUpdateNoticeOptions {
    /** 更新通道（跟 selfUpdate.channel 一致） */
    channel: 'release' | 'main';
    logger: Logger;
    fetchImpl?: FetchLike;
    /** 当前版本来源（单测注入）；默认读安装包的 package.json */
    readVersion?: () => Promise<string>;
}
export interface StartupUpdateNotice {
    current: string;
    latest: string;
    /** 打给用户看的那一行（没有更新时为 null） */
    message: string | null;
}
/**
 * 查一次新版本并（有更新时）打一行 info。
 *
 * 返回结构化结果方便单测断言；内部已经吞掉所有异常，不会 reject。
 */
export declare function notifyUpdateOnStartup(options: StartupUpdateNoticeOptions): Promise<StartupUpdateNotice | null>;
//# sourceMappingURL=startup-version.d.ts.map