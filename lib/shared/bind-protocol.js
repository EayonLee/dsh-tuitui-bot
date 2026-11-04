/**
 * 端内绑定协议 —— 宿主路由与客户端面板的共享契约
 *
 * 类型与路径常量的唯一事实源：宿主（setup/bind-routes.ts）与浏览器
 * （client/bind-page.ts）各自 import，杜绝两端协议漂移。
 * 本模块必须保持纯类型 + 纯常量（零 node 依赖、零副作用）：
 * 客户端 tsdown 构建会将其内联进 bundle。
 *
 * 推推无扫码绑定，凭据由用户在推推机器人后台创建后手填，
 * 因此状态机只有「未配置 / 校验中 / 校验失败 / 已绑定」四态。
 */
/** 状态查询（绑定页轮询 + 设置页回显） */
export const BIND_STATE_PATH = '/tuitui/im-tuitui/bind';
/** 手动填写/编辑凭据（绑定页表单） */
export const BIND_MANUAL_PATH = '/tuitui/im-tuitui/bind/manual';
/** 凭据在线校验（调用 property.info） */
export const BIND_VERIFY_PATH = '/tuitui/im-tuitui/bind/verify';
/** 解绑：移除已保存凭据，回到未配置状态 */
export const BIND_UNBIND_PATH = '/tuitui/im-tuitui/bind/unbind';
/** 配置读写（设置面板表单） */
export const BIND_CONFIG_PATH = '/tuitui/im-tuitui/config';
/** 图像理解 / 生成端点的连接测试（不回显密钥） */
export const TEST_MODEL_PATH = '/tuitui/im-tuitui/test-model';
//# sourceMappingURL=bind-protocol.js.map