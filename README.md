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

> Gist 中生成的 `baiye-mini.yaml` / `baiye-mini-lite.yaml` 才是真正轻量输出：在对应多订阅配置基础上启用 `memconservative`，并关闭 `sniffer`。

> 说明：本仓库内的图标和规则每次更新会自动purge缓存，无需担心缓存问题。

---

## NOW / 极速 cloud 订阅

- 两家一起使用选 `baiye-multiple.yaml` 或 `baiye-multiple-lite.yaml`；订阅 1 对应 NOW，订阅 2 对应极速 cloud。
- 手动导入时填写订阅链接和显示名称；通过 Gist 发布时，更新 GitHub Secrets `SUB_URL_1` / `SUB_URL_2`，保留自定义显示前缀 `[天照]` / `[月读]`。单订阅输出使用订阅 1。
- `🧠 AI 专用节点` 保留原组名与手动选择方式，候选扩大为带独立 AI 标签、美国、新加坡、日本、台湾节点，排除韩国；按名称筛选不保证实际 AI 解锁。
- 极速 cloud 默认按 10X 扣量（1000G 额度可用约 100G 实际流量）；`x15` 相对其默认节点为 1.5 倍消耗，因消耗较高而排除自动择优 / 回退，手动仍可选，符合地区条件的节点也保留在手动 AI 候选中。不能直接与 NOW 的倍率数字比较。NOW 的 `0.5X` 节点继续进入标准版 CDN 低倍率组；Lite 版没有该组。
- AI / 地区 / 手动节点组为空时明确拒绝连接，避免隐式直连；标准版 CDN 自动组优先低倍率池，不可用时回退普通智能节点池。
- Apple Intelligence 在所有版本中进入 AI 组；这只配置网络分流，不改变设备、账号或地区的功能限制。

---

## 🧩 Lite 版说明（GEO 上游）

Lite 版主要使用 GEO 分类，保留 AI、Apple Intelligence、苹果推送直连及国内游戏直连。它不含标准版的 CDN 低倍率组，部分国内服务直接使用 DIRECT，而标准版提供“全球直连”策略选择，两版并非所有规则完全相同。

标准版保留 Sukka README 的 Apple CDN → Apple Service → Apple CN 顺序；Lite 使用自己的 GEO 分类，不能据此假定两版每个苹果域名出口相同。默认 `find-process-mode: off`，上游中的进程名规则不会参与匹配；当前配置主要依靠域名与 IP 分流。

当前已按要求加入 Apple Intelligence 独立规则；其中的定位相关域名也可能影响地图、天气等服务，不能将它理解为只包含 AI 请求。规则来源与顺序以 [Sukka 上游说明](https://github.com/SukkaW/Surge/blob/master/README.md) 为依据，本地例外单独维护。

---

## 本地验证与发布校验

先运行 `npm ci --ignore-scripts`，然后 `npm test`。未设置内核环境变量时，仅运行生成器检查，内核运行测试会明确跳过。

完整校验需要指定 Mihomo 可执行文件和 Geo 数据目录（包含 `geoip.dat`、`geosite.dat`）：

```sh
MIHOMO_BIN=/path/to/mihomo MIHOMO_GEODATA_DIR=/path/to/geodata npm test
```

GitHub 发布流程固定使用 Mihomo v1.19.29，验证四份配置及两个 mini 输出后才更新 Gist。PR 使用虚构订阅链接，不需要真实订阅或发布 token；正式发布遇到缺失订阅、无效 YAML、错误引用或内核校验失败会中止。

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
