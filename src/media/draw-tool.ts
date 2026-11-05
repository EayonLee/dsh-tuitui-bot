/**
 * 内置 tuitui_draw 工具 —— 用用户自己配的图像生成模型出图，并直接把图发到当前会话。
 *
 * 为什么要有它：dsh 自带的 generate_image 走的是 dsh 的 provider 体系，
 * 而推推这边用户手里只有一个"OpenAI 兼容网关"。这里让机器人能直接用那套配置出图，
 * 不用去 dsh 设置里再配一遍。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { ImageGenerationConfig } from '../config.ts';
import type { DshAgent, SessionManager } from '../session/index.ts';
import type { Logger, TuituiSender } from '../types.ts';
import { MEDIA_DIR } from '../shared/dirs.ts';
import { generateImage } from './openai-compat.ts';
import { jsonToolOutput } from '../tuitui/tool-output.ts';

export const DRAW_TOOL_NAME = 'tuitui_draw';

interface ToolsRegistryLike {
  register(definition: unknown): unknown;
}

interface DrawArgs {
  prompt?: string;
  size?: string;
  caption?: string;
  send?: boolean;
}

const DESCRIPTION = [
  'Generate an image with the image-generation model configured for this bot, then send it to the current chat.',
  'Args: prompt (required, describe the picture you want), size (optional, e.g. 1024x1024),',
  'caption (optional text sent with the image), send (default true; false = only save the file).',
  'Returns the local file path so you can reference it again.',
].join(' ');

export function registerDrawTool(
  ctx: Context,
  sender: TuituiSender,
  manager: SessionManager,
  config: ImageGenerationConfig,
  logger: Logger,
): void {
  const tools = ctx.get('tools') as ToolsRegistryLike | undefined;
  if (!tools?.register) {
    logger.warn('im-tuitui: tools 服务不可用，tuitui_draw 工具未注册');
    return;
  }

  const definition = {
    name: DRAW_TOOL_NAME,
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What to draw.' },
        size: { type: 'string', description: 'Image size, e.g. 1024x1024.' },
        caption: { type: 'string', description: 'Text to send together with the image.' },
        send: { type: 'boolean', description: 'Send to the current chat (default true).' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    output: jsonToolOutput(),
    async execute(args: unknown, exec?: { agent?: unknown }): Promise<Record<string, unknown>> {
      const a = (args ?? {}) as DrawArgs;
      const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : '';
      if (prompt === '') throw new Error('tuitui_draw: prompt 必填');

      const started = Date.now();
      const image = await generateImage(
        { ...config, size: typeof a.size === 'string' && a.size !== '' ? a.size : config.size },
        prompt,
      );
      mkdirSync(MEDIA_DIR, { recursive: true });
      const file = join(MEDIA_DIR, `draw-${started}.png`);
      writeFileSync(file, image.bytes);
      logger.info(`im-tuitui: tuitui_draw 出图 ${image.bytes.length} 字节 → ${file} (${Date.now() - started}ms)`);

      let sent = false;
      if (a.send !== false) {
        const record = exec?.agent === undefined ? undefined : manager.findByAgent(exec.agent as DshAgent);
        if (record !== undefined) {
          await sender.sendImage(record.replyTarget, file, a.caption === undefined ? {} : { caption: a.caption });
          sent = true;
        }
      }
      return { path: file, bytes: image.bytes.length, model: config.model, sent };
    },
  };

  tools.register(definition);
  logger.info(`im-tuitui: tuitui_draw 工具已注册 (model=${config.model || '未配置'})`);
}
