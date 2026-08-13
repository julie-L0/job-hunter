#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -ne 1 ]]; then
  echo "用法：npm run start-feature -- 功能名"
  echo "示例：npm run start-feature -- local-outbox-sync"
  exit 2
fi

name="$1"
if [[ "$name" == feature/* ]]; then
  branch="$name"
else
  branch="feature/$name"
fi

git_cmd=(git -C "$ROOT")
if [[ -d "$ROOT/.git-local" ]]; then
  git_cmd=(git --git-dir="$ROOT/.git-local" --work-tree="$ROOT")
fi

status="$(${git_cmd[@]} status --short)"
if [[ -n "$status" ]]; then
  echo "工作区不干净，先处理这些改动再开新分支："
  echo "$status"
  exit 1
fi

echo "更新远端 main..."
"${git_cmd[@]}" fetch origin main

if "${git_cmd[@]}" show-ref --verify --quiet refs/heads/main; then
  "${git_cmd[@]}" switch main
else
  "${git_cmd[@]}" switch -c main origin/main
fi

"${git_cmd[@]}" pull --ff-only origin main
"${git_cmd[@]}" switch -c "$branch"

echo "已创建分支：$branch"
