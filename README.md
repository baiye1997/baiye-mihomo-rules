# Baiye Mihomo Rules

集中维护和同步个人使用的 **Clash / Mihomo** 规则与配置。  
每日 **北京时间 06:00** 自动从上游同步，保证规则持续可用。

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
> 特色：完整好用的 [fake-ip-filter](./rules/domainset/fake_ip.list) 和 [sniff-skip](./rules/domainset/sniff-skip.list) ，解决一系列通信问题

> 建议：关闭客户端的一切覆写功能，本仓库配置文件已经非常好用！
---

## 🚀 使用方法

1. 直接下载（或复制） `config/` 下对应 YAML 导入 Mihomo 并在 YAML 中填入你持有的✈️订阅链接；  
2. 或在你的主配置里 **引用本仓库的规则文件**（示例）：

```yaml
rule-providers:
  adblock:
    type: http
    behavior: classical
    format: yaml
    url: https://raw.githubusercontent.com/baiye1997/baiye-mihomo-rules/main/rules/yaml/fuckAds.yaml
    path: ./rules/yaml/fuckAds.yaml
    interval: 86400
```

**内存优化（可选，iOS 推荐）**
```yaml
geodata-loader: memconservative
```

> 说明：本仓库内的图标和规则每次更新会自动purge缓存，无需担心缓存问题。

---

## 🧩 Lite 版说明（GEO 上游）

Lite 版将主要规则统一为 GEO 系列，规则效果保持一致，不影响使用。

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
- [TG-Twilight/AWAvenue-Ads-Rule](https://github.com/TG-Twilight/AWAvenue-Ads-Rule)  
- [DustinWin/ruleset_geodata](https://github.com/DustinWin/ruleset_geodata)
