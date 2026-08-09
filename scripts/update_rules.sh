#!/usr/bin/env bash
set -euo pipefail

# 到仓库根目录
cd "$(dirname "$0")/.."

SOURCES_FILE="rules/.source/rules_sources.txt"

sync_generated_file() {
  local tmpfile="$1"
  local dest="$2"

  if [[ -f "$dest" ]] && cmp -s "$tmpfile" "$dest"; then
    rm -f "$tmpfile"
    echo "  💤 无变化：$dest"
  else
    mkdir -p "$(dirname "$dest")"
    mv "$tmpfile" "$dest"
    echo "  ✅ 已生成：$dest"
  fi
}

split_game_rules() {
  local source="rules/yaml/Game.yaml"
  local domain_tmp
  local ip_tmp
  local domain_count
  local ip_count

  [[ -s "$source" ]] || {
    echo "ERROR: $source 不存在或为空，无法拆分游戏规则。"
    return 1
  }

  domain_tmp="$(mktemp)"
  ip_tmp="$(mktemp)"

  awk '
    BEGIN {
      print "# Generated from rules/yaml/Game.yaml by scripts/update_rules.sh"
      print "# Source: blackmatrix7/ios_rule_script (GPL-2.0)"
      print "# Do not edit manually."
    }
    /^[[:space:]]*-[[:space:]]*(DOMAIN|DOMAIN-SUFFIX|DOMAIN-KEYWORD|DOMAIN-WILDCARD|DOMAIN-REGEX),/ {
      line = $0
      sub(/^[[:space:]]*-[[:space:]]*/, "", line)
      print line
    }
  ' "$source" > "$domain_tmp"

  awk '
    BEGIN {
      print "# Generated from rules/yaml/Game.yaml by scripts/update_rules.sh"
      print "# Source: blackmatrix7/ios_rule_script (GPL-2.0)"
      print "# Do not edit manually."
    }
    /^[[:space:]]*-[[:space:]]*(IP-CIDR|IP-CIDR6|GEOIP),/ {
      line = $0
      sub(/^[[:space:]]*-[[:space:]]*/, "", line)
      print line
    }
  ' "$source" > "$ip_tmp"

  domain_count="$(awk '!/^#/ && NF {count++} END {print count + 0}' "$domain_tmp")"
  ip_count="$(awk '!/^#/ && NF {count++} END {print count + 0}' "$ip_tmp")"
  if (( domain_count == 0 || ip_count == 0 )); then
    rm -f "$domain_tmp" "$ip_tmp"
    echo "ERROR: $source 拆分结果异常（domain=$domain_count, ip=$ip_count）。"
    return 1
  fi

  sync_generated_file "$domain_tmp" "rules/non_ip/game.txt"
  sync_generated_file "$ip_tmp" "rules/ip/game.txt"
}

if [[ ! -f "$SOURCES_FILE" ]]; then
  echo "ERROR: $SOURCES_FILE 不存在，先创建它。"
  exit 1
fi

echo "🚀 开始并发下载规则..."

# 存储后台进程 PID
pids=()

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
    status=0
    mkdir -p "$(dirname "$dest")"
    tmpfile="$(mktemp)"
    
    # 增加 User-Agent 避免被拦截
    if curl -fsSL --connect-timeout 10 --max-time 60 --retry 2 -A "Mozilla/5.0" "$url" -o "$tmpfile"; then
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
      status=1
    fi
    rm -f "$tmpfile"
    exit "$status"
  ) &
  
  pids+=("$!")
done < "$SOURCES_FILE"

# 等待所有后台下载任务结束
failed=0
for pid in "${pids[@]}"; do
  if ! wait "$pid"; then
    failed=1
  fi
done

if (( failed )); then
  echo "❌ 部分规则下载失败，请检查上方日志。"
  exit 1
fi

split_game_rules

echo "🎉 所有规则处理完毕。"
