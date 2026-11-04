/** 按作用域取策略；配置缺失时按作用域兜底（单聊打断、其余排队） */
export function resolveScopeStrategy(config, scope) {
    const configured = config.concurrency?.[scope];
    if (configured !== undefined)
        return configured;
    return scope === 'c2c' ? 'abort' : 'queue';
}
//# sourceMappingURL=concurrency.js.map