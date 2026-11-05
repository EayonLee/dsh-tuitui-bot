#!/usr/bin/env bash
# 打包成正式包：dsh-tuitui-bot-<version>.tgz
#
#   ./scripts/pack.sh                # 输出到 /tmp/tuitui-release
#   ./scripts/pack.sh /path/to/dir   # 指定输出目录
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
echo "$TARBALL"

