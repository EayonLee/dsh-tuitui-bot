/** 插件版本号（从 package.json 读取，供 help/version 等展示真实版本） */
export declare const PLUGIN_VERSION: string;
/**
 * 构造 User-Agent 头
 *
 * 格式: dsh-tuitui-bot/{version} (Node/{nodeVersion}; {platform})
 */
export declare function buildUserAgent(): string;
/**
 * 从插件安装路径推导 profile 目录
 *
 * 主策略：逐级向上探测 profile 标志文件（cordis.patch.yml / pnpm-workspace.yaml）。
 * Desktop profile 使用 pnpm workspace 布局，插件嵌套于多级 node_modules，
 * 仅按 node_modules 匹配会命中内层目录而返回错误位置。
 *
 * @param baseDir - 起始目录，缺省为插件根（可注入便于测试）
 */
export declare function getProfileDir(baseDir?: string): string | null;
/**
 * 解析环境变量占位配置
 *
 * 支持三种写法：直接值、`__FROM_ENV__`（bundle patch 占位）、`process.env.XXX`。
 */
export declare function resolveEnv(configValue: string | undefined, envKey: string): string;
/** 格式化相对时间 */
export declare function formatRelativeTime(ts?: number): string;
/** 截断字符串（日志与卡片展示用） */
export declare function truncate(text: string, max: number): string;
//# sourceMappingURL=utils.d.ts.map