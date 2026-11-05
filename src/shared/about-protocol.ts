/**
 * 版本与更新协议 —— 宿主路由与设置页共用的契约
 *
 * 与 bind-protocol.ts 同样的纪律：纯类型 + 纯常量，零 node 依赖、零副作用，
 * 客户端构建会把它内联进 bundle。
 *
 * 版本口径（三条，别混）：
 *   · installed —— 真正装进 profile 的 package.json 版本（宿主读磁盘，唯一事实）
 *   · latest    —— 线上最新（多源取最大：GitHub Release / 主干 package.json / jsDelivr）
 *   · channel   —— 比谁：release=正式发布，main=主干
 */

/** 关于信息（版本 / 仓库 / 自更新能力） */
export const ABOUT_PATH = '/tuitui/im-tuitui/about';

/** 检查更新（?refresh=1 绕过缓存） */
export const UPDATE_CHECK_PATH = '/tuitui/im-tuitui/about/latest';

/** 一键更新（POST，仅 selfUpdate.enabled 时可用） */
export const UPDATE_APPLY_PATH = '/tuitui/im-tuitui/about/update';

/** 一键更新请求必须带的自定义头（挡掉同源页面里的顺手调用） */
export const UPDATE_REQUEST_HEADER = 'x-tuitui-self-update';

/** 仓库地址（设置页的 GitHub 入口） */
export const REPO_URL = 'https://github.com/EayonLee/dsh-tuitui-bot';

/** 仓库 owner/name */
export const REPO_SLUG = 'EayonLee/dsh-tuitui-bot';

/** 本包名（bundles / 依赖校验都用它） */
export const PACKAGE_NAME = '@eayonlee/dsh-tuitui-bot';

/** 对比更新的来源 */
export type UpdateChannel = 'release' | 'main';

/** 关于信息（GET ABOUT_PATH 的响应） */
export interface AboutWire {
  /** 包名 */
  name: string;
  /** 已安装版本（磁盘真值） */
  version: string;
  /** 仓库地址 */
  repoUrl: string;
  /** owner/name */
  repoSlug: string;
  /** 当前对比来源 */
  channel: UpdateChannel;
  /** 自更新能力 */
  selfUpdate: {
    /** 配置开关（默认关） */
    enabled: boolean;
    /** 宿主是否具备热重载能力（dsh-hmr） */
    hotReload: boolean;
    /** 不可用的原因（enabled=false 或没有 hmr） */
    reason?: string;
  };
  /** 运行环境 */
  runtime: {
    /** profile 目录（可能为空：极简宿主/单测） */
    profileDir?: string;
    /** pnpm 是否可用（决定能不能装） */
    packageManager: boolean;
  };
}

/** 检查更新结果（GET UPDATE_CHECK_PATH 的响应） */
export interface UpdateStatusWire {
  ok: boolean;
  /** 已安装版本 */
  current: string;
  /** 线上最新版本；查不到为 null */
  latest: string | null;
  /** latest > current */
  hasUpdate: boolean;
  /** current > latest（自己改过没发布，正常现象） */
  ahead: boolean;
  /** 版本取自哪个源 */
  source: string | null;
  /** 失败原因（ok=false 时） */
  error: string | null;
  /** 检查时间戳 */
  checkedAt: number;
  /** 是否命中缓存 */
  cached: boolean;
  channel: UpdateChannel;
}

/** 一键更新结果（POST UPDATE_APPLY_PATH 的响应） */
export interface UpdateApplyWire {
  ok: boolean;
  /** 更新前版本 */
  from: string;
  /** 更新后版本（失败时仍是 from） */
  to: string | null;
  /** 是否已经热重载（true = 不用重启） */
  hotReload: boolean;
  /** 是否必须重启才生效（hotReload=false 时的如实回答） */
  restartRequired: boolean;
  error?: string;
  /** 过程补充说明（装了什么源、回滚过没有） */
  detail?: string;
}
