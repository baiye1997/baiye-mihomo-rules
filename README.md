# Baiye Mihomo Rules

本仓库用于集中维护和同步个人使用的 **Clash / Mihomo 规则文件**。  
每天 **北京时间早上 6 点** 自动抓取上游最新规则文件并更新到仓库，保证规则持续可用。

---

## 🤝 项目介绍

我不生产规则，只是规则的搬运工。

---

## ✈️ 支持的代理内核/工具

- 🌸 Mihomo（Clash 内核）

---

## 😄 使用方法

1. 对于 Mihomo 用户 → 进入 `/config` 目录
2. `baiye-multiple.yaml` 为「多订阅合一」使用
3. `baiye-single.yaml` 为「单一订阅」使用
4. 也可直接在 Clash / Mihomo 配置文件中引用本仓库的规则文件，例如：

rule-providers:
  adblock:
    type: http
    behavior: classical
    format: yaml
    url: https://raw.githubusercontent.com/baiye1997/baiye-mihomo-rules/main/rules/yaml/fuckAds.yaml
    path: ./rules/yaml/fuckAds.yaml
    interval: 86400

---


## 🤝 帮助与支持

如果在使用过程中遇到任何问题，欢迎提交 Issue！

---

## ⚠️ 免责声明

- 本项目仅供学习和技术交流使用，请遵守当地法律法规，不得用于非法用途。  
- 本项目仅作个人学习与研究使用，不对使用效果负责。  
- 规则来源均来自上游开源项目，请遵循各自的开源许可证。  
- 如有侵权或问题，请联系我删除。

---

## 🙌 鸣谢

本项目部分规则和思路来自以下优秀开源项目，在此致谢：

- [yyhhyyyyyy/selfproxy](https://github.com/yyhhyyyyyy/selfproxy)  
- [SukkaW/Surge](https://github.com/SukkaW/Surge)  
- [Loyalsoldier/clash-rules](https://github.com/Loyalsoldier/clash-rules)
- [blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script)