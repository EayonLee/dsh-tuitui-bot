export function slashCommand(options = {}) {
    const prefixes = options.prefixes ?? ['/'];
    const catchErrors = options.catchErrors ?? true;
    const autoHelp = options.autoHelp ?? true;
    const allowFrom = options.allowFrom ?? [];
    const allowBareNameMatch = options.allowBareNameMatch ?? false;
    const log = options.logger;
    const registry = new Map();
    const register = (cmd) => {
        const names = [cmd.name, ...(cmd.aliases ?? []), ...(cmd.triggers ?? [])];
        if (!cmd.name)
            throw new Error('slash-command: name 不能为空');
        for (const name of names) {
            const key = name.toLowerCase();
            if (registry.has(key)) {
                throw new Error(`slash-command: 命令名重复 "${name}"`);
            }
            registry.set(key, cmd);
        }
    };
    const unregister = (name) => {
        registry.delete(name.toLowerCase());
    };
    /** 去重后列出所有命令（别名共享同一条声明，只列一次） */
    const list = () => {
        const seen = new Set();
        const out = [];
        for (const cmd of registry.values()) {
            if (seen.has(cmd))
                continue;
            seen.add(cmd);
            out.push(cmd);
        }
        return out;
    };
    for (const cmd of options.commands ?? []) {
        register(cmd);
    }
    // 自动 /help：仅在没有 help 时补一条，避免与 W5 的 /bot-help 重复
    if (autoHelp && !registry.has('help')) {
        register({
            name: 'help',
            description: '列出所有可用指令',
            handler: () => {
                const lines = ['可用指令：'];
                for (const cmd of list()) {
                    if (cmd.hidden)
                        continue;
                    const names = [cmd.name, ...(cmd.aliases ?? [])].join(' / ');
                    const usage = cmd.usage ? ` ${cmd.usage}` : '';
                    lines.push(`/${names}${usage}${cmd.description ? ` — ${cmd.description}` : ''}`);
                }
                return lines.join('\n');
            },
        });
    }
    /** 匹配到命令后的发送：兼容上游「handler 返回字符串」的写法 */
    async function sendCommandResult(ctx, result) {
        if (result === undefined || result === null)
            return;
        if (typeof result === 'string') {
            if (result)
                await ctx.bot.sendMarkdown(ctx.replyTarget, result);
            return;
        }
        if (typeof result === 'object' && result.kind === 'text' && result.content) {
            await ctx.bot.sendMarkdown(ctx.replyTarget, result.content);
        }
        // kind === 'noop' → 静默消费
    }
    const middleware = async (ctx, next) => {
        const raw = (ctx.message.content ?? '').trim();
        if (!raw) {
            await next();
            return;
        }
        // 全角斜杠是中文输入法下的常见误输入，先归一化再匹配
        const normalized = raw.replace(/^／/, '/');
        // 去掉开头的 @机器人：群里「@bot /status」是最自然的说话方式
        let cleaned = normalized;
        while (/^(?:\{\{\s*tuitui_at\s+"[^"]*"\s*\}\}|@\S+)[\s\u3000]*/.test(cleaned)) {
            cleaned = cleaned.replace(/^(?:\{\{\s*tuitui_at\s+"[^"]*"\s*\}\}|@\S+)[\s\u3000]*/, '');
        }
        cleaned = cleaned.trim();
        if (!cleaned) {
            await next();
            return;
        }
        const prefix = prefixes.find((p) => cleaned.startsWith(p));
        let name;
        let rest;
        let viaNativeTrigger = false;
        if (prefix) {
            const body = cleaned.slice(prefix.length);
            const match = /^(\S+)(?:\s+(.*))?$/.exec(body);
            if (!match) {
                await next();
                return;
            }
            name = match[1];
            rest = match[2] ?? '';
        }
        else {
            // 无前缀：只有快捷指令原生触发词（或显式开启的裸命令名）才算命令，
            // 否则群里任何一句「help」都会被吃掉。
            const candidate = registry.get(cleaned.toLowerCase());
            if (!candidate) {
                await next();
                return;
            }
            const isExplicitTrigger = (candidate.triggers ?? []).some((t) => t.toLowerCase() === cleaned.toLowerCase());
            const isBareName = allowBareNameMatch
                && [candidate.name, ...(candidate.aliases ?? [])].some((n) => n.toLowerCase() === cleaned.toLowerCase());
            if (!isExplicitTrigger && !isBareName) {
                await next();
                return;
            }
            name = candidate.name;
            rest = '';
            viaNativeTrigger = true;
        }
        const cmd = registry.get(name.toLowerCase());
        if (!cmd) {
            await next();
            return;
        }
        // 群聊 / 帖子：必须 @ 机器人（与上游一致）。快捷指令是显式点击，不需要 @。
        if (!viaNativeTrigger && (ctx.message.kind === 'group' || ctx.message.kind === 'post')) {
            if (ctx.message.atMe !== true) {
                await next();
                return;
            }
        }
        // 发送者白名单：未授权用户发来的「/xxx」按普通消息交给模型，不要静默吞掉
        const isAllowed = allowFrom.length === 0
            || allowFrom.includes('*')
            || allowFrom.includes(ctx.message.senderAccount)
            || allowFrom.includes(ctx.message.senderId);
        if (!isAllowed) {
            await next();
            return;
        }
        const parsed = {
            name: name.toLowerCase(),
            args: rest ? rest.split(/\s+/).filter(Boolean) : [],
            raw: rest,
        };
        ctx.state.command = parsed;
        // handler 需要在 ctx 上看到已解析命令：直接挂在同一个 ctx 上（与上游同做法），
        // 这样 handler 里调用 ctx.skip / 读写 state 都作用于同一条消息。
        const handlerCtx = Object.assign(ctx, { command: parsed });
        // 作用域限制
        const cmdScope = cmd.scope ?? 'all';
        if (cmdScope !== 'all' && cmdScope !== ctx.message.kind) {
            const hint = cmdScope === 'c2c'
                ? '该指令仅限私聊使用'
                : cmdScope === 'group' ? '该指令仅限群聊使用' : '该指令仅限团队频道使用';
            await sendCommandResult(ctx, hint);
            ctx.skip('command');
            return;
        }
        // 逐条命令的权限检查
        if (cmd.authorized) {
            const auth = cmd.authorized(handlerCtx);
            if (auth !== true) {
                await sendCommandResult(ctx, typeof auth === 'string' ? auth : '⚠️ 无权限执行此命令');
                ctx.skip('command');
                return;
            }
        }
        try {
            const result = await cmd.handler(handlerCtx);
            await sendCommandResult(ctx, result);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log?.error(`[slash-command] 命令 "${parsed.name}" 执行失败: ${message}`);
            if (!catchErrors) {
                ctx.skip('command');
                throw err;
            }
            await sendCommandResult(ctx, `⚠️ 命令执行失败：${message}`);
        }
        // 命中命令一律短路：命令已被消费，不再进入会话处理
        ctx.skip('command');
    };
    return Object.assign(middleware, { register, unregister, list });
}
//# sourceMappingURL=slash-command.js.map