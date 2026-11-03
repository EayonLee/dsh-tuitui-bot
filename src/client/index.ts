/**
 * im-tuitui 浏览器半边 — 推推机器人端内绑定与配置入口
 *
 * 宿主插件在凭据缺失时注册 /tuitui/im-tuitui/bind 状态路由；本插件在
 * Web / Desktop 提供两个展示位：
 *
 * 1. 设置页「推推机器人」栏目（settings.section 席位）——注册即展示，
 *    无 Session surface 时序依赖，待绑定/已绑定状态常驻可见；
 * 2. 右侧栏「推推机器人绑定」页（sidebarRightTabs）——Start 页入口 +
 *    待绑定时自动打开（失败随轮询重试）。
 *
 * 与上游差异：推推无扫码，绑定页只有「手填凭据 + 校验」一条路径，
 * 因此不再有二维码相关的等待/刷新相位。
 *
 * 运行时依赖仅 react（客户端平台种子表提供）；宿主服务经 cordis inject
 * 声明访问（声明缺失时插件保持 inactive，不阻塞浏览器启动）。
 */
import type { Context } from '@deepseek-ai/cordis';
import { createElement, type ReactNode } from 'react';
import { BIND_STATE_PATH } from '../shared/bind-protocol.ts';
import { BindPanelBody, useBindState, TUITUI_LOGO_PATH, installPanelStyles } from './bind-page.ts';
import { ConfigPanel } from './config-panel.ts';

export const name = 'im-tuitui-client';
export const inject = ['slots', 'sidebarRight', 'sidebarRightTabs'];

/** 侧栏 Tab 类型（ui-sidebar-right 契约的局部投影） */
const TAB_KIND = 'tuitui-bind';
/** 席位注册 key（Tab 类型 id，席位按其分发；只需全局唯一，与包名解耦） */
const TAB_ID = 'im-tuitui/bind';
/** 本插件包名（插件详情页按其匹配来源包，只在对应详情页渲染操作按钮） */
const PACKAGE_NAME = '@qihoo/dsh-tuitui-bot';
/** 主面板 id（layout.selectPanel 导航目标；keyed main 席位按其分发） */
const IM_MAIN_PANEL_ID = 'im-tuitui';

/** ui-sidebar-right 的 Tab 注册表服务（局部投影） */
interface TabRegistryLike {
  register(definition: {
    id: string;
    kind: string;
    title: (address: string) => string;
    guide?: ReadonlyArray<{
      id: string;
      order: number;
      title: () => string;
      description: () => string;
      icon: unknown;
    }>;
  }): () => void;
}

/** ui-sidebar-right 的导航控制器服务（局部投影） */
interface SidebarRightLike {
  openTab(kind: string, options?: Record<string, unknown>): unknown;
}

/** ui-slots 的席位系统服务（局部投影） */
interface SlotsLike {
  inject(slotName: string, register: () => (() => void)): () => void;
  register(spec: Record<string, unknown>, component: unknown): () => void;
}

/** 绑定入口图标（推推机器人，跟随主题图标色变量） */
function BindGuideIcon(): ReactNode {
  return createElement('svg', {
    width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true,
  },
    createElement('path', {
      d: TUITUI_LOGO_PATH,
      fill: 'var(------icon_primary, #1A1A1A)',
    }),
  );
}

/** 设置页栏目：共享一份绑定状态轮询，驱动绑定面板与配置刷新 */
function TuituiSettingsSection(): ReactNode {
  const { state, gone, recheck } = useBindState();
  return createElement('div', null,
    createElement(BindPanelBody, { state, gone, recheck }),
    createElement(ConfigPanel, { bindPhase: state?.phase }),
  );
}

/** 主面板页面：与设置栏目同一内容，包一层滚动留白容器（plugins.detail.actions 的跳转目标） */
function TuituiPage(): ReactNode {
  return createElement('div', { className: 'imqb-pluginPage' },
    createElement('div', { className: 'imqb-pluginPageContent' },
      createElement(TuituiSettingsSection),
    ),
  );
}

/** 左侧栏入口图标（宿主传入 size：展开 18 / 收起 16；currentColor 跟随侧栏配色与选中态） */
function TuituiSidebarIcon({ size = 16 }: { size?: number; active?: boolean }): ReactNode {
  return createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true,
  },
    createElement('path', { d: TUITUI_LOGO_PATH, fill: 'currentColor' }));
}

/** 插件详情「设置」按钮：仅在本包的 bundle / 组件行详情页渲染，其他插件不显示 */
function OpenTuituiAction({ subject, packageName, onOpen }: {
  subject?: { kind?: string; pkg?: { name?: string }; row?: { moduleName?: string } };
  packageName: string;
  onOpen: () => void;
}): ReactNode {
  if (subject?.kind !== 'bundle' && subject?.kind !== 'row') return null;
  if (subject.pkg?.name !== packageName) return null;
  if (subject.kind === 'row' && subject.row?.moduleName !== packageName) return null;
  return createElement('button', {
    type: 'button', className: 'imqb-pluginOpen', onClick: onOpen,
  }, '设置');
}

export function apply(ctx: Context): void {
  // 面板样式全局安装：插件详情按钮等面板外渲染的元素也需要可见
  installPanelStyles();
  const tabs = (ctx as unknown as { sidebarRightTabs?: TabRegistryLike }).sidebarRightTabs;
  const right = (ctx as unknown as { sidebarRight?: SidebarRightLike }).sidebarRight;
  const slots = (ctx as unknown as { slots?: SlotsLike }).slots;

  const disposers: Array<() => void> = [];

  // 1. 设置页「推推机器人」栏目（主展示位：注册即展示，无时序依赖）
  if (slots !== undefined) {
    disposers.push(slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'tuitui', order: 7, label: '推推机器人' },
      TuituiSettingsSection,
    )));
  }

  // 2. 侧栏绑定页（快捷展示位：Start 页入口 + 待绑定自动打开）
  if (tabs !== undefined && slots !== undefined) {
    disposers.push(tabs.register({
      id: TAB_ID,
      kind: TAB_KIND,
      title: () => '推推机器人绑定',
      guide: [{
        id: 'bind',
        order: 90,
        title: () => '推推机器人绑定',
        description: () => '填写 AppID / AppSecret，绑定推推机器人',
        icon: BindGuideIcon,
      }],
    }));
    disposers.push(slots.inject('sidebar.right.pane.tab', () => slots.register(
      { name: 'sidebar.right.pane.tab', key: TAB_ID },
      BindPanelBody,
    )));
    // 待绑定检测与自动引导
    disposers.push(watchAndPrompt(right));
  }

  // 3. 主面板 + 插件详情「设置」操作（layout.selectPanel 导航）
  const ctxInject = (ctx as unknown as {
    inject?: (deps: readonly string[], callback: (pageCtx: Context) => (() => void) | undefined) => unknown;
  }).inject;
  if (typeof ctxInject === 'function') {
    // ctx.inject 返回 Fiber（非 disposer）：子插件随父插件卸载自动清理，
    // 回调返回的清理函数由 cordis 在依赖变更/卸载时调用。
    void ctxInject.call(ctx, ['layout'], (pageCtx: Context) => {
      const pageSlots = (pageCtx as unknown as { slots?: SlotsLike }).slots;
      const layout = (pageCtx as unknown as { layout?: { selectPanel(panelId: string | null): void } }).layout;
      if (pageSlots === undefined || layout === undefined) return undefined;
      const stopMain = pageSlots.inject('main', () => pageSlots.register(
        { name: 'main', key: IM_MAIN_PANEL_ID },
        TuituiPage,
      ));
      const stopActions = pageSlots.inject('plugins.detail.actions', () => pageSlots.register(
        {
          name: 'plugins.detail.actions', id: 'im-tuitui-open', order: 20,
          inject: () => ({
            packageName: PACKAGE_NAME,
            onOpen: () => layout.selectPanel(IM_MAIN_PANEL_ID),
          }),
        },
        OpenTuituiAction,
      ));
      // 左侧栏入口：id 与 main 席位 key 一致，宿主点击即 selectPanel
      const stopSidebar = pageSlots.inject('sidebar.panellist', () => pageSlots.register(
        {
          name: 'sidebar.panellist', id: IM_MAIN_PANEL_ID,
          order: 10, label: '推推机器人',
        },
        TuituiSidebarIcon,
      ));
      return () => {
        stopActions();
        stopSidebar();
        stopMain();
      };
    });
  }

  (ctx as unknown as { effect(fn: () => () => void, name?: string): void }).effect(() => () => {
    for (const dispose of disposers.reverse()) dispose();
  }, 'im-tuitui-client.binding');
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
function watchAndPrompt(right: SidebarRightLike | undefined): () => void {
  let stopped = false;
  let opened = right === undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (ms: number): void => {
    timer = setTimeout(() => { void tick(); }, ms);
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      schedule(5000);
      return;
    }
    try {
      const res = await fetch(BIND_STATE_PATH, { cache: 'no-store' });
      if (res.ok) {
        const body = (await res.json()) as { phase?: string };
        if (body.phase === 'unconfigured' && !opened && right !== undefined) {
          try {
            right.openTab(TAB_KIND);
            opened = true;
          } catch (err) {
            // 启动早期 Session surface 可能尚未挂载：保留机会，3s 后随轮询重试
            console.error('[im-tuitui] 打开绑定页失败，稍后重试', err);
          }
        }
        schedule(3000);
        return;
      }
      // 404：已绑定或插件未启用
      schedule(30000);
      return;
    } catch {
      // 宿主暂不可达（启动窗口期）：退避重试
    }
    schedule(10000);
  };

  void tick();
  return () => { stopped = true; if (timer !== undefined) clearTimeout(timer); };
}
