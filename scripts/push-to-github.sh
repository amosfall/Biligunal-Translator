#!/usr/bin/env bash
# 将当前仓库推送到已配置的 origin（默认分支 main）。不会删除或重建 remote。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
BRANCH="${1:-main}"
git push origin "$BRANCH"
