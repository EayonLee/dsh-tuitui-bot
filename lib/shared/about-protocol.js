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
//# sourceMappingURL=about-protocol.js.map