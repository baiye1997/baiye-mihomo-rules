#!/usr/bin/env bash
set -euo pipefail

# 到仓库根目录
cd "$(dirname "$0")/.."

SOURCES_FILE="rules/.source/rules_sources.txt"

if [[ ! -f "$SOURCES_FILE" ]]; then
  echo "ERROR: $SOURCES_FILE 不存在，先创建它。"
  exit 1
fi

echo "🚀 开始并发下载规则..."

# 存储后台进程 PID
pids=""

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

  # 放入后台执行
  (
    mkdir -p "$(dirname "$dest")"
    tmpfile="$(mktemp)"
    
    # 增加 User-Agent 避免被拦截
    if curl -fsSL -A "Mozilla/5.0" "$url" -o "$tmpfile"; then
      if [[ -s "$tmpfile" ]]; then
        if [[ -f "$dest" ]] && cmp -s "$tmpfile" "$dest"; then
          echo "  💤 无变化：$dest"
        else
          mv "$tmpfile" "$dest"
          echo "  ✅ 已更新：$dest"
        fi
      else
        echo "  ⚠️ $url 返回空内容，跳过。"
      fi
    else
      echo "  ❌ 下载失败：$url"
    fi
    rm -f "$tmpfile"
  ) &
  
  pids="$pids $!"
done < "$SOURCES_FILE"

# 等待所有后台下载任务结束
wait $pids

echo "🎉 所有规则处理完毕。"
