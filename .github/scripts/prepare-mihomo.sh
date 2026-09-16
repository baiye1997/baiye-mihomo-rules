#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$RUNNER_TEMP/mihomo-check"
cd "$RUNNER_TEMP/mihomo-check"
curl -fSL --retry 2 --max-time 120 -o mihomo.gz https://github.com/MetaCubeX/mihomo/releases/download/v1.19.29/mihomo-linux-amd64-compatible-v1.19.29.gz
echo "5612e698e96c8b8ad15abc4c0a4f098eba9234354b4f248cb97f2528e215b094  mihomo.gz" | sha256sum -c -
gzip -d mihomo.gz
chmod +x mihomo
curl -fSL --retry 2 --max-time 120 -o geoip.dat https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip-lite.dat
curl -fSL --retry 2 --max-time 120 -o geosite.dat https://cdn.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geosite.dat
echo "MIHOMO_BIN=$RUNNER_TEMP/mihomo-check/mihomo" >> "$GITHUB_ENV"
echo "MIHOMO_GEODATA_DIR=$RUNNER_TEMP/mihomo-check" >> "$GITHUB_ENV"
