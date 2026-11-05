#!/usr/bin/env bash
# 一条命令把改动送到正在跑的 web profile 里
#
#   ./scripts/ship.sh            # 当前版本号重装（同版本会被 pnpm 跳过，见下）
#   ./scripts/ship.sh 0.1.4      # 顺手升版本号
#
# 为什么每次都要升版本号：pnpm 对「同一个 package 名 + 同一个 file: tarball 路径」
# 会认为已是最新而直接跳过重装——装进去的还是上一次的字节，页面/后端看起来
# 「一点没动」。升个版本号是最省事、最不会骗自己的破法。
#
# 脚本只负责「装进去」，不重启进程：重启是人的决定。
set -euo pipefail

PROFILE=${TUITUI_PROFILE:-web}
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPO"

NEXT=${1:-}
if [ -n "$NEXT" ]; then
  # 版本号没变不算错（比如刚被别人 bump 过），继续装就是
  npm version "$NEXT" --no-git-tag-version >/dev/null 2>&1 || true
fi
VERSION=$(node -p "require('./package.json').version")

echo "▶ 测试"
npx vitest run --reporter=dot 2>&1 | tail -3

echo "▶ 构建 $VERSION"
npm run build 2>&1 | tail -2

echo "▶ 校验客户端 bundle"
# 这类事故靠肉眼发现不了：常量没被打进去，运行期才炸成 "X is not defined"
for literal in "im-tuitui/test-model" "测试中…"; do
  grep -q "$literal" lib/client.js || { echo "✗ bundle 里找不到 $literal（客户端构建不完整）"; exit 1; }
done
if grep -q "TEST_MODEL_PATH" lib/client.js && ! grep -q 'const TEST_MODEL_PATH = "' lib/client.js; then
  echo "✗ bundle 里用了 TEST_MODEL_PATH 却没有定义（点了就会报 is not defined）"
  exit 1
fi

# 每次换一个目录：pnpm 按「包名 + file: 路径」记 lockfile，路径不变就跳过重装
STAMP=$(date +%H%M%S)
OUT="/tmp/tuitui-ship-$STAMP"
mkdir -p "$OUT"
echo "▶ 打包 $OUT"
# 统一走 pack.sh：它的产物名是 dsh-tuitui-bot-<version>.tgz（npm pack 会带 scope 前缀）
TARBALL=$(./scripts/pack.sh "$OUT" | tail -1)

echo "▶ 装进 profile:$PROFILE"
dsh plugin --profile "$PROFILE" add "$TARBALL" 2>&1 | tail -2

INSTALLED=$(node -p "require(process.env.HOME + '/.dsh/profiles/$PROFILE/node_modules/@eayonlee/dsh-tuitui-bot/package.json').version")
echo "✔ 已安装 $INSTALLED（客户端 bundle 刷新页面即生效，服务端代码要重启进程）"
echo "  重启：~/bin/dsh-restart"
