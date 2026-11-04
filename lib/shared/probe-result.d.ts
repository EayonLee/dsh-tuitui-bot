/**
 * 把「连接测试」接口的响应翻译成一句人话。
 *
 * 抽成纯函数的原因：之前这层逻辑写在组件里，detail 字段名写岔了一个字，
 * 页面上就成了「✗ undefined」——错在渲染，但看着像配置错了，排查方向全跑偏。
 * 放这里之后有单测兜着，且保证 detail 永远是非空字符串。
 */
export interface ProbeOutcome {
    ok: boolean;
    /** 一定会是给人看的非空字符串，不会出现 undefined */
    detail: string;
}
export declare function interpretTestResponse(status: number, body: unknown): ProbeOutcome;
//# sourceMappingURL=probe-result.d.ts.map