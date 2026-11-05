/**
 * 测试用的最小 tar.gz 生成器 —— 只支持成包需要的三样：目录项不需要、普通文件、ustar 头。
 *
 * 自己写而不是拉依赖：测试要的是"能造出 name/version 可控的包"，
 * 一个 40 行的 tar 写出器比多一个 devDependency 划算。
 */
import { gzipSync } from 'node:zlib';
function octal(value, length) {
    const text = value.toString(8);
    return text.padStart(length - 1, '0') + '\0';
}
function header(name, size) {
    const block = Buffer.alloc(512, 0);
    block.write(name, 0, 100, 'utf8');
    block.write(octal(0o644, 8), 100, 8, 'utf8');
    block.write(octal(0, 8), 108, 8, 'utf8');
    block.write(octal(0, 8), 116, 8, 'utf8');
    block.write(octal(size, 12), 124, 12, 'utf8');
    block.write(octal(Math.floor(Date.now() / 1000), 12), 136, 12, 'utf8');
    block.write('        ', 148, 8, 'utf8');
    block.write('0', 156, 1, 'utf8');
    block.write('ustar\0', 257, 6, 'utf8');
    block.write('00', 263, 2, 'utf8');
    // checksum：先把校验和位置填空格，再算总和
    block.write('        ', 148, 8, 'utf8');
    let sum = 0;
    for (const byte of block)
        sum += byte;
    block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8');
    return block;
}
/** 造一个 tar.gz：keys 是包内路径（如 package/package.json） */
export function makeTarball(files) {
    const parts = [];
    for (const [name, body] of Object.entries(files)) {
        const data = Buffer.from(body, 'utf8');
        parts.push(header(name, data.length), data, Buffer.alloc((512 - (data.length % 512)) % 512, 0));
    }
    parts.push(Buffer.alloc(1024, 0));
    return gzipSync(Buffer.concat(parts));
}
//# sourceMappingURL=tar-fixture.js.map