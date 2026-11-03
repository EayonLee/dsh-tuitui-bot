window.__ModuleLoader__.load({
	id: "@qihoo/dsh-tuitui-bot",
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
		* 与上游差异：推推无扫码绑定，凭据由用户在推推机器人后台创建后手填，
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
		/**
		* 推推机器人图标（矢量路径，内嵌以保持 bundle 自包含）。
		*
		* 用「对话气泡」表达 IM 机器人身份：推推没有对外统一的品牌图形资源，
		* 自绘矢量在明暗主题下都能跟随 currentColor。
		*/
		const TUITUI_LOGO_PATH = "M12 3.2c-4.97 0-9 3.4-9 7.6 0 2.32 1.24 4.4 3.2 5.83v3.42a.6.6 0 0 0 .92.5l3.5-2.1c.45.06.91.09 1.38.09 4.97 0 9-3.4 9-7.6s-4.03-7.6-9-7.6Z";
		/** 推推机器人图标（透明底，随 size 缩放） */
		function TuituiIcon({ size = 28 }) {
			return (0, react.createElement)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": true,
				className: "imqb-tuicon"
			}, (0, react.createElement)("path", {
				d: TUITUI_LOGO_PATH,
				fill: "#1F6FEB"
			}), (0, react.createElement)("circle", {
				cx: 8.4,
				cy: 10.8,
				r: 1.15,
				fill: "#fff"
			}), (0, react.createElement)("circle", {
				cx: 12,
				cy: 10.8,
				r: 1.15,
				fill: "#fff"
			}), (0, react.createElement)("circle", {
				cx: 15.6,
				cy: 10.8,
				r: 1.15,
				fill: "#fff"
			}));
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
		// src/client/config-panel.ts
		/**
		* 推推机器人配置面板 — 必要配置的 UI 编辑
		*
		* UI 复刻 DSW 通用设置（settings-form 原语）的视觉风格：
		* 左对齐设置列、0.5px 行分隔、label 13px/500、控件右置；
		* Switch 为 36×20 aria-checked 结构（thumb translateX 动画）；
		* 三值选择用分段控件（滑动指示器按段数/索引的 CSS 变量定位）；
		* 保存按钮为 DSW 反色主按钮（label-primary 底 + bg-layer-3 字）。
		*
		* 数据流：GET /tuitui/im-tuitui/config 回显当前生效配置（appSecret
		* 已由宿主剔除）→ 表单编辑 → dirty diff → POST 仅提交变更键 →
		* 宿主白名单 + Schema 校验 → 最小写入 profile patch → HMR 重载生效。
		*
		* 键名口径：线上读写都用 dotted key（access.c2cMode 等），与服务端
		* shared/bind-protocol.ts 的 ConfigPatchWire 完全一致——客户端与服务端
		* 各自维护一套嵌套/扁平映射必然漂移，这里干脆只用一个形态。
		*
		* 字段策略：只开放用户必要的配置（服务范围 / 上下文 / 模型 / 工作区 /
		* 推推原生能力）；其余调优类字段走 profile patch / 环境变量。
		*/
		/** 样式注入标记（幂等） */
		const STYLE_ID = "im-tuitui-config-panel-styles";
		/** DSW 通用设置风格（settings-form / Switch / SegmentedControl 原语复刻） */
		const PANEL_CSS = [
			".imqb2-form { display: flex; flex-direction: column; width: 100%; }",
			".imqb2-group-title {",
			"  padding: 14px 0 2px; font-size: 12px; font-weight: 600; line-height: 18px;",
			"  color: var(--dsw-alias-label-tertiary); text-transform: uppercase; letter-spacing: .04em;",
			"}",
			".imqb2-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }",
			".imqb2-field + .imqb2-field { border-top: 0.5px solid var(--dsw-alias-border-l2); }",
			".imqb2-head { display: flex; align-items: center; gap: 8px; min-height: 28px; }",
			".imqb2-label {",
			"  flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5;",
			"  color: var(--dsw-alias-label-primary);",
			"}",
			".imqb2-help { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }",
			".imqb2-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }",
			"/* Switch（aria-checked 驱动，视觉态与无障碍态同源） */",
			".imqb2-switch {",
			"  box-sizing: border-box; position: relative; flex: 0 0 auto;",
			"  width: 36px; height: 20px; padding: 2px; border: 0; border-radius: 999px;",
			"  background: var(--dsw-alias-border-l3); cursor: pointer; font: inherit;",
			"}",
			".imqb2-switch[aria-checked='true'] { background: var(--dsw-alias-brand-primary); }",
			".imqb2-switch:disabled { cursor: default; opacity: 0.5; }",
			".imqb2-switch:focus-visible {",
			"  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));",
			"  outline-offset: 2px;",
			"}",
			".imqb2-switch-thumb {",
			"  display: block; width: 16px; height: 16px; border-radius: 50%;",
			"  background: var(--dsw-alias-switch-thumb, #ffffff);",
			"  transition: transform 120ms ease;",
			"}",
			".imqb2-switch[aria-checked='true'] .imqb2-switch-thumb {",
			"  background: var(--dsw-alias-label-primary-foreground, #ffffff);",
			"  transform: translateX(16px);",
			"}",
			"/* 输入（官方 fields.input 复刻） */",
			".imqb2-input {",
			"  box-sizing: border-box; width: 100%; height: 34px; padding: 0 12px;",
			"  border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md, 8px);",
			"  background: var(--dsw-alias-bg-layer-3); font: inherit; font-size: 13px; line-height: 1.5;",
			"  color: var(--dsw-alias-label-primary);",
			"}",
			".imqb2-input:focus {",
			"  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));",
			"  outline-offset: 1px;",
			"}",
			"/* 分段控件 */",
			".imqb2-seg {",
			"  position: relative; display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr;",
			"  gap: 2px; padding: 4px; border-radius: var(--dsw-radius-md, 8px);",
			"  background: var(--dsw-alias-interactive-bg-hover);",
			"}",
			".imqb2-seg-indicator {",
			"  position: absolute; top: 4px; left: 4px;",
			"  width: calc((100% - 8px - 2px * (var(--imqb2-seg-count) - 1)) / var(--imqb2-seg-count));",
			"  height: calc(100% - 8px);",
			"  border: 0; border-radius: var(--dsw-radius-sm, 6px);",
			"  background: var(--dsw-alias-bg-layer-1);",
			"  box-shadow: var(--dsw-elevation-soft, 0 1px 3px rgba(0,0,0,.08));",
			"  transform: translateX(calc(var(--imqb2-seg-index) * (100% + 2px)));",
			"  transition: transform 160ms ease;",
			"  pointer-events: none;",
			"}",
			".imqb2-seg-tab {",
			"  box-sizing: border-box; position: relative; z-index: 1; height: 28px; padding: 0 16px;",
			"  border: 0; border-radius: var(--dsw-radius-sm, 6px); background: transparent;",
			"  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 20px;",
			"  font-weight: 500; white-space: nowrap; cursor: pointer; transition: color 120ms ease;",
			"}",
			".imqb2-seg-tab:hover, .imqb2-seg-tab[aria-selected='true'] { color: var(--dsw-alias-label-primary); }",
			".imqb2-seg-tab:focus-visible {",
			"  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));",
			"  outline-offset: -2px;",
			"}",
			"/* 底栏（官方 SettingsForm.footer 复刻） */",
			".imqb2-footer { display: flex; align-items: center; gap: 8px; padding-top: 16px; }",
			".imqb2-note { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }",
			".imqb2-note--error { color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-error)); }",
			".imqb2-note--ok { color: var(--dsw-alias-label-secondary); }",
			".imqb2-save {",
			"  appearance: none; flex: none; border: 1px solid transparent;",
			"  border-radius: var(--dsw-radius-md, 8px); padding: 5px 14px;",
			"  font: inherit; font-size: 13px; line-height: 1.5; cursor: pointer;",
			"  background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3);",
			"}",
			".imqb2-save:disabled { opacity: 0.4; cursor: default; }",
			".imqb2-save:focus-visible {",
			"  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));",
			"  outline-offset: 1px;",
			"}",
			"/* cwd 只读行 */",
			".imqb2-readonly {",
			"  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;",
			"  color: var(--dsw-alias-label-secondary); word-break: break-all; margin: 0;",
			"}"
		];
		/** 注入配置面板样式（挂载时注入、卸载时移除；与绑定面板的全局常驻样式不同） */
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
		/** 开关（官方 Switch 原语结构：aria-checked 驱动视觉态） */
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
		/** 访问模式分段选择（官方 SegmentedControl 结构：CSS 变量定位滑动指示器） */
		function Segmented({ value, options, onChange, label }) {
			const index = Math.max(0, options.findIndex((o) => o.value === value));
			const trackStyle = {
				"--imqb2-seg-count": options.length,
				"--imqb2-seg-index": index
			};
			return (0, react.createElement)("div", {
				className: "imqb2-seg",
				role: "tablist",
				"aria-label": label,
				style: trackStyle
			}, (0, react.createElement)("span", { className: "imqb2-seg-indicator" }), options.map((o) => (0, react.createElement)("button", {
				key: o.value,
				type: "button",
				role: "tab",
				"aria-selected": o.value === value,
				className: "imqb2-seg-tab",
				onClick: () => {
					onChange(o.value);
				}
			}, o.label)));
		}
		/** 开关行（label 左 + Switch 右 + 可选 help） */
		function SwitchRow({ label, help, checked, onChange }) {
			return (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("div", { className: "imqb2-head" }, (0, react.createElement)("span", { className: "imqb2-label" }, label), (0, react.createElement)(Switch, {
				checked,
				label,
				onChange
			})), help === void 0 ? null : (0, react.createElement)("p", { className: "imqb2-help" }, help));
		}
		/** 文本行（label 上 + 输入下，与官方 fields 布局一致） */
		function FieldRow({ label, help, value, placeholder, onChange }) {
			return (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("span", { className: "imqb2-label" }, label), (0, react.createElement)("input", {
				className: "imqb2-input",
				value,
				placeholder,
				spellCheck: false,
				onChange: (event) => {
					onChange(event.currentTarget.value);
				}
			}), help === void 0 ? null : (0, react.createElement)("p", { className: "imqb2-hint" }, help));
		}
		/** 数字行（label 左 + 数字输入右 + 可选 help） */
		function NumberRow({ label, help, value, min, max, step, onChange }) {
			return (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("div", { className: "imqb2-head" }, (0, react.createElement)("span", { className: "imqb2-label" }, label), (0, react.createElement)("input", {
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
			})), help === void 0 ? null : (0, react.createElement)("p", { className: "imqb2-hint" }, help));
		}
		/** 名单行（逗号/换行分隔，内部维护文本态避免每次输入都抖动数组） */
		function ListRow({ label, help, value, placeholder, onChange }) {
			const joined = value.join(", ");
			const [text, setText] = (0, react.useState)(joined);
			(0, react.useEffect)(() => {
				if (text.split(/[,\n]/).map((part) => part.trim()).filter((part) => part !== "").join(", ") === joined) return;
				setText(joined);
			}, [joined]);
			return (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("div", { className: "imqb2-head" }, (0, react.createElement)("span", { className: "imqb2-label" }, label)), (0, react.createElement)("input", {
				className: "imqb2-input",
				value: text,
				placeholder,
				spellCheck: false,
				onChange: (event) => {
					const raw = event.currentTarget.value;
					setText(raw);
					onChange(raw.split(/[,\n]/).map((part) => part.trim()).filter((part) => part !== ""));
				}
			}), help === void 0 ? null : (0, react.createElement)("p", { className: "imqb2-hint" }, help));
		}
		/** 触发策略分段行（require / always / smart） */
		function PolicyRow({ label, help, value, onChange }) {
			return (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("div", { className: "imqb2-head" }, (0, react.createElement)("span", { className: "imqb2-label" }, label), (0, react.createElement)(Segmented, {
				value,
				options: POLICY_OPTIONS,
				onChange: (next) => {
					onChange(next);
				},
				label
			})), help === void 0 ? null : (0, react.createElement)("p", { className: "imqb2-hint" }, help));
		}
		/** 访问模式分段选择行 */
		function SegmentedRow({ label, help, value, options, onChange }) {
			return (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("div", { className: "imqb2-head" }, (0, react.createElement)("span", { className: "imqb2-label" }, label), (0, react.createElement)(Segmented, {
				value,
				options,
				onChange,
				label
			})), help === void 0 ? null : (0, react.createElement)("p", { className: "imqb2-hint" }, help));
		}
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
		/** 触发方式三档 */
		const POLICY_OPTIONS = [
			{
				value: "require",
				label: "仅 @"
			},
			{
				value: "always",
				label: "全部"
			},
			{
				value: "smart",
				label: "智能"
			}
		];
		/** 深比较（表单值与初始回显值的 dirty 判断） */
		function shallowEqual(a, b) {
			return JSON.stringify(a) === JSON.stringify(b);
		}
		/**
		* 配置面板主体。
		*
		* 保存仅提交变更键（服务端按白名单合并），保存成功后提示
		* HMR 重载语义（进行中的机器人会话将重置）。
		*/
		function ConfigPanel(props = {}) {
			useConfigPanelStyles();
			const [initial, setInitial] = (0, react.useState)(null);
			const [form, setForm] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [result, setResult] = (0, react.useState)(null);
			const [loadError, setLoadError] = (0, react.useState)(null);
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
				for (const key of Object.keys(form)) if (!shallowEqual(form[key], initial[key])) changed[key] = form[key];
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
				className: "imqb2-hint",
				style: { padding: "12px 0" }
			}, "配置加载失败：" + loadError);
			if (initial === null || form === null) return (0, react.createElement)("p", {
				className: "imqb2-hint",
				style: { padding: "12px 0" }
			}, "正在加载配置…");
			const dirty = Object.keys(form).some((key) => !shallowEqual(form[key], initial[key]));
			return (0, react.createElement)("form", {
				className: "imqb2-form",
				onSubmit: submit
			}, (0, react.createElement)("div", { className: "imqb2-group-title" }, "服务范围"), (0, react.createElement)(SegmentedRow, {
				label: "单聊",
				value: form["access.c2cMode"] ?? "open",
				options: MODE_OPTIONS,
				help: "白名单只在「白名单」模式生效；黑名单始终优先",
				onChange: (v) => {
					patch("access.c2cMode", v);
				}
			}), (0, react.createElement)(ListRow, {
				label: "单聊白名单",
				value: form["access.c2cAllow"] ?? [],
				placeholder: "域账号或 uid，逗号分隔",
				onChange: (v) => {
					patch("access.c2cAllow", v);
				}
			}), (0, react.createElement)(ListRow, {
				label: "单聊黑名单",
				value: form["access.c2cBlock"] ?? [],
				placeholder: "域账号或 uid，逗号分隔",
				help: "被列入的人发消息一律不处理（优先级高于白名单）",
				onChange: (v) => {
					patch("access.c2cBlock", v);
				}
			}), (0, react.createElement)(SegmentedRow, {
				label: "群聊",
				value: form["access.groupMode"] ?? "open",
				options: MODE_OPTIONS,
				onChange: (v) => {
					patch("access.groupMode", v);
				}
			}), (0, react.createElement)(ListRow, {
				label: "群聊白名单",
				value: form["access.groupAllow"] ?? [],
				placeholder: "group_id，逗号分隔",
				onChange: (v) => {
					patch("access.groupAllow", v);
				}
			}), (0, react.createElement)(ListRow, {
				label: "群聊黑名单",
				value: form["access.groupBlock"] ?? [],
				placeholder: "group_id，逗号分隔",
				onChange: (v) => {
					patch("access.groupBlock", v);
				}
			}), (0, react.createElement)(SegmentedRow, {
				label: "团队频道帖子",
				value: form["access.postMode"] ?? "open",
				options: MODE_OPTIONS,
				help: "按 channel_id 或 team_id 匹配",
				onChange: (v) => {
					patch("access.postMode", v);
				}
			}), (0, react.createElement)(ListRow, {
				label: "帖子白名单",
				value: form["access.postAllow"] ?? [],
				placeholder: "channel_id 或 team_id，逗号分隔",
				onChange: (v) => {
					patch("access.postAllow", v);
				}
			}), (0, react.createElement)(ListRow, {
				label: "帖子黑名单",
				value: form["access.postBlock"] ?? [],
				placeholder: "channel_id 或 team_id，逗号分隔",
				onChange: (v) => {
					patch("access.postBlock", v);
				}
			}), (0, react.createElement)("div", { className: "imqb2-group-title" }, "基础设置"), (0, react.createElement)(PolicyRow, {
				label: "群聊/帖子触发方式",
				value: form.mentionPolicy ?? (form.requireMention ?? true ? "require" : "always"),
				help: "仅 @：必须 @ 才回；全部：每条都回；智能：不 @ 也回，但只回与机器人相关的消息",
				onChange: (v) => {
					patch("mentionPolicy", v);
				}
			}), (form.mentionPolicy ?? (form.requireMention ?? true ? "require" : "always")) === "smart" ? (0, react.createElement)(ListRow, {
				label: "机器人别名",
				value: form.botAliases ?? [],
				placeholder: "如 憨包, 小秘（逗号分隔）",
				help: "智能模式下，消息里出现这些名字就当作在叫机器人",
				onChange: (v) => {
					patch("botAliases", v);
				}
			}) : null, (form.mentionPolicy ?? (form.requireMention ?? true ? "require" : "always")) === "smart" ? (0, react.createElement)(NumberRow, {
				label: "追问延续窗口（秒）",
				value: Math.round((form.smartFollowUpMs ?? 12e4) / 1e3),
				min: 10,
				max: 3600,
				step: 10,
				help: "机器人回复后这段时间内，同一个人继续说话也算在跟机器人聊",
				onChange: (v) => {
					patch("smartFollowUpMs", v * 1e3);
				}
			}) : null, (0, react.createElement)(SwitchRow, {
				label: "流式输出",
				checked: form.streaming ?? true,
				help: "回复内容由 msgid 原地编辑分段实时推送",
				onChange: (v) => {
					patch("streaming", v);
				}
			}), (0, react.createElement)(SwitchRow, {
				label: "显示工具调用结果",
				checked: form.showToolResults ?? false,
				help: "在聊天中展示 agent 工具调用的结构化结果",
				onChange: (v) => {
					patch("showToolResults", v);
				}
			}), (0, react.createElement)("div", { className: "imqb2-group-title" }, "上下文"), (0, react.createElement)(NumberRow, {
				label: "群聊上下文条数",
				value: form.historyLimit ?? 10,
				min: 0,
				max: 1e3,
				step: 1,
				help: "群聊/频道里 @机器人 时，把最近 N 条消息一起带给模型；0 = 不带群历史。私聊不受影响（私聊靠会话自身记忆）",
				onChange: (v) => {
					patch("historyLimit", v);
				}
			}), (0, react.createElement)(NumberRow, {
				label: "会话闲置回收（分钟）",
				value: Math.round((form.sessionIdleTimeout ?? 18e5) / 6e4),
				min: 1,
				max: 1440,
				step: 1,
				help: "超过该时长没有新消息就回收内存里的 agent；下次消息会自动 resume 原会话，上下文不丢",
				onChange: (v) => {
					patch("sessionIdleTimeout", v * 6e4);
				}
			}), (0, react.createElement)("div", { className: "imqb2-group-title" }, "模型"), (0, react.createElement)(FieldRow, {
				label: "Provider",
				value: form.provider ?? "",
				placeholder: "留空继承宿主默认",
				onChange: (v) => {
					patch("provider", v);
				}
			}), (0, react.createElement)(FieldRow, {
				label: "Model",
				value: form.model ?? "",
				placeholder: "留空继承宿主默认",
				onChange: (v) => {
					patch("model", v);
				}
			}), (0, react.createElement)(FieldRow, {
				label: "Preset",
				value: form.preset ?? "",
				placeholder: "Agent preset id",
				onChange: (v) => {
					patch("preset", v);
				}
			}), (0, react.createElement)("div", { className: "imqb2-group-title" }, "推推原生能力"), (0, react.createElement)(SwitchRow, {
				label: "交互卡片",
				checked: form["interactive.enabled"] ?? true,
				help: "问答与审批用推推原生交互卡片，支持原地更新",
				onChange: (v) => {
					patch("interactive.enabled", v);
				}
			}), (0, react.createElement)(SwitchRow, {
				label: "中间步骤上报",
				checked: form["agentSteps.enabled"] ?? true,
				help: "把模型/工具调用步骤实时展示在推推客户端",
				onChange: (v) => {
					patch("agentSteps.enabled", v);
				}
			}), (0, react.createElement)(SwitchRow, {
				label: "调试日志",
				checked: form.debug ?? false,
				help: "输出推推 SDK 请求详情（含消息内容，仅排查问题时开启）",
				onChange: (v) => {
					patch("debug", v);
				}
			}), (0, react.createElement)("div", { className: "imqb2-group-title" }, "工作区"), (0, react.createElement)(FieldRow, {
				label: "Agent 工作目录",
				value: form.cwd ?? "",
				placeholder: "留空使用默认（~/.dsh-tuitui/workspace）",
				help: "所有会话（单聊/群聊/频道）共用这一个目录；必须是绝对路径，保存后插件重载生效",
				onChange: (v) => {
					patch("cwd", v);
				}
			}), (0, react.createElement)("div", { className: "imqb2-footer" }, result !== null ? (0, react.createElement)("p", { className: "imqb2-note" + (result.ok ? " imqb2-note--ok" : " imqb2-note--error") }, (result.ok ? "" : "⚠️ ") + result.message) : dirty ? (0, react.createElement)("p", { className: "imqb2-note" }, "保存后插件将重载，进行中的机器人会话将重置") : (0, react.createElement)("p", { className: "imqb2-note" }), (0, react.createElement)("button", {
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
		const PACKAGE_NAME = "@qihoo/dsh-tuitui-bot";
		/** 主面板 id（layout.selectPanel 导航目标；keyed main 席位按其分发） */
		const IM_MAIN_PANEL_ID = "im-tuitui";
		/** 绑定入口图标（推推机器人，跟随主题图标色变量） */
		function BindGuideIcon() {
			return (0, react.createElement)("svg", {
				width: 24,
				height: 24,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": true
			}, (0, react.createElement)("path", {
				d: TUITUI_LOGO_PATH,
				fill: "var(------icon_primary, #1A1A1A)"
			}));
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
			return (0, react.createElement)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": true
			}, (0, react.createElement)("path", {
				d: TUITUI_LOGO_PATH,
				fill: "currentColor"
			}));
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