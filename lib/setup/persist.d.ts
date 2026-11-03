/** 凭据结果 */
export interface SetupCredentials {
    appId: string;
    appSecret: string;
}
/**
 * 将凭据写入 dsh profile 的 cordis.patch.yml。
 *
 * 更新或追加 im-tuitui 条目的 appId/appSecret，其余内容（其他插件条目、
 * insert 行、注释、锚点、`!!js` 表达式）原样保留。文件不存在时安全重建。
 */
export declare function persistCredentialsToProfile(credentials: SetupCredentials, profileDir?: string, logger?: {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
}): boolean;
/**
 * 从 dsh profile 的 cordis.patch.yml 中移除已保存的凭据（解绑）。
 *
 * 保留 im-tuitui 条目的其余 config（requireMention 等用户配置）与其他所有
 * 条目。条目或字段不存在时仍强制写回一次——宿主 HMR 靠文件 mtime 触发
 * 重载，不写则 bound fiber 永不卸载，解绑后状态会停留在 bound。
 */
export declare function removeCredentialsFromProfile(profileDir?: string, logger?: {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
}): boolean;
/**
 * 将配置更新合并进 dsh profile 的 cordis.patch.yml（im-tuitui 条目）。
 *
 * 最小写入原则：只把「本次提交的键」合并进条目 config——
 * 不固化 bundle patch 的默认值（保持其版本演进的覆盖能力），
 * 不触碰已保存的凭据字段（appId/appSecret 由绑定/更换/解绑流程管理）。
 * 含点号的键（access.c2cMode 等）只写叶子，父对象的其他子项保持原样。
 * 写入触发 HMR 重载，新 fiber 以新配置启动。
 */
export declare function updateProfileConfig(configPatch: Record<string, unknown>, profileDir?: string, logger?: {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
}): boolean;
//# sourceMappingURL=persist.d.ts.map