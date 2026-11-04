/** 按作用域取策略；配置缺失时按作用域兜底（单聊打断、其余排队） */
export function resolveScopeStrategy(config, scope) {
    const configured = config.concurrency?.[scope];
    if (configured !== undefined)
        return configured;
    // 兜底与 config 默认值保持一致：单聊 / 群聊攒着合并，帖子仍是排队
    return scope === 'post' ? 'queue' : 'merge';
}
//# sourceMappingURL=concurrency.js.map