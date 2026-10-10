#!/usr/bin/env bash
# 跑通插件冒烟测试，不需要启动完整 DSH、不需要 API key。
#
#   ./examples/run.sh
#
# 可覆盖的环境变量：
#   DSH_SRC        deepseek-harness 源码仓库路径（提供 tsx）
#   DSH_HOME       默认 ~/.dsh，从它的 profile node_modules 借用已安装的 DSH 包
#   NODE_BIN       默认用 PATH 里的 node
set -euo pipefail

HARNESS="${DSH_SRC:-/Volumes/LZ_Storage/workspace/ai/AI_codes/deepseek-harness}"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
NODE="${NODE_BIN:-$(command -v node)}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

if [ ! -d "$DSH_HOME_DIR/profiles/node_modules/@deepseek-ai" ]; then
  echo "找不到 $DSH_HOME_DIR/profiles/node_modules/@deepseek-ai，请设置 DSH_HOME 指向你的 DSH 主目录。" >&2
  exit 1
fi
if [ ! -d "$HARNESS/node_modules/tsx" ]; then
  echo "找不到 $HARNESS/node_modules/tsx，请设置 DSH_SRC 指向 deepseek-harness 源码仓库。" >&2
  exit 1
fi

# 为插件文件准备一个可解析 @deepseek-ai/* 与 tsx 的 node_modules。
rm -rf "$ROOT/node_modules"
mkdir -p "$ROOT/node_modules"
ln -sfn "$DSH_HOME_DIR/profiles/node_modules/@deepseek-ai" "$ROOT/node_modules/@deepseek-ai"
ln -sfn "$HARNESS/node_modules/tsx" "$ROOT/node_modules/tsx"

cd "$HERE"
exec "$NODE" --import tsx "$HERE/launch.mjs" "$HERE/cordis.yml"
