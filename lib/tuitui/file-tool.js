import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
export const FILE_TOOL_NAME = 'tuitui_file';
const DESCRIPTION = [
    'Work with Tuitui files. Actions:',
    '- upload: upload a local file, returns fid (source_path)',
    '- query: fid -> download url',
    '- batch_query: several fids -> urls (fids)',
    '- list_nodes / list_files: browse a file space (space_id, optional space_type)',
    '- list_team_files: files attached to a team channel (channel_id)',
    '- add_node / delete_node: add or delete a file-space node (needs confirm=true)',
    '- add_file: upload a local file into a file space (needs confirm=true)',
    'Local paths must exist on disk; space/channel ids come from the current conversation.',
].join(' ');
const CONFIRM_ACTIONS = new Set(['add_node', 'delete_node', 'add_file']);
function str(a, key) {
    const v = a[key];
    if (typeof v !== 'string' || v.trim() === '')
        throw new Error(`tuitui_file: ${key} 必填`);
    return v.trim();
}
function localPath(a) {
    const abs = resolve(str(a, 'source_path'));
    if (!existsSync(abs))
        throw new Error(`tuitui_file: 文件不存在: ${abs}`);
    return abs;
}
export function registerFileTool(ctx, client, logger) {
    const tools = ctx.get('tools');
    if (!tools?.register) {
        logger.warn('im-tuitui: tools 服务不可用，tuitui_file 工具未注册');
        return;
    }
    const definition = {
        name: FILE_TOOL_NAME,
        description: DESCRIPTION,
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['upload', 'query', 'batch_query', 'list_nodes', 'list_files', 'list_team_files', 'add_node', 'delete_node', 'add_file'],
                    description: 'Which file operation to perform.',
                },
                source_path: { type: 'string', description: 'Absolute local path (upload / add_file).' },
                fid: { type: 'string', description: 'File id (query).' },
                fids: { type: 'array', items: { type: 'string' }, description: 'File ids (batch_query).' },
                space_id: { type: 'string', description: 'File space id.' },
                space_type: { type: 'string', enum: ['1', '2', '3'], description: '1 group / 2 team / 3 channel.' },
                parent_id: { type: 'string', description: 'Parent node id (add_node).' },
                node_id: { type: 'string', description: 'Node id (delete_node).' },
                name: { type: 'string', description: 'Node name (add_node).' },
                channel_id: { type: 'string', description: 'Team channel id (list_team_files).' },
                cloud_path: { type: 'string', description: 'Destination path inside the space (add_file).' },
                confirm: { type: 'boolean', description: 'Required for add_node/delete_node/add_file.' },
            },
            required: ['action'],
            additionalProperties: false,
        },
        async execute(args) {
            const a = (args ?? {});
            const action = str(a, 'action');
            if (CONFIRM_ACTIONS.has(action) && a.confirm !== true) {
                throw new Error(`tuitui_file: ${action} 会改文件空间，必须带 confirm=true（先跟老板确认）`);
            }
            switch (action) {
                case 'upload': {
                    const up = await client.file.upload(localPath(a));
                    logger.info(`im-tuitui: tuitui_file 上传 ${up.filename} fid=${up.fid}`);
                    return { action, fid: up.fid, filename: up.filename, filesize: up.filesize, mediaType: up.mediaType };
                }
                case 'query': {
                    const url = await client.file.query(str(a, 'fid'));
                    return { action, fid: a.fid, url };
                }
                case 'batch_query': {
                    if (!Array.isArray(a.fids) || a.fids.length === 0)
                        throw new Error('tuitui_file: fids 需要非空数组');
                    const urls = await client.file.batchQuery(a.fids.map(String));
                    return { action, urls: urls };
                }
                case 'list_nodes': {
                    const nodes = await client.fileSpace.listNodes({
                        spaceId: str(a, 'space_id'),
                        ...(a.space_type !== undefined ? { spaceType: a.space_type } : {}),
                    });
                    return { action, count: nodes.length, nodes };
                }
                case 'list_files': {
                    const files = await client.fileSpace.listFiles({
                        spaceId: str(a, 'space_id'),
                        ...(a.space_type !== undefined ? { spaceType: a.space_type } : {}),
                    });
                    return { action, count: files.length, files };
                }
                case 'list_team_files': {
                    const files = await client.fileSpace.listTeamFilesByChannel(str(a, 'channel_id'));
                    return { action, count: files.length, files };
                }
                case 'add_node': {
                    await client.fileSpace.addNode({
                        space_id: str(a, 'space_id'),
                        space_type: typeof a.space_type === 'string' ? a.space_type : '2',
                        node_type: typeof a.node_id === 'string' ? '1' : '1',
                        name: str(a, 'name'),
                        ...(a.parent_id !== undefined ? { parent_id: a.parent_id } : {}),
                    });
                    return { action, done: true, name: a.name };
                }
                case 'delete_node': {
                    await client.fileSpace.deleteNode({
                        space_id: str(a, 'space_id'),
                        space_type: typeof a.space_type === 'string' ? a.space_type : '2',
                        node_id: str(a, 'node_id'),
                    });
                    logger.info(`im-tuitui: tuitui_file 删除节点 ${a.node_id}`);
                    return { action, done: true, node_id: a.node_id };
                }
                case 'add_file': {
                    await client.fileSpace.addFile({
                        spaceId: str(a, 'space_id'),
                        ...(typeof a.space_type === 'string' ? { spaceType: a.space_type } : {}),
                    }, str(a, 'cloud_path'), localPath(a));
                    return { action, done: true, cloud_path: a.cloud_path };
                }
                default:
                    throw new Error(`tuitui_file: 不认识的 action: ${action}`);
            }
        },
    };
    tools.register(definition);
    logger.info('im-tuitui: tuitui_file 工具已注册');
}
//# sourceMappingURL=file-tool.js.map