# Baiye Mihomo Rules

集中维护和同步个人使用的 **Clash / Mihomo** 规则与配置。  
每日 **北京时间 06:00** 自动从上游同步，通过规则与内核检查后提交更新。

---

## ✈️ 支持内核 / 工具
- 🌸 Mihomo（Clash 内核）

---

## 📦 配置总览

| 文件 | 用途 | 特点 |
|---|---|---|
|  [baiye-multiple.yaml](./config/baiye-multiple.yaml)  | 多订阅合一 | 标准版（RULE-SET） |
|  [baiye-single.yaml](./config/baiye-single.yaml)  | 单一订阅 | 标准版（RULE-SET） |
|  [baiye-multiple-lite.yaml](./config/baiye-multiple-lite.yaml)  | 多订阅合一（Lite） | 主要使用 GEO 上游 |
|  [baiye-single-lite.yaml](./config/baiye-single-lite.yaml)  | 单一订阅（Lite） | 主要使用 GEO 上游 |
> 特色：完整好用的 [fake-ip-filter](./rules/domainset/fake-ip.list) 和 [sniff-skip](./rules/domainset/sniff-skip.list) ，解决一系列通信问题

> 建议：关闭客户端的一切覆写功能，本仓库配置文件已经非常好用！
---

## 🚀 使用方法

1. 直接下载（或复制） `config/` 下对应 YAML 导入 Mihomo 并在 YAML 中填入你持有的✈️订阅链接；  
2. 或在你的主配置里 **引用本仓库的规则文件**（示例）：

```yaml
rule-providers:
  game_non_ip:
    type: http
    behavior: classical
    format: text
    url: https://raw.githubusercontent.com/baiye1997/baiye-mihomo-rules/main/rules/non_ip/game.txt
    path: ./rules/non_ip/game.txt
    interval: 86400
```

> 默认不启用配置层广告拦截规则。广告过滤建议交给浏览器插件或 DNS 侧工具，避免误伤微信、小米互联、系统推送等 App 功能。

> 安全默认值：代理端口仅监听本机。需要给局域网设备共享代理时，请自行开启 `allow-lan`，并同时配置 `lan-allowed-ips` 或 `authentication`，不要在不可信网络中裸露代理端口。

Geo 数据采用分工配置：精简 `geoip-lite.dat` 负责实际使用的 `private/CN` IP 兜底，Loyalsoldier `geosite.dat` 保留完整域名分类；两者均由 Mihomo 自动更新。

**内存优化（可选，iOS 推荐）**
```yaml
geodata-loader: memconservative
```

> Gist 中生成的 `baiye-mini.yaml` / `baiye-mini-lite.yaml` 才是真正轻量输出：在对应单订阅配置基础上启用 `memconservative`，并关闭 `sniffer`。

> 说明：本仓库内的图标和规则每次更新会自动purge缓存，无需担心缓存问题。

---

## 订阅与 Gist 发布说明

- `publish-gist.yml` 默认以**单订阅模式**发布（输出 `baiye-single.yaml` / `baiye-mini.yaml` 及 Lite 对应版本），仅需在 GitHub Secrets 中维护 `SUB_URL_1`；单订阅不追加节点前缀，多订阅模板 `baiye-multiple*.yaml` 保留前缀防同名冲突。
- 可选在 GitHub Secrets 中设置 `AI_STATIC_PROXY`（格式如 `socks5://user:pass@ip:port`），发布脚本会自动将其注入为 `🇺🇸 专属静态住宅 AI`（经隐藏组 `🔗 AI 接力中转` 优先走日本节点接力，异常时自动回退美/港），并置于 `🛡️ AI 自动优选` 首位；未配置该 Secret 时，`🛡️ AI 自动优选` 自动按美/日/新择优节点回退。
- `🤖 AI 平台` 与 `🔍 谷歌服务`（通过 `GEOSITE,google` 承接 Google 登录/支付/Gmail/搜索等核心账号域名，不抢占 YouTube 视频与大文件下载）均默认走 `🛡️ AI 自动优选`（隐藏组，在卡片上直接显示当前实时命中的节点），同时保留 `🧠 AI 手动节点` 供随时手动切换；`🍎 苹果服务`、`Ⓜ️ 微软服务`（含 OneDrive）与 `🌐 全球直连` 均默认 `DIRECT` 优先，`🎵 Spotify` 合并至 `📺 视频媒体`。
- `x15` / `5x` 高倍率节点排除出自动择优与回退组，手动仍可选；手动选择组使用独立测速 URL（`?ui=1`）避免手点测速污染后台自动择优缓存；AI / 地区 / 手动节点组为空时明确拒绝连接，避免隐式直连。
- Gist 输出为每个 HTTP 节点 provider 附带启动节点快照（`payload`），并保留默认国内公共 DNS 与订阅自带 `proxy-server-nameserver` 合并，避免单一机场私有 DNS 故障导致断网。

---

## 🧩 Lite 版说明（GEO 上游）

Lite 版主要使用 GEO 分类，保留 AI、谷歌服务、苹果推送直连及国内游戏直连；规则文件更少，但两版在部分细分服务上的匹配粒度不同。

标准版保留 Sukka README 的 Apple CDN → Apple Service → Apple CN 顺序；Lite 使用自己的 GEO 分类，不能据此假定两版每个苹果域名出口相同。默认 `find-process-mode: off`，上游中的进程名规则不会参与匹配；当前配置主要依靠域名与 IP 分流。

规则来源与顺序以 [Sukka 上游说明](https://github.com/SukkaW/Surge/blob/master/README.md) 为依据，本地例外单独维护。

---

## 本地验证与发布校验

先运行 `npm ci --ignore-scripts`，然后 `npm test`。未设置内核环境变量时，仅运行生成器检查，内核运行测试会明确跳过。

完整校验需要指定 Mihomo 可执行文件和 Geo 数据目录（包含 `geoip.dat`、`geosite.dat`）：

```sh
MIHOMO_BIN=/path/to/mihomo MIHOMO_GEODATA_DIR=/path/to/geodata npm test
```

GitHub 发布流程固定使用 Mihomo v1.19.29，验证四份配置及两个 mini 输出后才更新 Gist。PR 使用虚构订阅链接，不需要真实订阅或发布 token；正式发布遇到缺失订阅、无效 YAML、错误引用或内核校验失败会中止。

生成后的 Gist 配置包含节点凭据，不应公开分享。冷启动测试保留 HTTP provider 下载路径，并验证两个订阅均返回 503 时仍能依靠 payload 下载规则。

---

## 🛠 更新与自动化

- 每日定时同步上游规则（北京时间 06:00）  
- 自动 purge `icons` & `rules` 缓存

---

## 🤝 帮助与支持
使用中遇到问题，欢迎提交 Issue。

---

## ⚠️ 免责声明
- 本项目仅供学习与技术交流，请遵守当地法律法规，不得用于非法用途。  
- 规则来源均来自上游开源项目，请遵循各自许可证。  
- 如有侵权或其他问题，请联系我移除。

---

## 🙌 鸣谢（Thanks）

本项目部分规则和思路来自以下优秀开源项目，在此致谢：

- [yyhhyyyyyy/selfproxy](https://github.com/yyhhyyyyyy/selfproxy)  
- [SukkaW/Surge](https://github.com/SukkaW/Surge)  
- [Loyalsoldier/clash-rules](https://github.com/Loyalsoldier/clash-rules)  
- [blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script)  
- [DustinWin/ruleset_geodata](https://github.com/DustinWin/ruleset_geodata)
