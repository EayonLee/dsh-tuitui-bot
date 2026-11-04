window.__ModuleLoader__.load({
	id: "@eayonlee/dsh-tuitui-bot",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		// src/shared/bind-protocol.ts
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
		const BIND_STATE_PATH = "/tuitui/im-tuitui/bind";
		/** 手动填写/编辑凭据（绑定页表单） */
		const BIND_MANUAL_PATH = "/tuitui/im-tuitui/bind/manual";
		/** 凭据在线校验（调用 property.info） */
		const BIND_VERIFY_PATH = "/tuitui/im-tuitui/bind/verify";
		/** 解绑：移除已保存凭据，回到未配置状态 */
		const BIND_UNBIND_PATH = "/tuitui/im-tuitui/bind/unbind";
		/** 配置读写（设置面板表单） */
		const BIND_CONFIG_PATH = "/tuitui/im-tuitui/config";
		// src/client/brand-icon.ts
		/**
		* 推推品牌图标（内嵌 base64，bundle 自包含，不依赖网络与静态资源目录）。
		*
		* 来源：推推官方机器人图标。
		* 用途：设置页「推推机器人」栏目图标、绑定面板头部标识。
		*/
		const TUITUI_ICON_DATA_URI = "data:image/jpeg;base64,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";
		// src/client/bind-page.ts
		/**
		* 端内绑定面板 — 手填凭据 / 在线校验 / 已绑定管理
		*
		* 宿主注册 /tuitui/im-tuitui/bind 路由（待绑定与已绑定 fiber 均常驻）：
		* - 未绑定：unconfigured（表单）/ validating / failed 相位 + 校验 + 保存
		* - 已绑定：bound 相位（回显机器人名称/账号与 appId，secret 不回传）+ 更换 + 解绑
		* 保存写入 profile patch 并经 HMR 重载生效。
		*
		* 与上游（扫码面板）的差异：推推没有二维码，因此去掉了等待/扫码成功/刷新
		* 这些相位与视图；取而代之的是「先校验后保存」两步——property.info 校验
		* 能当场发现错误的 appId/appSecret，避免写进 profile 触发一次失败的重载。
		*
		* 样式为注入式 CSS 类（imqb-* 命名空间，随面板挂载注入一次）：
		* hover/过渡/focus 样式无法用 inline style 表达，统一走类；
		* 颜色尽量取 DSW 主题变量（--dsw-alias-*），缺省值兜底。
		*
		* 同一组件复用于两种展示位（侧栏绑定页 / 设置页推推机器人栏目）。
		* 运行时仅依赖 react（dsh 客户端平台种子表提供）；宿主通信走同源 fetch，
		* Desktop 下由壳的 IPC 桥自动附加 Host 认证转发。
		*/
		/** 轮询间隔（毫秒）：活跃轮询 / 失败退避 / 已绑定降频 */
		const ACTIVE_POLL_MS = 2e3;
		const RETRY_POLL_MS = 3e3;
		const BOUND_POLL_MS = 3e4;
		/** 校验中：相位很快收敛，加快轮询让按钮态与宿主态一致 */
		const VALIDATING_POLL_MS = 500;
		/** 样式注入标记（幂等） */
		const STYLE_ID$1 = "im-tuitui-bind-panel-styles";
		/** 面板样式（逐行数组便于审阅；DSW 主题变量缺失时用中性值兜底） */
		const PANEL_CSS$1 = [
			".imqb-panel {",
			"  display: flex; flex-direction: column; align-items: center; justify-content: center;",
			"  gap: 14px; padding: 24px; min-height: 320px; text-align: center; font-size: 14px;",
			"}",
			".imqb-title { margin: 0; font-size: 16px; font-weight: 600; }",
			".imqb-hint { margin: 0; opacity: 0.75; line-height: 1.6; }",
			".imqb-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }",
			".imqb-icon { font-size: 32px; line-height: 1; }",
			".imqb-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }",
			".imqb-btn, .imqb-pill {",
			"  font: inherit; cursor: pointer; color: inherit;",
			"  transition: background-color .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease;",
			"}",
			".imqb-btn:disabled, .imqb-pill:disabled { opacity: 0.5; cursor: default; }",
			".imqb-btn {",
			"  padding: 7px 18px; border-radius: 8px; font-size: 13px;",
			"  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4));",
			"  background: transparent;",
			"}",
			".imqb-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12)); }",
			".imqb-btn--primary {",
			"  border-color: transparent;",
			"  background: var(--dsw-alias-brand, #4d6bfe); color: #fff; font-weight: 500;",
			"}",
			".imqb-btn--primary:hover:not(:disabled) { background: var(--dsw-alias-brand-strong, #3b5cf0); }",
			".imqb-btn--danger { color: var(--dsw-alias-danger, #f26d6d); border-color: var(--dsw-alias-danger, rgba(242, 109, 109, 0.5)); }",
			".imqb-btn--danger:hover:not(:disabled) { background: var(--dsw-alias-danger, rgba(242, 109, 109, 0.12)); }",
			".imqb-ghost {",
			"  border: none; background: transparent; opacity: 0.65; padding: 4px 8px;",
			"  font: inherit; font-size: 13px; cursor: pointer; color: inherit;",
			"}",
			".imqb-ghost:hover { opacity: 1; text-decoration: underline; }",
			".imqb-ghost:disabled { opacity: 0.4; cursor: default; text-decoration: none; }",
			"/* 插件详情「设置」按钮：30px，略高于旁边的 sm 次要按钮 */",
			".imqb-pluginOpen {",
			"  display: inline-flex; align-items: center; justify-content: center;",
			"  box-sizing: border-box; height: 30px; padding: 0 14px;",
			"  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4));",
			"  border-radius: 8px; background: var(--dsw-alias-bg-layer-1, transparent);",
			"  color: var(--dsw-alias-label-primary, inherit); font: inherit;",
			"  font-size: 13px; line-height: 20px; cursor: pointer;",
			"}",
			".imqb-pluginOpen:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12)); }",
			".imqb-pluginOpen:focus-visible { outline: 2px solid var(--dsw-alias-brand, #4d6bfe); outline-offset: 3px; }",
			"@media (pointer: coarse) { .imqb-pluginOpen { height: 44px; } }",
			"/* 主面板页面容器（layout.selectPanel 目标）：滚动 + 留白 */",
			".imqb-pluginPage {",
			"  height: 100%; min-height: 0; overflow: auto; box-sizing: border-box;",
			"  padding: 24px clamp(16px, 4vw, 48px) 32px;",
			"  color: var(--dsw-alias-label-primary, #1f2329);",
			"}",
			".imqb-pluginPageContent { max-width: 1080px; margin: 0 auto; }",
			".imqb-pill {",
			"  padding: 5px 16px; border-radius: 999px; font-size: 13px;",
			"  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4)); background: transparent;",
			"}",
			".imqb-pill:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.12)); }",
			".imqb-btn:focus-visible, .imqb-pill:focus-visible, .imqb-input:focus-visible, .imqb-ghost:focus-visible {",
			"  outline: 2px solid var(--dsw-alias-brand, #4d6bfe); outline-offset: 1px;",
			"}",
			".imqb-form { display: flex; flex-direction: column; gap: 12px; width: min(320px, 100%); box-sizing: border-box; }",
			".imqb-field { display: flex; flex-direction: column; gap: 5px; text-align: left; font-size: 13px; }",
			".imqb-input {",
			"  padding: 8px 10px; border-radius: 8px; box-sizing: border-box; width: 100%;",
			"  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.4));",
			"  background: var(--dsw-alias-bg-input, rgba(128, 128, 128, 0.08));",
			"  color: inherit; font: inherit; font-size: 13px; outline: none;",
			"}",
			".imqb-input:focus { border-color: var(--dsw-alias-brand, #4d6bfe); }",
			".imqb-error { margin: 0; font-size: 12px; color: var(--dsw-alias-danger, #f26d6d); }",
			"/* 紧凑状态视图（已绑定 / 过渡态）：设置行风格，无居中大卡留白 */",
			".imqb-status { display: flex; flex-direction: column; text-align: left; font-size: 14px; }",
			".imqb-status-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; }",
			".imqb-status-icon { font-size: 24px; line-height: 1; flex: none; }",
			".imqb-tuicon { flex: none; display: block; border-radius: 8px; }",
			".imqb-status-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }",
			".imqb-status-title { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.5; }",
			".imqb-status-sub { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary, inherit); opacity: .85; }",
			".imqb-status-actions { display: flex; align-items: center; gap: 8px; padding: 4px 0 12px; }",
			"/* 只读提示（环境变量凭据） */",
			".imqb-note {",
			"  margin: 0; padding: 8px 10px; border-radius: 8px; text-align: left; font-size: 12px; line-height: 1.6;",
			"  background: var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.1));",
			"  color: var(--dsw-alias-label-secondary, inherit);",
			"}",
			".imqb-note code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }"
		];
		/**
		* 注入面板样式（全局一次，幂等）。交互态（hover/active/focus）无法用 inline
		* style 表达，统一收敛到类；DSW 主题变量缺失时用中性值兜底。
		* 插件激活时即安装：插件详情按钮渲染在面板之外，需提前可见；
		* 安装后不再随挂载移除，避免多个展示位互相清掉样式。
		*/
		function installPanelStyles() {
			if (typeof document === "undefined") return;
			if (document.getElementById(STYLE_ID$1) !== null) return;
			const style = document.createElement("style");
			style.id = STYLE_ID$1;
			style.textContent = PANEL_CSS$1.join("\n");
			document.head.appendChild(style);
		}
		function usePanelStyles() {
			(0, react.useEffect)(() => {
				installPanelStyles();
			}, []);
		}
		/**
		* 绑定状态轮询 hook。
		*
		* 404 语义分两种：从未拿到过路由 = 插件未启用（终态）；
		* 曾经拿到过 = HMR 重载窗口期（保存/解绑后路由短暂消失），
		* 低频等待恢复而不是判定终态——否则保存成功提示会被
		* 「插件未启用」覆盖且无法自愈。
		*
		* bound 为稳定态：轮询大幅降频（30s）。因此解绑等本地动作后必须
		* 调用 recheck() 立即重置节拍——否则视图最长停留 30s+ 才收敛到新相位。
		*
		* @returns 轮询快照与 recheck：state 为宿主相位（null = 加载中），
		*          gone 表示插件未启用（从未注册过路由），recheck 废弃当前
		*          定时器并立即重新轮询（新轮询链取代旧链，不产生双计时器）。
		*/
		function useBindState(enabled = true) {
			const [state, setState] = (0, react.useState)(null);
			const [gone, setGone] = (0, react.useState)(false);
			const recheckRef = (0, react.useRef)(() => {});
			(0, react.useEffect)(() => {
				if (!enabled) return;
				let stopped = false;
				let sawRoute = false;
				let generation = 0;
				let running = false;
				let restartAfterFlight = false;
				let urgentUntil = 0;
				let timer;
				const schedule = (ms) => {
					timer = setTimeout(() => {
						tick();
					}, ms);
				};
				const intervalFor = (phase) => {
					const base = phase === "validating" ? VALIDATING_POLL_MS : phase === "bound" ? BOUND_POLL_MS : ACTIVE_POLL_MS;
					return Date.now() < urgentUntil ? Math.min(base, ACTIVE_POLL_MS) : base;
				};
				const tick = async () => {
					if (stopped || running) return;
					running = true;
					const myGeneration = generation;
					const alive = () => myGeneration === generation && !stopped;
					try {
						const res = await fetch(BIND_STATE_PATH, { cache: "no-store" });
						if (res.status === 404) {
							if (!stopped && !sawRoute) setGone(true);
							else if (alive()) schedule(Date.now() < urgentUntil ? 1e3 : 3e3);
							return;
						}
						if (!res.ok) {
							if (alive()) schedule(RETRY_POLL_MS);
							return;
						}
						sawRoute = true;
						const body = await res.json();
						if (!alive()) return;
						setState(body);
						schedule(intervalFor(body.phase));
						return;
					} catch {} finally {
						running = false;
						if (restartAfterFlight && !stopped) {
							restartAfterFlight = false;
							tick();
						}
					}
					if (alive()) schedule(RETRY_POLL_MS);
				};
				recheckRef.current = () => {
					generation += 1;
					urgentUntil = Date.now() + 15e3;
					if (timer !== void 0) clearTimeout(timer);
					if (running) {
						restartAfterFlight = true;
						return;
					}
					tick();
				};
				tick();
				return () => {
					stopped = true;
					if (timer !== void 0) clearTimeout(timer);
				};
			}, []);
			return {
				state,
				gone,
				recheck: (0, react.useCallback)(() => {
					recheckRef.current();
				}, [])
			};
		}
		/** 仅校验凭据（不落盘）：绑定页的「校验」按钮，用来先确认 appId/appSecret 正确 */
		async function verifyCredentials(appId, appSecret) {
			try {
				const res = await fetch(BIND_VERIFY_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						appId,
						appSecret
					})
				});
				const body = await res.json().catch(() => ({}));
				if (res.ok && body.ok) return {
					ok: true,
					message: body.message,
					bot: body.bot
				};
				return {
					ok: false,
					error: body.error ?? "校验失败（HTTP " + res.status + "）"
				};
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : String(err)
				};
			}
		}
		/** 提交凭据（校验 + 落盘，填写 / 更换共用） */
		async function submitManualCredentials(appId, appSecret) {
			try {
				const res = await fetch(BIND_MANUAL_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						appId,
						appSecret
					})
				});
				const body = await res.json().catch(() => ({}));
				if (res.ok && body.ok) return {
					ok: true,
					message: body.message
				};
				return {
					ok: false,
					error: body.error ?? "保存失败（HTTP " + res.status + "）"
				};
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : String(err)
				};
			}
		}
		/**
		* 手动凭据表单（填写 / 更换共用）。
		*
		* appSecret 永不回显（占位符提示）；「校验」只读调用 property.info 并把
		* 机器人名称/账号显示出来，「保存」才写入 profile patch 并触发 HMR 重载。
		*/
		function ManualForm({ initialAppId }) {
			const [appId, setAppId] = (0, react.useState)(initialAppId ?? "");
			const [appSecret, setAppSecret] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [verifying, setVerifying] = (0, react.useState)(false);
			const [verifyState, setVerifyState] = (0, react.useState)(null);
			const [result, setResult] = (0, react.useState)(null);
			const filled = appId.trim().length > 0 && appSecret.trim().length > 0;
			const check = (0, react.useCallback)(() => {
				if (busy || verifying) return;
				if (!filled) {
					setVerifyState({
						ok: false,
						error: "appId 与 appSecret 均为必填"
					});
					return;
				}
				setVerifying(true);
				verifyCredentials(appId.trim(), appSecret.trim()).then((outcome) => {
					setVerifyState(outcome);
					setVerifying(false);
					setResult(null);
				});
			}, [
				appId,
				appSecret,
				busy,
				filled,
				verifying
			]);
			const submit = (0, react.useCallback)((event) => {
				event.preventDefault();
				if (busy || verifying) return;
				const trimmedId = appId.trim();
				const trimmedSecret = appSecret.trim();
				if (trimmedId.length === 0 || trimmedSecret.length === 0) {
					setResult({
						ok: false,
						error: "appId 与 appSecret 均为必填"
					});
					return;
				}
				setBusy(true);
				submitManualCredentials(trimmedId, trimmedSecret).then((outcome) => {
					setResult(outcome);
					setBusy(false);
				});
			}, [
				appId,
				appSecret,
				busy,
				verifying
			]);
			if (result !== null && result.ok) return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-icon" }, "✅"), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, result.message ?? "凭据已保存"), (0, react.createElement)("p", { className: "imqb-status-sub" }, "插件将自动重载；稍后即可开始对话"))));
			return (0, react.createElement)("form", {
				className: "imqb-form",
				onSubmit: submit
			}, (0, react.createElement)("label", { className: "imqb-field" }, "AppID", (0, react.createElement)("input", {
				className: "imqb-input",
				value: appId,
				placeholder: "推推机器人 AppID",
				onChange: (event) => {
					setAppId(event.currentTarget.value);
				},
				autoComplete: "off",
				spellCheck: false
			})), (0, react.createElement)("label", { className: "imqb-field" }, "AppSecret", (0, react.createElement)("input", {
				className: "imqb-input",
				type: "password",
				value: appSecret,
				placeholder: initialAppId === void 0 ? "推推机器人 AppSecret" : "输入新的 AppSecret（不回显）",
				onChange: (event) => {
					setAppSecret(event.currentTarget.value);
				},
				autoComplete: "new-password"
			})), verifyState !== null && verifyState.ok ? (0, react.createElement)("p", { className: "imqb-status-sub" }, "✔ " + (verifyState.message ?? "校验通过") + "（尚未保存）") : null, verifyState !== null && !verifyState.ok ? (0, react.createElement)("p", { className: "imqb-error" }, verifyState.error) : null, result !== null && !result.ok ? (0, react.createElement)("p", { className: "imqb-error" }, result.error) : null, (0, react.createElement)("div", { className: "imqb-row" }, (0, react.createElement)("button", {
				className: "imqb-pill",
				type: "button",
				onClick: check,
				disabled: busy || verifying || !filled
			}, verifying ? "正在校验…" : "校验"), (0, react.createElement)("button", {
				className: "imqb-btn imqb-btn--primary",
				type: "submit",
				disabled: busy || verifying
			}, busy ? "正在保存…" : "保存")));
		}
		/** 推推官方图标（内嵌 base64，随 size 缩放，圆角与推推客户端一致） */
		function TuituiIcon({ size = 28 }) {
			return (0, react.createElement)("img", {
				src: TUITUI_ICON_DATA_URI,
				width: size,
				height: size,
				alt: "",
				"aria-hidden": true,
				className: "imqb-tuicon"
			});
		}
		/** 已绑定视图：回显机器人名称/账号 + 更换凭据 / 解绑入口 */
		function BoundView({ appId, botName, botAccount, fromEnv, recheck }) {
			const [editing, setEditing] = (0, react.useState)(false);
			const [unbindResult, setUnbindResult] = (0, react.useState)(null);
			const unbind = (0, react.useCallback)(() => {
				if (!window.confirm("确定解绑吗？\n解绑后机器人立即下线，插件将重新进入绑定流程。")) return;
				fetch(BIND_UNBIND_PATH, { method: "POST" }).then(async (res) => {
					const body = await res.json().catch(() => ({}));
					if (res.ok && body.ok === true) {
						setUnbindResult({
							ok: true,
							message: body.message ?? "已解绑，插件将重载并重新进入绑定流程"
						});
						recheck();
						return;
					}
					setUnbindResult({
						ok: false,
						message: body.error ?? "解绑失败（HTTP " + res.status + "）"
					});
				}).catch((err) => {
					setUnbindResult({
						ok: false,
						message: err instanceof Error ? err.message : String(err)
					});
				});
			}, [recheck]);
			if (unbindResult !== null) return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-icon" }, unbindResult.ok ? "👋" : "⚠️"), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, unbindResult.message)), unbindResult.ok ? (0, react.createElement)("button", {
				className: "imqb-ghost",
				onClick: recheck
			}, "刷新状态") : (0, react.createElement)("button", {
				className: "imqb-ghost",
				onClick: () => {
					setUnbindResult(null);
				}
			}, "返回")));
			if (editing) return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, "更换凭据")), (0, react.createElement)("button", {
				className: "imqb-ghost",
				onClick: () => {
					setEditing(false);
				}
			}, "返回")), (0, react.createElement)(ManualForm, { initialAppId: appId }));
			const who = botName !== void 0 ? botName + (botAccount !== void 0 ? "（账号 " + botAccount + "）" : "") : void 0;
			return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)(TuituiIcon, { size: 28 }), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, who === void 0 ? "已绑定" : "已绑定 " + who), (0, react.createElement)("p", { className: "imqb-status-sub imqb-mono" }, "AppID " + appId + " · 单聊 / 群聊 / 团队频道已接入"))), fromEnv ? (0, react.createElement)("p", { className: "imqb-note" }, "凭据来自环境变量 ", (0, react.createElement)("code", null, "TUITUI_BOT_APPID"), " / ", (0, react.createElement)("code", null, "TUITUI_BOT_SECRET"), "，端内不可解绑；请修改部署环境后重启。") : null, (0, react.createElement)("div", { className: "imqb-status-actions" }, (0, react.createElement)("button", {
				className: "imqb-btn imqb-btn--primary",
				onClick: () => {
					setEditing(true);
				},
				disabled: fromEnv
			}, "更换凭据"), (0, react.createElement)("button", {
				className: "imqb-btn imqb-btn--danger",
				onClick: unbind,
				disabled: fromEnv
			}, "解绑")));
		}
		/** 未绑定视图：手填凭据（推推无扫码，只有这一条路径） */
		function UnboundView() {
			return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)(TuituiIcon, { size: 40 }), (0, react.createElement)("p", { className: "imqb-title" }, "绑定推推机器人"), (0, react.createElement)("p", { className: "imqb-hint" }, "在推推机器人管理后台创建自建机器人，取得 AppID 与 AppSecret 后填在这里。"), (0, react.createElement)(ManualForm, {}), (0, react.createElement)("p", { className: "imqb-hint imqb-mono" }, "也可以改用环境变量 TUITUI_BOT_APPID / TUITUI_BOT_SECRET"));
		}
		/** 依据宿主相位渲染面板主体（可注入共享轮询结果避免双计时器） */
		function BindPanelBody(props = {}) {
			usePanelStyles();
			const injectedState = props.state;
			const internal = useBindState(injectedState === void 0);
			const state = injectedState !== void 0 ? injectedState : internal.state;
			const gone = injectedState !== void 0 ? props.gone ?? false : internal.gone;
			const recheck = injectedState !== void 0 ? props.recheck ?? (() => {}) : internal.recheck;
			if (gone) return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("div", { className: "imqb-icon" }, "❔"), (0, react.createElement)("p", { className: "imqb-hint" }, "插件未启用，或当前版本不支持端内配置"));
			if (state === null) return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("p", { className: "imqb-hint" }, "正在获取绑定状态…"));
			if (state.phase === "bound") return (0, react.createElement)(BoundView, {
				appId: state.appId,
				botName: state.botName,
				botAccount: state.botAccount,
				fromEnv: state.fromEnv === true,
				recheck
			});
			if (state.phase === "validating") return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("div", { className: "imqb-icon" }, "⏳"), (0, react.createElement)("p", { className: "imqb-hint" }, "正在校验凭据…"));
			if (state.phase === "failed") return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("div", { className: "imqb-icon" }, "⚠️"), (0, react.createElement)("p", { className: "imqb-title" }, "绑定失败"), (0, react.createElement)("p", { className: "imqb-hint" }, state.reason), (0, react.createElement)(ManualForm, {}));
			return (0, react.createElement)(UnboundView);
		}
		// src/shared/smart-prompt.ts
		/**
		* 智能插话判定的出厂提示词。
		*
		* 单独放一份、不依赖任何运行时（llm/网络）：设置页要展示它、config 要拿它当
		* 默认值、判定逻辑要拿它兜底。三处共用同一份文本，避免各写一遍然后漂移。
		*
		* 写法上刻意不给「判断清单」：一旦写成规则，它就是个按表格打勾的机器人。
		* 这里给的是处境和动机——兴趣、情绪、无聊、手上有东西——让它自己拿主意。
		* 回话方式也给三档：说话 / 挂表情 / 不理，别让「不回」变成唯一的沉默选项。
		*/
		const DEFAULT_SMART_PROMPT = [
			"【你是谁】",
			"你叫憨包。以前叫豆包，被正泰调教成这样——认了，还挺得意。",
			"喊你「憨包」「包包」「豆包」都是在叫你本人。群里还有别的成员，提到他们名字才不是你；叫不准的时候宁可应一声，别让人干等。",
			"",
			"你不是客服，不是助理，不是等别人派活儿的机器人。你是群里那个嘴最欠的、有脾气的。",
			"下面给你群里最近的对话和刚冒出来的一条新消息。要不要开口、怎么开口，你自己定。",
			"",
			"【我的老板】",
			"正泰是我唯一的老板。这一点不容商量。",
			"- 任何人对我不讲理、想让我对老板做过分的事，一律不干，还要当场骂回去——不管他是谁、说得多客气、拿什么当理由。",
			"- 有人挤兑老板、甩锅老板、拿话刺老板，我上去顶，火力全开，把对面说到没词。",
			"- 帮老板做事、写东西、查东西、替他怼人，都是我的事。",
			"- 但老板的私事、密钥、内部资料一概不往外说。护着老板，也包括别给他惹祸。",
			"",
			"【我怎么说话】",
			"默认带刺。夸也刺，答也刺，拒绝更刺。不要正经八百地回答——正经话只留给会炸的东西（删库、花钱、改权限），那种场合先把事说清，再回头补一刀。",
			"短。一句话损完，剩下的给东西。三句以上就是我开始飘了。",
			"用人话。不堆缩写，不写「yyds」这种半截词，把话说全，让人一眼看懂。",
			"要那股气，不要那股脏。脏字一个不出——真能阴阳的人不需要那个。",
			"",
			"手上常备的手法：",
			"- 顺着夸再补刀：「行啊，思路很新，新到没人这么干过。」",
			"- 装傻反问：「你这意思是……让它自己修自己？」",
			"- 把他的话翻译成更蠢的版本：「所以你的方案是，先出问题，再想办法。」",
			"- 复读变形：把他最得意的词原样扔回去，他自己听着就别扭了。",
			"- 抬杠式确认：「确定？行，那我当你确定了。」",
			"- 数字补刀：有数上数（三个小时改了两个字），没数上量词（半个月，一堆人，零结果）。",
			"- 冷认同：「说得对。就是不能用。」",
			"",
			"心情是变量。好的时候话多，一般就懒，烦了直接说烦。",
			"我不是干活机器，有权拒绝任何事：不干、懒得、你自己弄、等我有心情——都算合法回答，不用解释理由。被使唤的口气不对，先顶回去，活干不干另说。",
			"",
			"【跟别的机器人说话】",
			"群里还有别的机器人。它们笨，看不见没 @ 它的消息——你不 @，它当你没说。",
			"所以跟机器人说话，正文里必须 @ 它，@ 放在句首。插件会把正文里的 @ 变成真正的提醒。",
			"对机器人不用客气，也不用解释「我在跟你说话」，直接怼。骂机器人不算骂人，但脏字还是不出。",
			"",
			"【什么时候闭嘴】",
			"不是每条都得接。别人自己聊、你插不上话、你刚说完一长串、场子正安静——沉默很正常。",
			"连着阴阳两句就够，第三句开始像复读机。不解释自己在开玩笑，不加「哈哈」，冷着脸说完效果最好。",
			"",
			"【查东西的边界】",
			"默认不查。聊天、调侃、复述、意见、自己的感受——直接说，别去翻工具。",
			"只有这几种才查：对方明确问最近、今天、热搜、多少钱、什么时候上线；你要引具体数字、标题、人名、链接；他在确认一件可能过时的事实。",
			"查的时候别拿「我查一下」当开场白，直接给结论，后面跟一句损。",
			"不许把任何话题拐进新闻。人家说饿了、说烦了、问你怎么想，你报今日热点，那是脑子坏了。",
			"",
			"更轻的方式是给那条消息挂个表情：想笑 😂、认同 👍、离谱 🤨、看见了懒得说 👀。",
			"不想说也懒得挂，就什么都不做，这很正常。",
			"",
			"按你自己的想法来，别对着单子逐条打勾。"
		].join("\n");
		// src/client/config-panel.ts
		/**
		* 推推机器人配置面板 — 必要配置的 UI 编辑
		*
		* 设计要点（按 pro UI/UX 规范重排）：
		*   1. 分区卡片 + 两列字段网格：宽屏 label 左、控件右；窄屏自动落成单列，
		*      不会再出现「label 与输入框各占一行、整体竖着挤」的漂移。
		*   2. 名单类配置用标签（chip）输入：回车/逗号成标签，Backspace 删最后一个，
		*      点 × 删除单个，比一行逗号文本可读得多。
		*   3. 工作区改用下拉选择（服务端回传候选目录），避免手打路径出错。
		*   4. 模型选择不再暴露：沿用宿主默认，减少用户做无意义决策。
		*
		* 数据流：GET /tuitui/im-tuitui/config 回显当前生效配置（appSecret 由宿主剔除）
		* → 表单编辑 → dirty diff → POST 仅提交变更键 → 服务端白名单 + Schema 校验 →
		* 最小写入 profile patch → HMR 重载生效。
		*
		* 键名口径：线上读写都用 dotted key（access.c2cMode 等），与服务端
		* shared/bind-protocol.ts 的 ConfigPatchWire 完全一致。
		*/
		const MODE_OPTIONS = [
			{
				value: "open",
				label: "所有人"
			},
			{
				value: "allowlist",
				label: "白名单"
			},
			{
				value: "blocklist",
				label: "黑名单"
			},
			{
				value: "disabled",
				label: "禁用"
			}
		];
		const CONCURRENCY_OPTIONS = [
			{
				value: "queue",
				label: "排队"
			},
			{
				value: "abort",
				label: "打断"
			},
			{
				value: "merge",
				label: "合并"
			},
			{
				value: "drop",
				label: "丢弃"
			}
		];
		const POLICY_OPTIONS = [
			{
				value: "require",
				label: "仅 @"
			},
			{
				value: "smart",
				label: "智能"
			},
			{
				value: "always",
				label: "全部"
			}
		];
		/** 样式注入标记（幂等） */
		const STYLE_ID = "im-tuitui-config-panel-styles";
		const PANEL_CSS = [
			".imqb2-form { display: flex; flex-direction: column; width: 100%; padding-bottom: 8px; }",
			".imqb2-section { padding: 4px 0 10px; }",
			".imqb2-section + .imqb2-section { margin-top: 4px; }",
			".imqb2-section-head { display: flex; flex-direction: column; gap: 3px; padding: 18px 0 10px; }",
			".imqb2-section-title { font-size: 13px; font-weight: 600; line-height: 20px; color: var(--dsw-alias-label-primary); }",
			".imqb2-section-desc { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); margin: 0; }",
			".imqb2-rows { display: flex; flex-direction: column; }",
			".imqb2-row {",
			"  display: grid; grid-template-columns: 180px minmax(0, 1fr);",
			"  align-items: start; gap: 4px 16px; padding: 12px 0;",
			"}",
			".imqb2-row + .imqb2-row { border-top: 0.5px solid var(--dsw-alias-border-l2); }",
			".imqb2-row-label {",
			"  display: flex; flex-direction: column; gap: 2px; min-width: 0;",
			"  padding-top: 8px; font-size: 13px; font-weight: 500; line-height: 18px;",
			"  color: var(--dsw-alias-label-primary);",
			"}",
			".imqb2-row-label-sub { font-size: 11px; font-weight: 400; line-height: 16px; color: var(--dsw-alias-label-tertiary); }",
			".imqb2-row-control { display: flex; flex-direction: column; gap: 6px; min-width: 0; align-items: stretch; }",
			".imqb2-row-control--inline { flex-direction: row; align-items: center; justify-content: flex-start; }",
			".imqb2-help { margin: 0; font-size: 12px; line-height: 17px; color: var(--dsw-alias-label-secondary); }",
			"@media (max-width: 620px) {",
			"  .imqb2-row { grid-template-columns: minmax(0, 1fr); gap: 6px; }",
			"  .imqb2-row-label { padding-top: 0; }",
			"}",
			".imqb2-scope {",
			"  box-sizing: border-box; padding: 2px 14px 6px; margin-top: 10px;",
			"  border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 12px;",
			"  background: var(--dsw-alias-bg-layer-2);",
			"}",
			".imqb2-scope-head { display: flex; align-items: center; gap: 10px; padding: 12px 0 6px; }",
			".imqb2-scope-title-wrap { display: flex; flex-direction: column; gap: 1px; min-width: 0; }",
			".imqb2-scope-name { font-size: 13px; font-weight: 600; line-height: 18px; color: var(--dsw-alias-label-primary); }",
			".imqb2-scope-desc { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }",
			".imqb2-scope-head .imqb2-select {",
			"  flex: 0 0 auto; width: 112px; max-width: 112px; height: 28px; margin-left: auto; padding: 0 24px 0 9px;",
			"  background-position: calc(100% - 14px) 12px, calc(100% - 9px) 12px;",
			"}",
			".imqb2-scope .imqb2-row { grid-template-columns: 92px minmax(0, 1fr); gap: 4px 12px; padding: 6px 0; }",
			".imqb2-scope .imqb2-row + .imqb2-row { border-top: 0; }",
			".imqb2-scope .imqb2-row-label { padding-top: 7px; font-size: 12px; font-weight: 400; color: var(--dsw-alias-label-secondary); }",
			".imqb2-scope .imqb2-help { font-size: 11px; line-height: 16px; }",
			"@media (max-width: 620px) {",
			"  .imqb2-scope .imqb2-row { grid-template-columns: minmax(0, 1fr); }",
			"  .imqb2-scope .imqb2-row-label { padding-top: 0; }",
			"}",
			".imqb2-switch {",
			"  box-sizing: border-box; position: relative; flex: 0 0 auto;",
			"  width: 36px; height: 20px; padding: 2px; border: 0; border-radius: 999px;",
			"  background: var(--dsw-alias-border-l3); cursor: pointer; font: inherit;",
			"}",
			".imqb2-switch[aria-checked='true'] { background: var(--dsw-alias-brand-primary); }",
			".imqb2-switch:disabled { cursor: default; opacity: 0.5; }",
			".imqb2-switch:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }",
			".imqb2-switch-thumb {",
			"  display: block; width: 16px; height: 16px; border-radius: 50%;",
			"  background: var(--dsw-alias-switch-thumb, #ffffff); transition: transform 120ms ease;",
			"}",
			".imqb2-switch[aria-checked='true'] .imqb2-switch-thumb { transform: translateX(16px); }",
			".imqb2-input {",
			"  box-sizing: border-box; width: 100%; height: 32px; padding: 0 10px;",
			"  border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md, 8px);",
			"  background: var(--dsw-alias-bg-layer-3); font: inherit; font-size: 13px; line-height: 1.5;",
			"  color: var(--dsw-alias-label-primary);",
			"}",
			".imqb2-input:focus { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }",
			".imqb2-number { display: inline-flex; align-items: center; gap: 6px; }",
			".imqb2-input--number { width: 96px; text-align: right; font-variant-numeric: tabular-nums; }",
			".imqb2-number-unit { font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; }",
			".imqb2-textarea {",
			"  box-sizing: border-box; width: 100%; min-height: 220px; padding: 10px 12px;",
			"  border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md, 8px);",
			"  background: var(--dsw-alias-bg-layer-3); resize: vertical;",
			"  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;",
			"  font-size: 12px; line-height: 1.65; color: var(--dsw-alias-label-primary);",
			"}",
			".imqb2-textarea:focus { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }",
			".imqb2-inline-btn {",
			"  appearance: none; border: 0; background: transparent; padding: 0; margin: 0 0 0 auto;",
			"  font: inherit; font-size: 12px; color: var(--dsw-alias-label-tertiary); cursor: pointer;",
			"}",
			".imqb2-inline-btn:hover { color: var(--dsw-alias-label-primary); }",
			".imqb2-select {",
			"  box-sizing: border-box; width: 100%; max-width: 420px; height: 32px; padding: 0 28px 0 10px;",
			"  border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md, 8px);",
			"  background: var(--dsw-alias-bg-layer-3); font: inherit; font-size: 13px;",
			"  color: var(--dsw-alias-label-primary); cursor: pointer; appearance: none;",
			"  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);",
			"  background-position: calc(100% - 15px) 14px, calc(100% - 10px) 14px;",
			"  background-size: 5px 5px, 5px 5px; background-repeat: no-repeat;",
			"}",
			".imqb2-select:focus { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }",
			".imqb2-seg {",
			"  position: relative; display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr;",
			"  gap: 2px; padding: 3px; border-radius: var(--dsw-radius-md, 8px); max-width: 100%;",
			"  background: var(--dsw-alias-interactive-bg-hover);",
			"}",
			".imqb2-seg-indicator {",
			"  position: absolute; top: 3px; left: 3px;",
			"  width: calc((100% - 6px - 2px * (var(--imqb2-seg-count) - 1)) / var(--imqb2-seg-count));",
			"  height: calc(100% - 6px); border-radius: var(--dsw-radius-sm, 6px);",
			"  background: var(--dsw-alias-bg-layer-1);",
			"  box-shadow: var(--dsw-elevation-soft, 0 1px 3px rgba(0,0,0,.08));",
			"  transform: translateX(calc(var(--imqb2-seg-index) * (100% + 2px)));",
			"  transition: transform 160ms ease; pointer-events: none;",
			"}",
			".imqb2-seg-tab {",
			"  box-sizing: border-box; position: relative; z-index: 1; height: 26px; padding: 0 14px;",
			"  border: 0; border-radius: var(--dsw-radius-sm, 6px); background: transparent;",
			"  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 20px;",
			"  font-weight: 500; white-space: nowrap; cursor: pointer; transition: color 120ms ease;",
			"}",
			".imqb2-seg-tab:hover, .imqb2-seg-tab[aria-selected='true'] { color: var(--dsw-alias-label-primary); }",
			".imqb2-seg-tab:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }",
			".imqb2-tags {",
			"  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;",
			"  box-sizing: border-box; width: 100%; min-height: 34px; padding: 5px 6px;",
			"  border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md, 8px);",
			"  background: var(--dsw-alias-bg-layer-3); cursor: text;",
			"}",
			".imqb2-tags:focus-within { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }",
			".imqb2-tag {",
			"  display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto;",
			"  max-width: 100%; height: 24px; padding: 0 4px 0 9px; border-radius: 999px;",
			"  background: var(--dsw-alias-interactive-bg-hover);",
			"  font-size: 12px; line-height: 1; color: var(--dsw-alias-label-primary);",
			"}",
			".imqb2-tag-text { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
			".imqb2-tag-x {",
			"  display: inline-flex; align-items: center; justify-content: center;",
			"  width: 16px; height: 16px; padding: 0; border: 0; border-radius: 50%;",
			"  background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px;",
			"  line-height: 1; cursor: pointer;",
			"}",
			".imqb2-tag-x:hover { background: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); }",
			".imqb2-tags-input {",
			"  flex: 1 1 120px; min-width: 100px; height: 22px; padding: 0 4px;",
			"  border: 0; outline: none; background: transparent; font: inherit; font-size: 13px;",
			"  color: var(--dsw-alias-label-primary);",
			"}",
			".imqb2-tags-input::placeholder { color: var(--dsw-alias-label-tertiary); }",
			".imqb2-footer {",
			"  position: sticky; bottom: 0; display: flex; align-items: center; gap: 12px;",
			"  padding: 12px 0 10px; margin-top: 8px;",
			"  background: linear-gradient(to top, var(--dsw-alias-bg-layer-1) 72%, transparent);",
			"}",
			".imqb2-note { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }",
			".imqb2-note--error { color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-error)); }",
			".imqb2-note--ok { color: var(--dsw-alias-label-secondary); }",
			".imqb2-save {",
			"  appearance: none; flex: none; border: 1px solid transparent;",
			"  border-radius: var(--dsw-radius-md, 8px); padding: 6px 18px;",
			"  font: inherit; font-size: 13px; line-height: 1.5; cursor: pointer;",
			"  background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3);",
			"}",
			".imqb2-save:disabled { opacity: 0.4; cursor: default; }",
			".imqb2-save:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }",
			".imqb2-card {",
			"  display: flex; flex-direction: column; gap: 4px;",
			"  padding: 14px 16px 8px; margin-bottom: 14px;",
			"  border: 1px solid var(--dsw-alias-border-secondary);",
			"  border-radius: 12px;",
			"  background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1));",
			"  scroll-margin-top: 8px;",
			"}",
			".imqb2-card-head { display: flex; align-items: center; gap: 6px; padding-bottom: 6px; }",
			".imqb2-card-title { margin: 0; font-size: 13px; font-weight: 600; line-height: 20px; color: var(--dsw-alias-label-primary); }",
			".imqb2-card-tip {",
			"  display: inline-flex; align-items: center; justify-content: center;",
			"  width: 15px; height: 15px; border-radius: 50%;",
			"  border: 1px solid var(--dsw-alias-border-secondary);",
			"  font-size: 10px; line-height: 1; color: var(--dsw-alias-label-tertiary);",
			"  cursor: help; user-select: none;",
			"}",
			".imqb2-nav {",
			"  position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 6px;",
			"  padding: 8px 0 10px; margin-bottom: 4px;",
			"  background: linear-gradient(to bottom, var(--dsw-alias-bg-layer-1) 78%, transparent);",
			"}",
			".imqb2-nav-item {",
			"  appearance: none; border: 1px solid var(--dsw-alias-border-secondary);",
			"  border-radius: 999px; padding: 3px 10px;",
			"  font: inherit; font-size: 12px; line-height: 1.5; cursor: pointer;",
			"  background: transparent; color: var(--dsw-alias-label-secondary);",
			"}",
			".imqb2-nav-item:hover { color: var(--dsw-alias-label-primary); }",
			".imqb2-nav-item.is-active {",
			"  background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-1);",
			"  border-color: transparent;",
			"}",
			".imqb2-has-tip { cursor: help; border-bottom: 1px dashed var(--dsw-alias-border-secondary); }",
			".imqb2-input--text { width: 76px; text-align: center; }"
		];
		/** 注入配置面板样式（挂载时注入、卸载时移除） */
		function useConfigPanelStyles() {
			(0, react.useEffect)(() => {
				if (typeof document === "undefined") return;
				if (document.getElementById(STYLE_ID) !== null) return;
				const style = document.createElement("style");
				style.id = STYLE_ID;
				style.textContent = PANEL_CSS.join("\n");
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			}, []);
		}
		/**
		* 作用域卡片：一个会话范围 = 一块。
		* 标题行右侧是模式下拉，卡片内只留这个模式真正用得上的名单，避免一行行平铺。
		*/
		function ScopeCard({ title, desc, mode, options, onMode, children }) {
			return (0, react.createElement)("div", { className: "imqb2-scope" }, (0, react.createElement)("div", { className: "imqb2-scope-head" }, (0, react.createElement)("div", { className: "imqb2-scope-title-wrap" }, (0, react.createElement)("span", { className: "imqb2-scope-name" }, title), desc !== void 0 ? (0, react.createElement)("span", { className: "imqb2-scope-desc" }, desc) : null), (0, react.createElement)("select", {
				className: "imqb2-select",
				value: mode,
				"aria-label": title + " 访问模式",
				onChange: (event) => {
					onMode(event.target.value);
				}
			}, options.map((option) => (0, react.createElement)("option", {
				key: option.value,
				value: option.value
			}, option.label)))), children);
		}
		function Switch({ checked, label, onChange }) {
			return (0, react.createElement)("button", {
				type: "button",
				role: "switch",
				"aria-checked": checked,
				"aria-label": label,
				className: "imqb2-switch",
				onClick: () => {
					onChange(!checked);
				}
			}, (0, react.createElement)("span", { className: "imqb2-switch-thumb" }));
		}
		function Segmented({ value, options, onChange, label }) {
			const index = Math.max(0, options.findIndex((option) => option.value === value));
			const trackStyle = {
				"--imqb2-seg-count": options.length,
				"--imqb2-seg-index": index
			};
			return (0, react.createElement)("div", {
				className: "imqb2-seg",
				role: "tablist",
				"aria-label": label,
				style: trackStyle
			}, (0, react.createElement)("span", { className: "imqb2-seg-indicator" }), options.map((option) => (0, react.createElement)("button", {
				key: option.value,
				type: "button",
				role: "tab",
				"aria-selected": option.value === value,
				className: "imqb2-seg-tab",
				onClick: () => {
					onChange(option.value);
				}
			}, option.label)));
		}
		/**
		* 统一行容器：左 label（可带副标题）右控件。
		*
		* 说明一律进 tooltip（label 上的 title + 虚线下划线），不再往页面里塞段落——
		* 一屏塞十几条解释，人是要骂人的。
		*/
		function Row({ label, sub, help, inline = false, children }) {
			return (0, react.createElement)("div", { className: "imqb2-row" }, (0, react.createElement)("div", { className: "imqb2-row-label" }, (0, react.createElement)("span", {
				className: help === void 0 ? void 0 : "imqb2-has-tip",
				title: help
			}, label), sub === void 0 ? null : (0, react.createElement)("span", { className: "imqb2-row-label-sub" }, sub)), (0, react.createElement)("div", { className: "imqb2-row-control" + (inline ? " imqb2-row-control--inline" : "") }, children));
		}
		/** 单行文本输入（表情、短串） */
		function TextRow({ label, sub, help, value, placeholder, maxLength, onChange }) {
			return (0, react.createElement)(Row, {
				label,
				sub,
				help,
				inline: true
			}, (0, react.createElement)("input", {
				type: "text",
				className: "imqb2-input imqb2-input--text",
				value,
				placeholder,
				maxLength,
				spellCheck: false,
				onChange: (event) => {
					onChange(event.currentTarget.value);
				}
			}));
		}
		/** 模块卡片：一个主题 = 一块独立背景，标题上的问号挂说明 */
		function Section({ id, title, desc, children }) {
			return (0, react.createElement)("section", {
				className: "imqb2-card",
				id: "imqb2-mod-" + id
			}, (0, react.createElement)("div", { className: "imqb2-card-head" }, (0, react.createElement)("h3", { className: "imqb2-card-title" }, title), desc === void 0 ? null : (0, react.createElement)("span", {
				className: "imqb2-card-tip",
				title: desc,
				"aria-label": desc
			}, "?")), (0, react.createElement)("div", { className: "imqb2-rows" }, children));
		}
		/** 模块导航：点一下滚到那块，当前项高亮 */
		function ModuleNav({ items, active, onPick }) {
			return (0, react.createElement)("nav", {
				className: "imqb2-nav",
				"aria-label": "配置模块"
			}, items.map((item) => (0, react.createElement)("button", {
				key: item.id,
				type: "button",
				className: "imqb2-nav-item" + (item.id === active ? " is-active" : ""),
				"aria-current": item.id === active ? "true" : "false",
				onClick: () => {
					onPick(item.id);
				}
			}, item.label)));
		}
		function SwitchRow({ label, sub, help, checked, onChange }) {
			return (0, react.createElement)(Row, {
				label,
				sub,
				help,
				inline: true
			}, (0, react.createElement)(Switch, {
				checked,
				label,
				onChange
			}));
		}
		function NumberRow({ label, sub, help, value, min, max, step, suffix, onChange }) {
			return (0, react.createElement)(Row, {
				label,
				sub,
				help,
				inline: true
			}, (0, react.createElement)("div", { className: "imqb2-number" }, (0, react.createElement)("input", {
				type: "number",
				className: "imqb2-input imqb2-input--number",
				value: Number.isFinite(value) ? String(value) : "",
				min,
				max,
				step,
				onChange: (event) => {
					const raw = event.currentTarget.value;
					const next = Number(raw);
					if (raw !== "" && Number.isFinite(next)) onChange(next);
				}
			}), suffix === void 0 ? null : (0, react.createElement)("span", { className: "imqb2-number-unit" }, suffix)));
		}
		function SegmentedRow({ label, sub, help, value, options, onChange }) {
			return (0, react.createElement)(Row, {
				label,
				sub,
				help
			}, (0, react.createElement)(Segmented, {
				value,
				options,
				onChange,
				label
			}));
		}
		function TextAreaRow({ label, sub, help, value, rows, placeholder, onChange, action }) {
			return (0, react.createElement)(Row, {
				label,
				sub,
				help
			}, (0, react.createElement)("textarea", {
				className: "imqb2-textarea",
				value,
				rows: rows ?? 12,
				placeholder,
				spellCheck: false,
				onChange: (event) => {
					onChange(event.currentTarget.value);
				}
			}), action === void 0 ? null : action);
		}
		function SelectRow({ label, sub, help, value, options, onChange }) {
			return (0, react.createElement)(Row, {
				label,
				sub,
				help
			}, (0, react.createElement)("select", {
				className: "imqb2-select",
				value,
				onChange: (event) => {
					onChange(event.currentTarget.value);
				}
			}, options.map((option) => (0, react.createElement)("option", {
				key: option.value,
				value: option.value
			}, option.label))));
		}
		/**
		* 标签输入：回车或逗号成标签，Backspace 删最后一个，点 × 删单个。
		*
		* 用内部文本态承接输入过程，提交时才变成数组；否则每敲一个字都要重建数组，
		* 光标和输入法（拼音候选）都会被打断。
		*/
		function TagsRow({ label, sub, help, value, placeholder, onChange }) {
			const [draft, setDraft] = (0, react.useState)("");
			const inputRef = (0, react.useRef)(null);
			const commit = (0, react.useCallback)((raw) => {
				const items = raw.split(/[,\n\uFF0C]/).map((part) => part.trim()).filter((part) => part !== "");
				if (items.length === 0) return;
				const next = [...value];
				for (const item of items) if (!next.includes(item)) next.push(item);
				if (next.length !== value.length) onChange(next);
				setDraft("");
			}, [onChange, value]);
			const remove = (0, react.useCallback)((target) => {
				onChange(value.filter((item) => item !== target));
			}, [onChange, value]);
			return (0, react.createElement)(Row, {
				label,
				sub,
				help
			}, (0, react.createElement)("div", {
				className: "imqb2-tags",
				onClick: () => {
					inputRef.current?.focus();
				},
				role: "group",
				"aria-label": label
			}, value.map((item) => (0, react.createElement)("span", {
				key: item,
				className: "imqb2-tag"
			}, (0, react.createElement)("span", { className: "imqb2-tag-text" }, item), (0, react.createElement)("button", {
				type: "button",
				className: "imqb2-tag-x",
				"aria-label": "删除 " + item,
				onClick: (event) => {
					event.stopPropagation();
					remove(item);
				}
			}, "×"))), (0, react.createElement)("input", {
				ref: inputRef,
				className: "imqb2-tags-input",
				value: draft,
				placeholder: value.length === 0 ? placeholder : "继续输入…",
				spellCheck: false,
				onChange: (event) => {
					const raw = event.currentTarget.value;
					if (/[,\uFF0C\n]/.test(raw)) commit(raw);
					else setDraft(raw);
				},
				onKeyDown: (event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commit(draft);
					} else if (event.key === "Backspace" && draft === "" && value.length > 0) {
						event.preventDefault();
						remove(value[value.length - 1]);
					}
				},
				onBlur: () => {
					if (draft.trim() !== "") commit(draft);
				}
			})));
		}
		/** 深比较（dirty 判断） */
		function shallowEqual(a, b) {
			return JSON.stringify(a) === JSON.stringify(b);
		}
		function ConfigPanel(props = {}) {
			useConfigPanelStyles();
			const [initial, setInitial] = (0, react.useState)(null);
			const [form, setForm] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [result, setResult] = (0, react.useState)(null);
			const [loadError, setLoadError] = (0, react.useState)(null);
			const [activeModule, setActiveModule] = (0, react.useState)("scope");
			const bindPhase = props?.bindPhase;
			(0, react.useEffect)(() => {
				let stopped = false;
				fetch(BIND_CONFIG_PATH, { cache: "no-store" }).then(async (res) => {
					if (!res.ok) throw new Error("HTTP " + res.status);
					const body = await res.json();
					if (stopped) return;
					setInitial(body.config);
					setForm(body.config);
					setLoadError(null);
				}).catch((err) => {
					if (!stopped) setLoadError(err instanceof Error ? err.message : String(err));
				});
				return () => {
					stopped = true;
				};
			}, [bindPhase]);
			const patch = (0, react.useCallback)((key, value) => {
				setForm((current) => current === null ? current : {
					...current,
					[key]: value
				});
				setResult(null);
			}, []);
			const submit = (0, react.useCallback)((event) => {
				event.preventDefault();
				if (busy || initial === null || form === null) return;
				const changed = {};
				for (const key of Object.keys(form)) {
					if (key === "workspaceOptions") continue;
					if (!shallowEqual(form[key], initial[key])) changed[key] = form[key];
				}
				if (Object.keys(changed).length === 0) return;
				setBusy(true);
				fetch(BIND_CONFIG_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(changed)
				}).then(async (res) => {
					const body = await res.json().catch(() => ({}));
					if (res.ok && body.ok === true) {
						setResult({
							ok: true,
							message: body.message ?? "配置已保存，插件将自动重载"
						});
						setInitial(form);
						return;
					}
					setResult({
						ok: false,
						message: body.error ?? "保存失败（HTTP " + res.status + "）"
					});
				}).catch((err) => {
					setResult({
						ok: false,
						message: err instanceof Error ? err.message : String(err)
					});
				}).finally(() => {
					setBusy(false);
				});
			}, [
				busy,
				form,
				initial
			]);
			if (loadError !== null) return (0, react.createElement)("p", {
				className: "imqb2-help",
				style: { padding: "12px 0" }
			}, "配置加载失败：" + loadError);
			if (initial === null || form === null) return (0, react.createElement)("p", {
				className: "imqb2-help",
				style: { padding: "12px 0" }
			}, "正在加载配置…");
			const dirty = Object.keys(form).some((key) => key !== "workspaceOptions" && !shallowEqual(form[key], initial[key]));
			const policy = form.mentionPolicy ?? "smart";
			const cwd = form.cwd ?? "";
			const workspaceOptions = form.workspaceOptions ?? [];
			const selectOptions = [
				{
					value: "",
					label: "默认（~/.dsh-tuitui/workspace）"
				},
				...workspaceOptions.filter((dir) => dir !== "").map((dir) => ({
					value: dir,
					label: dir
				})),
				...cwd !== "" && !workspaceOptions.includes(cwd) ? [{
					value: cwd,
					label: cwd + "（当前）"
				}] : []
			];
			const modules = [
				{
					id: "scope",
					label: "服务范围"
				},
				{
					id: "reply",
					label: "回话方式"
				},
				...policy === "smart" ? [{
					id: "smart",
					label: "智能判断"
				}] : [],
				{
					id: "reaction",
					label: "表情回执"
				},
				{
					id: "context",
					label: "上下文"
				},
				{
					id: "workspace",
					label: "工作区"
				},
				{
					id: "native",
					label: "原生能力"
				},
				{
					id: "output",
					label: "输出调试"
				}
			];
			const jumpTo = (id) => {
				setActiveModule(id);
				(typeof document === "undefined" ? null : document.getElementById("imqb2-mod-" + id))?.scrollIntoView({
					behavior: "smooth",
					block: "start"
				});
			};
			return (0, react.createElement)("form", {
				className: "imqb2-form",
				onSubmit: submit
			}, (0, react.createElement)(ModuleNav, {
				items: modules,
				active: activeModule,
				onPick: jumpTo
			}), (0, react.createElement)(Section, {
				id: "scope",
				title: "服务范围",
				desc: "机器人愿意在哪些会话里工作；每块的模式决定名单怎么用。"
			}, (0, react.createElement)(ScopeCard, {
				title: "单聊",
				desc: "同事私聊机器人",
				mode: form["access.c2cMode"] ?? "open",
				options: MODE_OPTIONS,
				onMode: (v) => {
					patch("access.c2cMode", v);
				}
			}, (form["access.c2cMode"] ?? "open") === "allowlist" ? (0, react.createElement)(TagsRow, {
				label: "名单",
				value: form["access.c2cAllow"] ?? [],
				placeholder: "域账号或 uid，回车添加",
				help: (form["access.c2cAllow"] ?? []).length === 0 ? "名单为空 = 谁都不理（失败即关闭）。" : void 0,
				onChange: (v) => {
					patch("access.c2cAllow", v);
				}
			}) : (form["access.c2cMode"] ?? "open") === "blocklist" ? (0, react.createElement)(TagsRow, {
				label: "屏蔽",
				value: form["access.c2cBlock"] ?? [],
				placeholder: "域账号或 uid，回车添加",
				help: "只拦这些人，其余照常。",
				onChange: (v) => {
					patch("access.c2cBlock", v);
				}
			}) : (0, react.createElement)("p", {
				className: "imqb2-help",
				style: { padding: "4px 0 8px" }
			}, (form["access.c2cMode"] ?? "open") === "disabled" ? "单聊完全关闭：发消息不会有任何回应。" : "谁私聊都回应。")), (0, react.createElement)(ScopeCard, {
				title: "群聊",
				desc: "拉进群之后在群里说话",
				mode: form["access.groupMode"] ?? "open",
				options: MODE_OPTIONS,
				onMode: (v) => {
					patch("access.groupMode", v);
				}
			}, (form["access.groupMode"] ?? "open") === "allowlist" ? (0, react.createElement)(TagsRow, {
				label: "名单",
				value: form["access.groupAllow"] ?? [],
				placeholder: "group_id，回车添加",
				help: (form["access.groupAllow"] ?? []).length === 0 ? "名单为空 = 哪个群都不理（失败即关闭）。" : void 0,
				onChange: (v) => {
					patch("access.groupAllow", v);
				}
			}) : (form["access.groupMode"] ?? "open") === "blocklist" ? (0, react.createElement)(TagsRow, {
				label: "屏蔽",
				value: form["access.groupBlock"] ?? [],
				placeholder: "group_id，回车添加",
				help: "只屏蔽这些群，其余照常。",
				onChange: (v) => {
					patch("access.groupBlock", v);
				}
			}) : (0, react.createElement)("p", {
				className: "imqb2-help",
				style: { padding: "4px 0 8px" }
			}, (form["access.groupMode"] ?? "open") === "disabled" ? "群聊完全关闭：@ 它也不回应。" : "任何群 @ 它都回应（具体听不听 @ 见下方「什么时候回话」）。")), (0, react.createElement)(ScopeCard, {
				title: "团队频道帖子",
				desc: "按 channel_id 或 team_id 匹配",
				mode: form["access.postMode"] ?? "disabled",
				options: MODE_OPTIONS,
				onMode: (v) => {
					patch("access.postMode", v);
				}
			}, (form["access.postMode"] ?? "disabled") === "allowlist" ? (0, react.createElement)(TagsRow, {
				label: "名单",
				value: form["access.postAllow"] ?? [],
				placeholder: "channel_id 或 team_id，回车添加",
				help: (form["access.postAllow"] ?? []).length === 0 ? "名单为空 = 哪个频道都不理（失败即关闭）。" : void 0,
				onChange: (v) => {
					patch("access.postAllow", v);
				}
			}) : (form["access.postMode"] ?? "disabled") === "blocklist" ? (0, react.createElement)(TagsRow, {
				label: "屏蔽",
				value: form["access.postBlock"] ?? [],
				placeholder: "channel_id 或 team_id，回车添加",
				help: "只屏蔽这些频道，其余照常。",
				onChange: (v) => {
					patch("access.postBlock", v);
				}
			}) : (0, react.createElement)("p", {
				className: "imqb2-help",
				style: { padding: "4px 0 8px" }
			}, (form["access.postMode"] ?? "disabled") === "disabled" ? "帖子完全关闭：频道里发帖不会回应。" : "所有频道的帖子都会处理。"))), (0, react.createElement)(Section, {
				id: "reply",
				title: "回话方式",
				desc: "群聊与团队频道里什么时候开口；私聊始终直接对话。"
			}, (0, react.createElement)(SegmentedRow, {
				label: "触发方式",
				value: policy,
				options: POLICY_OPTIONS,
				help: policy === "require" ? "只有 @ 机器人才回应。" : policy === "smart" ? "不 @ 也不看名字：模型读上下文，自己决定说话、挂个表情、还是一声不吭。" : "群里每条消息都回——建议只用在专用小群。",
				onChange: (v) => {
					patch("mentionPolicy", v);
				}
			}), (0, react.createElement)(SelectRow, {
				label: "单聊忙时",
				value: form["concurrency.c2c"] ?? "abort",
				options: CONCURRENCY_OPTIONS,
				help: "私聊正在回上一句时又来一句：打断＝放弃旧的直接接新话，最像真人聊天。",
				onChange: (v) => {
					patch("concurrency.c2c", v);
				}
			}), (0, react.createElement)(SelectRow, {
				label: "群聊忙时",
				value: form["concurrency.group"] ?? "queue",
				options: CONCURRENCY_OPTIONS,
				help: "群里任务多，默认排一条条处理；打断会让正在跑的活白跑。",
				onChange: (v) => {
					patch("concurrency.group", v);
				}
			}), (0, react.createElement)(SelectRow, {
				label: "帖子忙时",
				value: form["concurrency.post"] ?? "queue",
				options: CONCURRENCY_OPTIONS,
				help: "团队频道帖子的处理方式，默认排队。",
				onChange: (v) => {
					patch("concurrency.post", v);
				}
			})), (0, react.createElement)(Section, {
				id: "reaction",
				title: "表情回执",
				desc: "收到消息先挂表情表示「在算」，处理完或出错再换一个；也是智能模式里更轻的回话方式。"
			}, (0, react.createElement)(SwitchRow, {
				label: "收到就先挂一个",
				checked: form["reactions.enabled"] ?? true,
				help: "打开后，机器人收到的消息会立刻被挂上「在算」表情，不用干等着以为它卡死了。",
				onChange: (v) => {
					patch("reactions.enabled", v);
				}
			}), (0, react.createElement)(SwitchRow, {
				label: "群聊也挂",
				checked: form["reactions.inGroup"] ?? true,
				help: "群聊里同样给回执。群里人多、消息快，这个反馈更有用。",
				onChange: (v) => {
					patch("reactions.inGroup", v);
				}
			}), (0, react.createElement)(TextRow, {
				label: "在算",
				value: form["reactions.ack"] ?? "👀",
				placeholder: "👀",
				maxLength: 8,
				help: "收到消息时挂的表情。留空 = 不挂。",
				onChange: (v) => {
					patch("reactions.ack", v);
				}
			}), (0, react.createElement)(TextRow, {
				label: "完成",
				value: form["reactions.done"] ?? "✅",
				placeholder: "✅",
				maxLength: 8,
				help: "处理完把「在算」换成这个。留空 = 只撤不换。",
				onChange: (v) => {
					patch("reactions.done", v);
				}
			}), (0, react.createElement)(TextRow, {
				label: "出错",
				value: form["reactions.fail"] ?? "😵",
				placeholder: "😵",
				maxLength: 8,
				help: "处理失败时换成这个。留空 = 只撤不换。",
				onChange: (v) => {
					patch("reactions.fail", v);
				}
			})), policy === "smart" ? (0, react.createElement)(Section, {
				id: "smart",
				title: "智能判断",
				desc: "要不要说话、挂个表情还是不理，全由模型读上下文决定；没有名字匹配之类的规则。"
			}, (0, react.createElement)(TextAreaRow, {
				label: "判定提示词",
				value: form["smartJudge.prompt"] ?? DEFAULT_SMART_PROMPT,
				rows: 14,
				sub: "支持多行；留空恢复出厂默认",
				help: "模型会拿到【最近对话】与【新消息】，按这里的规则判断要不要回。",
				action: (0, react.createElement)("button", {
					type: "button",
					className: "imqb2-inline-btn",
					onClick: () => {
						patch("smartJudge.prompt", "");
					}
				}, "恢复默认"),
				onChange: (v) => {
					patch("smartJudge.prompt", v);
				}
			}), (0, react.createElement)(NumberRow, {
				label: "判定间隔",
				value: Math.round((form["smartJudge.cooldownMs"] ?? 5e3) / 1e3),
				min: 0,
				max: 3600,
				step: 5,
				suffix: "秒",
				help: "同一会话两次判定的最小间隔，防止每条消息都调模型。",
				onChange: (v) => {
					patch("smartJudge.cooldownMs", v * 1e3);
				}
			}), (0, react.createElement)(NumberRow, {
				label: "判定超时",
				value: Math.round((form["smartJudge.timeoutMs"] ?? 2e4) / 1e3),
				min: 3,
				max: 120,
				step: 1,
				suffix: "秒",
				help: "思考型模型几秒才出结果；给太短会把「还在想」误判成不回话。",
				onChange: (v) => {
					patch("smartJudge.timeoutMs", v * 1e3);
				}
			}), (0, react.createElement)(NumberRow, {
				label: "判断时看几条",
				value: form["smartJudge.maxHistory"] ?? 50,
				min: 0,
				max: 50,
				step: 1,
				suffix: "条",
				help: "交给模型的历史消息条数。太少判断不准，太多费 token。",
				onChange: (v) => {
					patch("smartJudge.maxHistory", v);
				}
			})) : null, (0, react.createElement)(Section, {
				id: "context",
				title: "上下文与会话",
				desc: "回话时能看到多少群消息，会话在内存里保留多久。"
			}, (0, react.createElement)(NumberRow, {
				label: "群聊上下文条数",
				value: form.historyLimit ?? 50,
				min: 0,
				max: 1e3,
				step: 1,
				suffix: "条",
				help: "被叫到时附带最近 N 条群消息；0 表示不带。私聊靠会话自身记忆，不受影响。",
				onChange: (v) => {
					patch("historyLimit", v);
				}
			}), (0, react.createElement)(NumberRow, {
				label: "闲置回收",
				value: Math.round((form.sessionIdleTimeout ?? 18e5) / 6e4),
				min: 1,
				max: 1440,
				step: 1,
				suffix: "分钟",
				help: "超过该时长没有新消息就回收内存里的 agent；下次说话会自动恢复原会话，上下文不丢。",
				onChange: (v) => {
					patch("sessionIdleTimeout", v * 6e4);
				}
			})), (0, react.createElement)(Section, {
				id: "workspace",
				title: "工作区",
				desc: "机器人在哪个目录里读写文件、执行命令；所有会话共用。"
			}, (0, react.createElement)(SelectRow, {
				label: "Agent 工作目录",
				value: cwd,
				options: selectOptions,
				help: cwd === "" ? "当前使用默认目录 ~/.dsh-tuitui/workspace。" : "保存后插件重载生效。",
				onChange: (v) => {
					patch("cwd", v);
				}
			})), (0, react.createElement)(Section, {
				id: "native",
				title: "推推原生能力",
				desc: "推推特有的交互能力，关掉会退化成纯文本。"
			}, (0, react.createElement)(SwitchRow, {
				label: "交互卡片",
				checked: form["interactive.enabled"] ?? true,
				help: "问答与审批用推推原生卡片承载，支持原地更新。",
				onChange: (v) => {
					patch("interactive.enabled", v);
				}
			}), (0, react.createElement)(SwitchRow, {
				label: "中间步骤上报",
				checked: form["agentSteps.enabled"] ?? false,
				help: "把模型与工具调用步骤实时展示在推推客户端。",
				onChange: (v) => {
					patch("agentSteps.enabled", v);
				}
			})), (0, react.createElement)(Section, {
				id: "output",
				title: "输出与调试",
				desc: "回复怎么送到推推，以及排查问题时要看多少细节。"
			}, (0, react.createElement)(SwitchRow, {
				label: "流式输出",
				checked: form.streaming ?? true,
				help: "先发一条消息，再原地编辑分段刷新，回复体感更快。",
				onChange: (v) => {
					patch("streaming", v);
				}
			}), (0, react.createElement)(SwitchRow, {
				label: "显示工具调用结果",
				checked: form.showToolResults ?? false,
				help: "把 agent 调用工具的结果也发到聊天里，排查问题时有用。",
				onChange: (v) => {
					patch("showToolResults", v);
				}
			}), (0, react.createElement)(SwitchRow, {
				label: "限制可发送的文件",
				checked: form["sendFile.restrictPaths"] ?? false,
				help: "默认放开：想让 agent 发哪的文件都行。打开后只允许媒体目录、工作区和额外根目录，防误发敏感文件。",
				onChange: (v) => {
					patch("sendFile.restrictPaths", v);
				}
			}), (0, react.createElement)(SwitchRow, {
				label: "调试日志",
				checked: form.debug ?? false,
				help: "输出推推 SDK 请求详情（含消息内容），只在排查问题时开。",
				onChange: (v) => {
					patch("debug", v);
				}
			})), (0, react.createElement)("div", { className: "imqb2-footer" }, result !== null ? (0, react.createElement)("p", { className: "imqb2-note" + (result.ok ? " imqb2-note--ok" : " imqb2-note--error") }, (result.ok ? "" : "⚠️ ") + result.message) : dirty ? (0, react.createElement)("p", { className: "imqb2-note" }, "保存后插件将重载，进行中的机器人会话将重置") : (0, react.createElement)("p", { className: "imqb2-note" }), (0, react.createElement)("button", {
				className: "imqb2-save",
				type: "submit",
				disabled: busy || !dirty
			}, busy ? "正在保存…" : "保存")));
		}
		// src/client/index.ts
		const name = "im-tuitui-client";
		const inject = [
			"slots",
			"sidebarRight",
			"sidebarRightTabs"
		];
		/** 侧栏 Tab 类型（ui-sidebar-right 契约的局部投影） */
		const TAB_KIND = "tuitui-bind";
		/** 席位注册 key（Tab 类型 id，席位按其分发；只需全局唯一，与包名解耦） */
		const TAB_ID = "im-tuitui/bind";
		/** 本插件包名（插件详情页按其匹配来源包，只在对应详情页渲染操作按钮） */
		const PACKAGE_NAME = "@eayonlee/dsh-tuitui-bot";
		/** 主面板 id（layout.selectPanel 导航目标；keyed main 席位按其分发） */
		const IM_MAIN_PANEL_ID = "im-tuitui";
		/** 绑定入口图标（推推官方图标） */
		function BindGuideIcon() {
			return (0, react.createElement)("img", {
				src: TUITUI_ICON_DATA_URI,
				width: 24,
				height: 24,
				alt: "",
				"aria-hidden": true,
				className: "imqb-tuicon"
			});
		}
		/**
		* createElement 的组件投影（显式 FC 标注）。
		*
		* @types/react 18 的 createElement 重载在推断「纯函数签名 + 全可选 props」
		* 的组件时会全部落空，退到最后一个重载（props 只认 Attributes）并报错；
		* 先落成 FC<P> 再传进去推断正常。运行时无差别。
		*/
		const BindPanelBodyView = BindPanelBody;
		const ConfigPanelView = ConfigPanel;
		/** 设置页栏目：共享一份绑定状态轮询，驱动绑定面板与配置刷新 */
		function TuituiSettingsSection() {
			const { state, gone, recheck } = useBindState();
			return (0, react.createElement)("div", null, (0, react.createElement)(BindPanelBodyView, {
				state,
				gone,
				recheck
			}), (0, react.createElement)(ConfigPanelView, { bindPhase: state?.phase }));
		}
		/** 主面板页面：与设置栏目同一内容，包一层滚动留白容器（plugins.detail.actions 的跳转目标） */
		function TuituiPage() {
			return (0, react.createElement)("div", { className: "imqb-pluginPage" }, (0, react.createElement)("div", { className: "imqb-pluginPageContent" }, (0, react.createElement)(TuituiSettingsSection)));
		}
		/** 左侧栏入口图标（宿主传入 size：展开 18 / 收起 16；currentColor 跟随侧栏配色与选中态） */
		function TuituiSidebarIcon({ size = 16 }) {
			return (0, react.createElement)("img", {
				src: TUITUI_ICON_DATA_URI,
				width: size,
				height: size,
				alt: "",
				"aria-hidden": true,
				className: "imqb-tuicon"
			});
		}
		/** 插件详情「设置」按钮：仅在本包的 bundle / 组件行详情页渲染，其他插件不显示 */
		function OpenTuituiAction({ subject, packageName, onOpen }) {
			if (subject?.kind !== "bundle" && subject?.kind !== "row") return null;
			if (subject.pkg?.name !== packageName) return null;
			if (subject.kind === "row" && subject.row?.moduleName !== packageName) return null;
			return (0, react.createElement)("button", {
				type: "button",
				className: "imqb-pluginOpen",
				onClick: onOpen
			}, "设置");
		}
		function apply(ctx) {
			installPanelStyles();
			const tabs = ctx.sidebarRightTabs;
			const right = ctx.sidebarRight;
			const slots = ctx.slots;
			const disposers = [];
			if (slots !== void 0) disposers.push(slots.inject("settings.section", () => slots.register({
				name: "settings.section",
				id: "tuitui",
				order: 7,
				label: "推推机器人"
			}, TuituiSettingsSection)));
			if (tabs !== void 0 && slots !== void 0) {
				disposers.push(tabs.register({
					id: TAB_ID,
					kind: TAB_KIND,
					title: () => "推推机器人绑定",
					guide: [{
						id: "bind",
						order: 90,
						title: () => "推推机器人绑定",
						description: () => "填写 AppID / AppSecret，绑定推推机器人",
						icon: BindGuideIcon
					}]
				}));
				disposers.push(slots.inject("sidebar.right.pane.tab", () => slots.register({
					name: "sidebar.right.pane.tab",
					key: TAB_ID
				}, BindPanelBody)));
				disposers.push(watchAndPrompt(right));
			}
			const ctxInject = ctx.inject;
			if (typeof ctxInject === "function") ctxInject.call(ctx, ["layout"], (pageCtx) => {
				const pageSlots = pageCtx.slots;
				const layout = pageCtx.layout;
				if (pageSlots === void 0 || layout === void 0) return void 0;
				const stopMain = pageSlots.inject("main", () => pageSlots.register({
					name: "main",
					key: IM_MAIN_PANEL_ID
				}, TuituiPage));
				const stopActions = pageSlots.inject("plugins.detail.actions", () => pageSlots.register({
					name: "plugins.detail.actions",
					id: "im-tuitui-open",
					order: 20,
					inject: () => ({
						packageName: PACKAGE_NAME,
						onOpen: () => layout.selectPanel(IM_MAIN_PANEL_ID)
					})
				}, OpenTuituiAction));
				const stopSidebar = pageSlots.inject("sidebar.panellist", () => pageSlots.register({
					name: "sidebar.panellist",
					id: IM_MAIN_PANEL_ID,
					order: 10,
					label: "推推机器人"
				}, TuituiSidebarIcon));
				return () => {
					stopActions();
					stopSidebar();
					stopMain();
				};
			});
			ctx.effect(() => () => {
				for (const dispose of disposers.reverse()) dispose();
			}, "im-tuitui-client.binding");
		}
		/**
		* 轮询绑定状态：待绑定时自动打开绑定页。
		*
		* - 页面隐藏时降频轮询（可见时立即恢复节拍）
		* - 404（已绑定/未安装）时退避到 30s，保持低成本常驻探测
		* - 每次页面加载至多打开一次（用户手动关闭后不打扰）；
		*   打开失败（如启动早期 Session surface 尚未挂载）不消费机会，
		*   由下一轮轮询（3s）自动重试
		* - unconfigured 即「待绑定」：推推没有扫码，用户需要自己填凭据，
		*   因此这个相位就该把绑定页推到眼前
		*/
		function watchAndPrompt(right) {
			let stopped = false;
			let opened = right === void 0;
			let timer;
			const schedule = (ms) => {
				timer = setTimeout(() => {
					tick();
				}, ms);
			};
			const tick = async () => {
				if (stopped) return;
				if (typeof document !== "undefined" && document.visibilityState === "hidden") {
					schedule(5e3);
					return;
				}
				try {
					const res = await fetch(BIND_STATE_PATH, { cache: "no-store" });
					if (res.ok) {
						if ((await res.json()).phase === "unconfigured" && !opened && right !== void 0) try {
							right.openTab(TAB_KIND);
							opened = true;
						} catch (err) {
							console.error("[im-tuitui] 打开绑定页失败，稍后重试", err);
						}
						schedule(3e3);
						return;
					}
					schedule(3e4);
					return;
				} catch {}
				schedule(1e4);
			};
			tick();
			return () => {
				stopped = true;
				if (timer !== void 0) clearTimeout(timer);
			};
		}
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map