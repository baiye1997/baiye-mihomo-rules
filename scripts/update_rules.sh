#!/usr/bin/env bash
set -euo pipefail

# 到仓库根目录（脚本在 scripts/ 下）
cd "$(dirname "$0")/.."

SOURCES_FILE="rules_sources.txt"

if [[ ! -f "$SOURCES_FILE" ]]; then
  echo "ERROR: $SOURCES_FILE 不存在，先创建它。"
  exit 1
fi

while IFS= read -r line; do
  # 跳过空行和注释
  [[ -z "$line" || "$line" =~ ^# ]] && continue

  # 拆分为 URL 和 目标路径
  url="$(echo "$line" | awk '{print $1}')"
  dest="$(echo "$line" | awk '{print $2}')"

  if [[ -z "$url" || -z "$dest" ]]; then
    echo "WARN: 跳过异常行：$line"
    continue
  fi

  mkdir -p "$(dirname "$dest")"
  tmpfile="$(mktemp)"

  echo "→ 下载：$url"
  if curl -fsSL "$url" -o "$tmpfile"; then
    if [[ -s "$tmpfile" ]]; then
      # 只有在内容有变化时才替换，避免无意义提交
      if [[ -f "$dest" ]] && cmp -s "$tmpfile" "$dest"; then
        echo "  无变化：$dest"
        rm -f "$tmpfile"
      else
        mv "$tmpfile" "$dest"
        echo "  更新：$dest"
      fi
    else
      echo "WARN: $url 返回空内容，跳过写入。"
      rm -f "$tmpfile"
    fi
  else
    echo "WARN: 下载失败：$url"
    rm -f "$tmpfile"
  fi
done < "$SOURCES_FILE"
