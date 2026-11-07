#!/usr/bin/env bash
# 打包成正式包：dsh-tuitui-bot-<version>.tgz + 稳定别名 dsh-tuitui-bot.tgz
#
#   ./scripts/pack.sh                # 输出到 /tmp/tuitui-release
#   ./scripts/pack.sh /path/to/dir   # 指定输出目录
#
# 两个文件内容完全一致，用途不同：
#   dsh-tuitui-bot-<version>.tgz  不可变，指哪打哪（固定版本用）
#   dsh-tuitui-bot.tgz            稳定别名，每次发版覆盖上传，配合 GitHub 的
#                                 /releases/latest/download/<file> 永远指向最新版
# 文档里只出现稳定别名，不再写死具体版本号（写死就会出现「照抄命令装成老版本」）。
#
# 为什么不用 `npm pack` 的默认文件名：npm 会把 scope 也拼进去
# （@eayonlee/dsh-tuitui-bot → eayonlee-dsh-tuitui-bot-0.1.29.tgz），
# 而对外发布的正式包统一叫 dsh-tuitui-bot-<version>.tgz。
# 包内 package.json 的名字不变，改名只影响文件本身，不影响 dsh plugin add。
set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
OUT=${1:-/tmp/tuitui-release}
mkdir -p "$OUT"

cd "$REPO"
VERSION=$(node -p "require('./package.json').version")
RAW=$(npm pack --pack-destination "$OUT" 2>/dev/null | tail -1)
TARBALL="$OUT/dsh-tuitui-bot-${VERSION}.tgz"
mv -f "$OUT/$RAW" "$TARBALL"

# 稳定别名：release 上传时两个都传，latest/download 靠它对上最新版
STABLE="$OUT/dsh-tuitui-bot.tgz"
cp -f "$TARBALL" "$STABLE"

echo "$TARBALL"
echo "$STABLE"

