/**
 * media/vision-tool 单测 —— 视觉工具注册/执行与 settings.yaml 的 input 模态兜底
 *
 * 覆盖：图片装载（大小上限、magic bytes 嗅探、远端下载失败）、工具注册的
 * 降级分支、prompt 缺省、LLM 终态错误、以及 ensureVisionInputModal 的
 * 幂等补写 / 文档保真 / 大整数保留 / tab 缩进容错。
 *
 * settings.yaml 通过 DSH_HOME 指向临时目录，不触碰用户真实配置。
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import type { VisionConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import { ensureVisionInputModal, registerDescribeImageTool, DESCRIBE_IMAGE_TOOL_NAME } from './vision-tool.ts';

const dirs: string[] = [];

async function makeDshHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tuitui-dsh-home-'));
  dirs.push(dir);
  process.env.DSH_HOME = dir;
  return dir;
}

function makeLogger(): { logger: Logger; info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } {
  const info = vi.fn();
  const warn = vi.fn();
  return { logger: { info, warn, debug: vi.fn(), error: vi.fn() } as unknown as Logger, info, warn };
}

const vision: VisionConfig = {
  enabled: true,
  provider: 'google',
  model: 'gemini-flash',
  defaultPrompt: '描述这张图',
  maxBytes: 1024,
  maxTokens: 512,
  timeoutMs: 5000,
};

function settingsYaml(extraModels = ''): string {
  return [
    '# 用户设置的注释，必须保留',
    'llm:',
    '  default: deepseek-chat',
    'llm-pi-ai:',
    '  providers:',
    '    google:',
    '      apiKey: secret-key',
    '      models:',
    '        - id: gemini-flash',
    '          name: Gemini Flash',
    extraModels,
    '    other:',
    '      models: []',
    '',
  ].join('\n');
}

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.DSH_HOME;
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

function modelInput(text: string, provider = 'google', id = 'gemini-flash'): unknown {
  const doc = parse(text) as Record<string, unknown>;
  const providers = (doc['llm-pi-ai'] as { providers: Record<string, { models: Array<Record<string, unknown>> }> }).providers;
  const model = providers[provider]?.models.find((item) => item.id === id);
  return model?.input;
}

/** 构造一个能通过 magic bytes 嗅探的 PNG 字节串 */
function pngBytes(size = 16): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
}

describe('ensureVisionInputModal 启动兜底', () => {
  it('vision 未启用或 provider/model 缺省时完全不碰 settings.yaml', async () => {
    const home = await makeDshHome();
    const settingsPath = join(home, 'settings.yaml');
    await writeFile(settingsPath, 'broken: [', 'utf8');
    const { logger, warn, info } = makeLogger();

    ensureVisionInputModal({ ...vision, enabled: false }, logger);
    ensureVisionInputModal({ ...vision, provider: '' }, logger);
    ensureVisionInputModal({ ...vision, model: '' }, logger);

    expect(await readFile(settingsPath, 'utf8')).toBe('broken: [');
    expect(warn).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it('settings.yaml 不存在时静默返回（不创建文件）', async () => {
    const home = await makeDshHome();
    const { logger, warn } = makeLogger();

    ensureVisionInputModal(vision, logger);

    expect(existsSync(join(home, 'settings.yaml'))).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('未声明 image 时补写 input: [text, image]，注释与其他配置原样保留', async () => {
    const home = await makeDshHome();
    const settingsPath = join(home, 'settings.yaml');
    await writeFile(settingsPath, settingsYaml(), 'utf8');
    const { logger, info } = makeLogger();

    ensureVisionInputModal(vision, logger);

    const text = await readFile(settingsPath, 'utf8');
    expect(text).toContain('# 用户设置的注释，必须保留');
    expect(text).toContain('apiKey: secret-key');
    expect(modelInput(text)).toEqual(['text', 'image']);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('input: [text, image]'));
  });

  it('已声明 image 时幂等：文件逐字不变且不打印 info', async () => {
    const home = await makeDshHome();
    const settingsPath = join(home, 'settings.yaml');
    const original = settingsYaml('        - id: already\n          input: [text, image]');
    await writeFile(settingsPath, original, 'utf8');
    const { logger, info } = makeLogger();

    ensureVisionInputModal({ ...vision, model: 'already' }, logger);

    expect(await readFile(settingsPath, 'utf8')).toBe(original);
    expect(info).not.toHaveBeenCalled();
  });

  it('provider 不存在时 warn 提示手动确认，不写文件', async () => {
    const home = await makeDshHome();
    const settingsPath = join(home, 'settings.yaml');
    const original = settingsYaml();
    await writeFile(settingsPath, original, 'utf8');
    const { logger, warn } = makeLogger();

    ensureVisionInputModal({ ...vision, provider: 'missing-provider' }, logger);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing-provider'));
    expect(await readFile(settingsPath, 'utf8')).toBe(original);
  });

  it('模型不存在时 warn 提示，不写文件', async () => {
    const home = await makeDshHome();
    const settingsPath = join(home, 'settings.yaml');
    const original = settingsYaml();
    await writeFile(settingsPath, original, 'utf8');
    const { logger, warn } = makeLogger();

    ensureVisionInputModal({ ...vision, model: 'nope-model' }, logger);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('nope-model'));
    expect(await readFile(settingsPath, 'utf8')).toBe(original);
  });

  it('settings.yaml 顶层不是映射时只 warn，不抛错', async () => {
    const home = await makeDshHome();
    const settingsPath = join(home, 'settings.yaml');
    await writeFile(settingsPath, '- just\n- a\n- list\n', 'utf8');
    const { logger, warn } = makeLogger();

    expect(() => { ensureVisionInputModal(vision, logger); }).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('顶层不是映射'));
    expect(await readFile(settingsPath, 'utf8')).toBe('- just\n- a\n- list\n');
  });

  it('写出时不把其他配置里的大整数截断到 2^53 精度', async () => {
    const home = await makeDshHome();
    const settingsPath = join(home, 'settings.yaml');
    await writeFile(settingsPath, settingsYaml().replace('  default: deepseek-chat', '  installId: 9007199254740993'), 'utf8');
    const { logger } = makeLogger();

    ensureVisionInputModal(vision, logger);

    const text = await readFile(settingsPath, 'utf8');
    expect(text).toContain('installId: 9007199254740993');
    expect(modelInput(text)).toEqual(['text', 'image']);
  });

  it('行首 tab 缩进的 settings.yaml 也能解析并补写', async () => {
    const home = await makeDshHome();
    const settingsPath = join(home, 'settings.yaml');
    const tabbed = [
      'llm-pi-ai:',
      '\tproviders:',
      '\t\tgoogle:',
      '\t\t\tmodels:',
      '\t\t\t\t- id: gemini-flash',
      '',
    ].join('\n');
    await writeFile(settingsPath, tabbed, 'utf8');
    const { logger } = makeLogger();

    ensureVisionInputModal(vision, logger);

    expect(modelInput(await readFile(settingsPath, 'utf8'))).toEqual(['text', 'image']);
  });
});

describe('registerDescribeImageTool', () => {
  interface ToolDefinition {
    name: string;
    parameters: { required: string[] };
    output: { render: (args: unknown, value: unknown) => Array<{ type: string; text: string }> };
    execute(args: unknown, exec: { signal: AbortSignal }): Promise<Record<string, unknown>>;
  }

  interface SetupOptions {
    enabled?: boolean;
    provider?: string;
    model?: string;
    services?: boolean;
    chunks?: unknown[];
    savedRef?: Record<string, unknown>;
  }

  function setupTool(options: SetupOptions = {}) {
    const defs: ToolDefinition[] = [];
    const saved: Array<{ data: Uint8Array; mediaType: string; name?: string }> = [];
    const streamOptions: Array<Record<string, unknown>> = [];
    const ctx = {
      get(name: string) {
        if (options.services === false) return undefined;
        if (name === 'tools') return { register: (definition: unknown) => { defs.push(definition as ToolDefinition); } };
        if (name === 'llm') {
          return {
            stream(streamOption: Record<string, unknown>) {
              streamOptions.push(streamOption);
              const chunks = options.chunks ?? [
                { type: 'block-start', index: 0, blockType: 'text' },
                { type: 'text-delta', index: 0, text: '一只猫' },
                { type: 'finish', reason: { kind: 'stop' } },
              ];
              return (async function* generate() { for (const chunk of chunks) yield chunk; })();
            },
          };
        }
        if (name === 'attachments') {
          return {
            async saveImage(input: { data: Uint8Array; mediaType: string; name?: string }) {
              saved.push(input);
              return options.savedRef ?? {
                attachmentId: 'sha256:abc',
                mediaType: input.mediaType,
                bytes: input.data.length,
                name: input.name,
              };
            },
          };
        }
        return undefined;
      },
    };
    const { logger, warn } = makeLogger();
    const toolConfig: VisionConfig = {
      ...vision,
      enabled: options.enabled ?? true,
      provider: options.provider ?? vision.provider,
      model: options.model ?? vision.model,
    };
    registerDescribeImageTool(ctx as never, toolConfig, logger);
    return { defs, saved, streamOptions, warn, definition: defs[0], config: toolConfig };
  }

  const signal = new AbortController().signal;

  it('未启用时不注册，也不 warn', () => {
    const { defs, warn } = setupTool({ enabled: false });
    expect(defs).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('provider/model 未配置时 warn 并且不注册', () => {
    const { defs, warn } = setupTool({ provider: '' });
    expect(defs).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('vision.provider/model 未配置'));
  });

  it('tools/llm/attachments 任一服务缺失时 warn 并且不注册', () => {
    const { defs, warn } = setupTool({ services: false });
    expect(defs).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('服务不可用'));
  });

  it('注册定义：名称与必填 image 参数、render 直出文本', () => {
    const { definition } = setupTool();
    expect(definition?.name).toBe(DESCRIBE_IMAGE_TOOL_NAME);
    expect(definition?.parameters.required).toEqual(['image']);
    expect(definition?.output.render(undefined, { text: '图中是一只猫' })).toEqual([{ type: 'text', text: '图中是一只猫' }]);
  });

  it('image 为空或非字符串时报错', async () => {
    const { definition } = setupTool();
    await expect(definition!.execute({}, { signal })).rejects.toThrow('image');
    await expect(definition!.execute({ image: '' }, { signal })).rejects.toThrow('image');
  });

  it('本地图片不存在时报错（下载失败降级）', async () => {
    const home = await makeDshHome();
    const { definition } = setupTool();

    await expect(definition!.execute({ image: join(home, 'nope.png') }, { signal }))
      .rejects.toThrow('image file not found');
  });

  it('本地图片超过 maxBytes 时拒绝，不调用 saveImage', async () => {
    const home = await makeDshHome();
    const file = join(home, 'big.png');
    await writeFile(file, pngBytes(2048));
    const { definition, saved } = setupTool();

    await expect(definition!.execute({ image: file }, { signal }))
      .rejects.toThrow(/image too large \(2048 bytes\)/);
    expect(saved).toEqual([]);
  });

  it('magic bytes 不认识时拒绝（不信任扩展名）', async () => {
    const home = await makeDshHome();
    const file = join(home, 'fake.png');
    await writeFile(file, Buffer.from('这其实是一个文本文件，不是图片内容，长度足够十六字节'));
    const { definition, saved } = setupTool();

    await expect(definition!.execute({ image: file }, { signal }))
      .rejects.toThrow('unrecognized image format');
    expect(saved).toEqual([]);
  });

  it('成功路径：嗅探 png、saveImage 带原始文件名、返回文本与元数据', async () => {
    const home = await makeDshHome();
    const file = join(home, 'cat.png');
    const bytes = pngBytes();
    await writeFile(file, bytes);
    const { definition, saved, streamOptions, config } = setupTool();

    const result = await definition!.execute({ image: file, prompt: '图里有什么？' }, { signal });

    expect(result).toEqual({
      text: '一只猫',
      model: config.model,
      image: file,
      mimeType: 'image/png',
      bytes: bytes.length,
    });
    expect(saved).toEqual([{ data: expect.any(Uint8Array), mediaType: 'image/png', name: 'cat.png' }]);
    expect(streamOptions[0]).toMatchObject({
      provider: config.provider,
      model: config.model,
      maxTokens: config.maxTokens,
    });
    const messages = streamOptions[0]?.messages as Array<{ content: Array<{ type: string; text?: string }> }>;
    expect(messages[0]?.content.some((block) => block.type === 'text' && block.text === '图里有什么？')).toBe(true);
  });

  it('未传 prompt 时使用 defaultPrompt', async () => {
    const home = await makeDshHome();
    const file = join(home, 'a.png');
    await writeFile(file, pngBytes());
    const { definition, streamOptions } = setupTool();

    await definition!.execute({ image: file }, { signal });

    const messages = streamOptions[0]?.messages as Array<{ content: Array<{ type: string; text?: string }> }>;
    expect(messages[0]?.content.some((block) => block.type === 'text' && block.text === '描述这张图')).toBe(true);
  });

  it('模型终态是 error 时把 failure 文案抛给调用方', async () => {
    const home = await makeDshHome();
    const file = join(home, 'a.png');
    await writeFile(file, pngBytes());
    const { definition } = setupTool({
      chunks: [
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: '部分输出' },
        { type: 'finish', reason: { kind: 'error', failure: { message: '模型过载', code: 'overloaded' } } },
      ],
    });

    await expect(definition!.execute({ image: file }, { signal })).rejects.toThrow('模型过载');
  });

  it('模型返回空文本时报错', async () => {
    const home = await makeDshHome();
    const file = join(home, 'a.png');
    await writeFile(file, pngBytes());
    const { definition } = setupTool({ chunks: [{ type: 'finish', reason: { kind: 'stop' } }] });

    await expect(definition!.execute({ image: file }, { signal })).rejects.toThrow('returned no text');
  });

  it('远端 URL 下载失败时降级为可读错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const { definition } = setupTool();

    await expect(definition!.execute({ image: 'https://cdn.example.com/a.png' }, { signal }))
      .rejects.toThrow('download failed (HTTP 500)');
  });

  it('远端 URL 成功时 saveImage 不带本地文件名', async () => {
    const bytes = pngBytes();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes, { status: 200 })));
    const { definition, saved } = setupTool();

    const result = await definition!.execute({ image: 'https://cdn.example.com/path/cat.png?x=1' }, { signal });

    expect(result).toMatchObject({ mimeType: 'image/png', bytes: bytes.length });
    expect(saved[0]?.name).toBeUndefined();
  });
});
