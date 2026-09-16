# Mihomo 配置审计 — 2026-09-16

本文前半部分保留初次审计时的发现与复现证据；用户随后授权修复，完成情况见文末“修复记录”。初次审计对象包含工作区尚未提交的 AI / x15 调整。

## 范围和证据

- 四份 `config/baiye-{multiple,single}{,-lite}.yaml`。
- Gist 生成的 `baiye-mini.yaml` / `baiye-mini-lite.yaml` 转换逻辑。
- 所引用的本地规则、Geo 数据、节点筛选、策略组、DNS、嗅探、TUN、规则先后顺序。
- `.github/scripts/build-and-publish.js` 和三个更新/发布 workflow；运行结果以本地验证为限，没有检查线上 Actions 历史或现有 Gist 内容。
- 内核：本机 Clash Verge 自带 Mihomo Meta v1.19.29（darwin arm64）。
- 从配置中的 URL 下载 Geo 数据，规则集使用仓库当前文件。四份原始 YAML 均通过 `mihomo -t`；四份配置及两个 mini 变体的隔离副本均通过内核校验和规则集加载。
- 运行验证将机场节点替换为保留原名称的本机测试代理，将规则集 HTTP 来源替换为本地文件，关闭定时探测、TUN、DNS 接管并使用临时本机端口。分流探测把显式 DIRECT 目标改为 REJECT，防止测试连接外网；原有规则条件与顺序不变。空组直连验证仅连接本机临时监听器。
- Ruby 的 YAML 1.1 解析会把裸 `off` 转为布尔值；隔离副本中恢复 `find-process-mode: off` 的字符串语义，并另行使用原始 YAML 完成内核检查，未将测试工具的转换差异误报为配置错误。
- 没有测试真实机场连接、AI 解锁、DNS 服务商可达性、吞吐或终端推送效果；下文只将已复现的路由行为作为事实。

## 需要修复的发现

### F1 — P1：空候选组隐式直连，外层 select 不会自动切换候选

位置：`config/baiye-multiple.yaml:155`、`:161`、`:165`；其他三份配置的 AI/地区组也有同类边界，标准版 mini 继承低倍率组行为。

- 仅加载极速订阅时没有 0.x 低倍率节点。控制器返回 `♻️ 低倍率自动: all=[COMPATIBLE], now=COMPATIBLE`，但 `📦 CDN 低倍率` 仍默认选中该组，不会自动切到列表第二项“🚀 节点选择”。
- 只保留普通香港节点时，`🧠 AI 专用节点` 同样成为 `COMPATIBLE`，外层“🤖 AI 平台”仍选它。
- 两种场景均用本机监听器复现 `HTTP/1.1 200 Connection established`，目标收到直连；不是仅依据策略名称推测。
- 极速单独使用时，韩国自动组因唯一韩国节点带 x15 而为空，也存在同一行为。

影响：以为仍经代理的 AI/CDN/地区流量可能改为本机出口，或因目标无法直连而失败。正常 NOW＋极速样本同时载入时这些组并不为空；“节点离线但仍在列表中”不等于本发现的空组条件。

建议：显式定义空组策略；AI 无合格节点时应避免隐式直连，低倍率无节点时应明确回退到普通代理。不能把 select 中的第二个选项当成自动 fallback。[Mihomo 空组说明](https://wiki.metacubex.one/config/proxy-groups/#empty-fallback)

### F2 — P2：Lite 的国内游戏直连规则被更早的游戏规则遮挡

位置：`config/baiye-multiple-lite.yaml:232` 与 `:245`；`baiye-single-lite.yaml` 和 mini-lite 同样受影响。

实测：`dl.steam.clngaa.com`、`steamchina.com`、`wmsjsteam.com` 在标准版命中 `GeoSite(category-games@cn)` → 全球直连；Lite 先命中 `RuleSet/game_non_ip` → 游戏平台，默认智能代理。后面的国内游戏直连规则无机会生效。

影响：国内游戏下载/服务走机场，可能增加延迟并消耗配额。建议把明确的国内游戏例外放在通用游戏规则之前，同时保留海外游戏平台走代理。

### F3 — P2：Lite 未把 Apple Intelligence 流量交给 AI 策略组

位置：`config/baiye-multiple-lite.yaml:226`、`:237`；缺少标准版的 `apple_intelligence` provider / rule。single-lite 和 mini-lite 同样受影响。

实测：

| 域名 | 标准版 | Lite |
|---|---|---|
| apple-relay.apple.com | AI 平台 | 苹果服务 |
| gspe1-ssl.ls.apple.com | AI 平台 | 苹果服务 |
| cp4.cloudflare.com | AI 平台 | 节点选择 |
| apple-relay.cloudflare.com | AI 平台 | 节点选择 |
| apple-relay.fastly-edge.com | AI 平台 | 节点选择 |

影响：即使已选择可用于 AI 的节点，这些请求仍可能走另一个出口。实际服务可用性还受账号和设备条件影响，本次没有做解锁测试。建议恢复对应的精准规则，而非把全部 Apple 流量放入 AI 组。

### F4 — P2：Lite 丢失了标准版的苹果推送直连例外

位置：`config/baiye-multiple-lite.yaml:204` 附近基础直连段及 `:237` 的 Apple 大类规则。

实测 `push.apple.com`：标准版命中显式 `DOMAIN-SUFFIX,push.apple.com,DIRECT`；Lite 命中 `GeoSite/apple` → 苹果服务，默认智能代理。Fake-IP 排除列表中的 `+.push.apple.com` 只改变 DNS 应答，不会替代分流直连规则。

影响：Lite 的推送连接依赖所选代理节点；这与标准版的推送保活设计不一致。这里只确认路由变化，未声称已经发生通知丢失。建议在 Apple 大类前恢复精准直连例外。

### F5 — P2：Gist 生成器会压缩缺失订阅的位置，并留下可发布的占位符

位置：`.github/scripts/build-and-publish.js:74`、`:201`、`:269`。

复现输入：`SUB_URL_1` 为空，`SUB_URL_2=https://example.invalid/two`，名字仍是天照/月读。

输出：第二个链接被填进 Sub-1 并冠以“天照”；Sub-2 仍保留 `替换订阅链接2` / `[显示名称2]`。两者都空时，模板仍会进入输出集合。代码在发布前没有检查订阅缺项或剩余占位符。

影响：Secrets 漏填或切换机场时，可能发布错位/不可用的配置并覆盖原有可用版本。没有实际调用 GitHub 发布 API；结论来自生成结果和发布控制流。

建议：保留订阅槽位对应关系，按输出类型校验所需订阅；缺项或有未替换占位符时中止发布。

### F6 — P2：当前 DRY_RUN 并不验证 YAML 或 Mihomo 配置

位置：`.github/scripts/build-and-publish.js:296`；`.github/workflows/publish-gist.yml` 的 PR Dry Run。

实测：将临时模板设为明显非法的 `proxy-groups: [this is invalid YAML`，使用虚构 token、无订阅链接、`DRY_RUN=true` 执行脚本，仍输出“处理完成”且退出码 0。无网络写入。

影响：PR 的生成步骤变绿并不意味着 YAML 可解析、组引用有效或规则可加载；正式发布也使用同一条未验证的生成路径。

建议：发布前至少校验 YAML、必填替换项和 Mihomo 加载；普通检查不应依赖真实发布 token。现有 Ruby 节点筛选脚本覆盖的是名字筛选，不能替代这些检查。

### F7 — P2：不带边界的 LAN 排除误伤合法英文节点名

位置：四份配置的 `tmpl`、`sel`，例如 `config/baiye-multiple.yaml:125` / `:126`，以及标准版低倍率组的排除项。

实测内核加载以下名字：`🇺🇸 Ashland AI`、`🇳🇱 Netherlands 01` 被排除，手动选择也找不到；`🇹🇼 Taiwan AI`、`🇯🇵 Japan 01`、`🇭🇰 香港 AI` 正常保留。原因是 `(?i)...|LAN` 匹配任意单词内部的 lan。

影响：节点采用英文城市/国家命名后会无提示消失。当前用户提供的两家中文命名样本未触发此问题。

建议：将 LAN 限定为独立标签，并检查同类宽泛关键词；不要以扩大地区正则掩盖公共排除项的误伤。

## 次要问题与维护项

- **P3，域名抽取只适配部分 YAML 写法。** `.github/scripts/build-and-publish.js:130` 对行内 `{name: test, server: node.example.com}` 提取成功，对常见的缩进 `server: node.example.com` 返回空列表。当前附件为行内格式，未受影响。改用结构化 YAML 读取，或至少兼容缩进并加入回归样本；遗漏只表示承诺的 Fake-IP 补充未生成，不等同于代理必然失效，因为主配置已有专用节点 DNS。
- **P3，自动父域名扩大可能过宽。** 同脚本 `:103`：`node.workers.dev` 会扩大为 `+.workers.dev`，使整个共享域名空间绕过 Fake-IP。宜使用准确服务器域名或显式维护的范围，不依靠有限的两级后缀清单推断所有域名。
- **P3，single-lite 没有天照前缀。** `config/baiye-single-lite.yaml:13` 的 Node provider 没有 `override.additional-prefix`，因此发布器设置 `SUB_NAMES` 对它无效；另三份模板均有。若希望四份显示一致应补齐，不涉及更改天照/月读的名称。
- README 的“Lite 规则效果保持一致”不符合 F2–F4 的实测，需在修复后重新核对或明确差异。
- 发布相关辅助项：CDN purge 仅比较 `HEAD~1..HEAD`，一次推送多提交会遗漏更早提交的改动；curl 失败分支只有 echo，可能让 purge 流程仍成功。此两项由控制流确认，未触发真实 CDN 请求，未将它们列为当前配置加载失败。

## 已通过或不应误报的部分

- 四份原始 YAML 均能被本机内核解析；下载到的 Geo 数据包含当前配置使用的分类，标准版 29 个、Lite 16 个规则 provider 均正常加载且非空。
- 默认端口、控制器和 DNS 监听本机；TUN 默认关闭。没有发现应立即调整的 DNS 字段冲突或策略组循环引用。
- NOW 样本 20 个 AI 候选，极速样本 20 个，多订阅合计 40 个；符合 AI 标签＋美国/日本/新加坡/台湾且排除韩国的约定。
- 自动组排除 x15，手动 AI 候选保留符合地区条件的 x15；标准版 NOW 的四个 0.5X 节点进入低倍率组。当前双订阅正常载入时自动总池为 73 个。
- ChatGPT、OpenAI API、Claude、Gemini Web 和 Gemini API 的抽样请求，六种配置均命中 AI 平台。
- 标准版 Apple Intelligence、苹果推送例外、国内 Steam 域名例外按当前设计命中。
- mini 转换只改变 geodata-loader 和 sniffer 开关；它继承对应多订阅版本的规则，不会修复原配置的上述逻辑问题。
- 天照/月读的 workflow 配置保持原样。
- `nameserver-policy` 缺失不能单独认定为缺陷；Fake-IP＋域名代理路径不一定需要本地真实 IP 查询。未以“DNS 条目更多”推断性能更好。
- `api.github.com` 进入 AI 平台来自当前上游 AI 规则本身；它会同时影响一般 GitHub API 请求，但不是规则引用错误。是否要覆盖属于策略选择，未擅自改动。

## 验证边界和复现记录

原始配置检查、隔离运行结果、控制器快照位于本次临时目录：

`/var/folders/4r/1k9w5r9x3x3g8knzgls2k90r0000gn/T/mihomo-config-audit-cn0e9z14`

该目录可能被系统清理，本文已保存关键复现输入和结果；里面的节点均为本机测试代理，没有机场凭据。

Geo 文件 SHA-256：

- geoip.dat：`8f88d85f483a19a14a85c36708aa530e6dc1b270f6b7c0d0ec3a9ab0ee0b9cf7`
- geosite.dat：`e6563deec254fd4323ace7137ac4e881a77cff19e8be0b166961d8c8c59e35be`

本次没有向运行中的客户端应用配置、没有使用真实机场节点发出探测、没有提交或发布。修复顺序建议为 F1 → F2–F4 → F5–F7，随后补齐次要维护项。


## 修复记录（2026-09-16，同日后续）

用户授权后，F1–F7 已在工作区修复，尚未提交或发布：

- F1：所有动态 AI / 地区 / 手动 / 测速池设置 `empty-fallback: REJECT`。标准版保留“♻️ 低倍率自动”入口，改为 fallback，依次使用新增低倍率测速池和普通智能池；健康检查确认低倍率不可用后切换，避免将 select 的第二项误当自动回退。
- F2–F4：Lite 在通用游戏规则前处理国内游戏；加入 Apple Intelligence 精准规则和苹果推送直连。mini-lite 继承修复。Apple Intelligence 规则只决定网络出口，不改变设备或账号的功能限制。
- F5–F6：使用锁定版本的 YAML 解析库维护订阅槽位、正确处理标量转义和检查引用。缺订阅/残留占位符/非法 YAML 会中止；发布前使用固定 Mihomo v1.19.29 校验六个输出。PR 使用虚构链接且不依赖发布 token。
- F7：LAN 改为独立标签匹配。地区正则只负责地域，倍率排除集中在公共自动组，避免重复维护。
- 次要项：兼容行内和缩进订阅 YAML，仅提取准确服务器域名；single-lite 补上原有天照前缀；修订 Lite 差异说明；CDN 刷新比较完整 push 范围且失败退出。
- 原 Ruby 名字检查已被 Node 生成器与真实内核测试替代，统一通过 `npm test` 运行；只新增一个运行依赖 `yaml` 并锁定版本。没有改变天照/月读名称。

验证：14 项生成器/配置/内核测试全量通过，另新增的“低倍率池存在但连接失败”测试单独通过，共 15 项；覆盖六种生成配置、无 token 的完整 Dry Run、缺项阻断、空 AI 组、LAN 误伤、正常低倍率优先、空低倍率回退及故障低倍率回退。三个 workflow 均通过 YAML 和内嵌 shell 语法检查，`git diff --check` 通过。

验证使用本机 Mihomo v1.19.29 和前述 Geo 数据；线上 GitHub Actions/Linux 运行及真实订阅连接没有执行。没有修改订阅 Secrets，没有向 Gist 或客户端发布配置。

## 终审记录（2026-09-16）

独立复查最终差异后补齐两项发布前检查：

- 规则 provider 的 URL 和下载代理引用此前会被隔离运行替换，可能绕过验证。已复现错误 URL 被接受，并补上原始配置检查和回归用例。
- 非 Dry Run 缺少对应 Gist ID 时，此前可能跳过该类输出却报告成功。现在对标准版和 Lite 分别检查目标 ID，在网络访问前中止，并覆盖两种缺失场景。

运行测试改为保留正式配置的健康检查间隔和 lazy 设置，仅将测速地址替换成本机服务；空低倍率池及故障低倍率池的启动回退均通过，排除了原先 1 秒强制测速掩盖问题的可能。

最终全量测试 **17/17 通过，0 跳过**；六种输出通过内核解析，四份模板的实际分流及 mini-lite 空 AI 组通过隔离运行验证。三份 workflow 的 YAML 和内嵌 Shell 语法、`git diff --check` 均通过。在上述本地验证范围内未发现剩余阻断问题；真实机场连接、线上 GitHub Actions 和 Gist 发布仍未执行。

## 全部规则与发布链路续审（2026-09-16）

上一轮结论仅覆盖当时的验证范围。本轮进一步覆盖全部规则内容及同步、刷新、发布链路，发现并修复以下问题：

1. **已撤回缺陷定性：苹果中国规则覆盖与 Lite 分类差异。** 以下为当时的复现和操作记录；对照上游后已撤回本项配置修改，详见文末“上游语义复核”。 内核复现 `cn.apple.com` 在标准版命中 `apple_services`，在 Lite 命中 `GEOSITE,apple`，均进入“苹果服务”。标准版将 `apple_cn_non_ip` 提到通用苹果规则前，Lite 引入已有中国域名规则并优先直连。修复后四份模板均命中预期出口。`gs-loc-cn.apple.com` 原本已被更早的 CDN / GEO 规则直连，不属于本项缺陷，保留为对照测试。
2. **P1：自动同步未校验下载内容即可提交。** HTTP 200 空响应此前成功退出；非空错误页面也可能覆盖规则文件并被自动提交。空响应现明确失败并保留原文件；同步 workflow 在提交前运行完整生成、规则、内核和分流检查，拒绝非法内容。提交范围收窄为 `rules/`。同步和发布复用固定版本内核准备脚本。
3. **P2：PR 与正式发布互相取消、非主分支触发线上动作。** 原发布流程共用 `publish-gist` 并发组且自动取消；刷新流程接受任意分支并始终刷新 `@main`。现 PR 使用独立并发组，正式发布串行且不主动取消运行；刷新与正式发布限定 main。PR 继续执行 Dry Run。依据：[GitHub workflow 事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)、[并发语法](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)。
4. **P2：连续推送取消 CDN 刷新可能遗漏前次文件。** 每次刷新持有各自 push 的差异，后一次取消前一次后并不一定重新包含旧差异。移除刷新任务的自动取消组，允许幂等刷新并行；正式 Gist 发布仍串行。临时 Git 仓库测试确认一次推送的多个提交均被收集，模拟 curl 失败确认任务非零退出。

全量检查结果：

- 30 份规则文件，14,440 条非注释条目；此计数包含 Game.yaml 与其拆分结果，不能视为去重后的独立规则数。
- 3,721 条 classical 规则全部以顶层规则交给 Mihomo 解析，避免只看 provider 非空而漏掉被丢弃的个别行；未发现当前文件的语法或 CIDR 错误。
- 来源清单 26 个下载目标，加上两份本地 domainset、两份游戏拆分结果，与全部文件一一对应。Game.yaml 的 597 条规则准确拆分为 551 条域名规则和 46 条 IP 规则，无丢失。
- 六个 domainset 均扫描格式，已引用的 provider 通过隔离内核运行加载。speedtest 中上游标记域名重复一次，对策略无影响，保留上游内容。
- 新增拒绝 HTML、空内容、非法 IPv4 / IPv6 前缀、规则内意外出口字段、错误 YAML payload 的回归检查。未知上游规则类型会失败并要求复核，而非静默丢弃。

保留的策略差异与边界：

- `oaistatic.com`、Telegram CDN、部分微软及游戏平台静态资源同时出现在服务规则与 CDN 规则中；标准版先走 CDN 低倍率是现有顺序的结果，不能仅凭重叠判为错误。本轮未改动此选择。
- `api.github.com` 在上游 AI 规则内，会影响一般 GitHub API 流量；此前已记录，本轮未擅自覆盖。
- 当前上游含 58 条 PROCESS-NAME 规则，而模板设置 `find-process-mode: off`。这些条目可解析不代表能按进程命中；已在 README 明确，未改变用户现有性能设置。
- 本轮没有重新抓取远端规则或访问真实机场，结论针对工作区快照。逐条语法检查不等于验证每个域名的业务归属、可达性或 AI 解锁能力。

最终 **22/22 测试通过，0 跳过**，包括新增苹果中国实测和同步/刷新故障模拟；三份 workflow YAML、内嵌 Shell、新共享脚本语法及 `git diff --check` 通过。线上 Actions/Linux、CDN 实际刷新和 Gist 发布仍未执行，所有改动仍在本地。

## 上游语义复核（2026-09-16，以本节更正前述策略判断）

用户指出主要来源为 SukkaW/Surge 后，重新读取了上游 README、Apple / AI / Direct 源文件与已生成的 Clash 苹果规则。此前先按本地匹配结果给苹果中国规则定性为 P2，缺少上游设计依据，属于审计过度。

- **撤回苹果中国优先直连改动。** [上游 README](https://github.com/SukkaW/Surge/blob/master/README.md#apple-service) 的顺序确实为 Apple CDN → Apple Service → Apple CN。[Apple Service 源码](https://github.com/SukkaW/Surge/blob/master/Source/non_ip/apple_services.conf) 包含 `apple.com` 后缀，[Apple CN 源码](https://github.com/SukkaW/Surge/blob/master/Source/non_ip/apple_cn.conf) 包含 `cn.apple.com`，覆盖现象成立，但不能据此证明应修改用户策略，README 也没有解释所有重叠的意图。标准版恢复原顺序，Lite 撤去上轮新增的 Apple CN provider / 直连规则。原有 GEO 和苹果推送例外保留。回归测试改为验证原策略：`cn.apple.com` 走苹果服务，`gs-loc-cn.apple.com` 仍直连。
- **确认 CDN 分流符合上游用途。** [CDN 说明](https://github.com/SukkaW/Surge/blob/master/README.md#常见静态-cdn) 明确提到分配低倍率节点。与 AI、微软、游戏平台静态资源重叠不是自动成立的误分流，本轮不移动整组规则。
- **确认 GitHub API 属于有意纳入。** [AI 源码的 Copilot 注释](https://github.com/SukkaW/Surge/blob/master/Source/non_ip/ai.conf) 说明 `api.github.com` 的地区/IP 信息用途，不能仅凭其同时服务普通 GitHub 请求就删除。
- **纠正“non_ip 等于只有域名”的潜在理解。** 上游按是否触发 DNS 解析区分；[Apple Service](https://github.com/SukkaW/Surge/blob/master/Source/non_ip/apple_services.conf) 中 `17.0.0.0/8,no-resolve` 有明确注释，PROCESS-NAME 也合法。本仓库没有据此删除这些规则。新增类型检查是当前同步流程的保守兼容门槛，不代表未知类型在 Mihomo 或上游必然非法。
- **Apple Intelligence 按用户明确要求保留，但不是完全隔离的 AI 流量。** [上游 AI 源码](https://github.com/SukkaW/Surge/blob/master/Source/non_ip/ai.conf) 特别说明定位相关域名还影响地图、指南针、天气，因此单列规则。先前“精准规则”的表述应理解为独立规则集，不能承诺不影响其他苹果服务。
- **进程匹配关闭是本地选项，非上游缺陷。** [Mihomo 文档](https://wiki.metacubex.one/config/general/#进程匹配模式) 明确说明 off 不匹配进程；保留现值，仅记录适用边界。

空组隐式直连、低倍率回退、订阅槽位错位、LAN 名称误伤、生成及发布校验等问题，均有本地脚本或内核复现，不依赖对 Sukka 规则分类的判断，相关修复保留。国内游戏例外来自本地 GEO 与 blackmatrix7 游戏集的组合，也没有改动 Sukka 内容。

本次未改写任何上游规则文件，没有从 Surge Source 直接复制不兼容的语法到 Clash；原同步来源仍是上游编译后的 `/Clash/` 文件。源码 master 与发布规则可能有更新时差，不能把二者差异直接定性为本地漏规则。

恢复策略后的全量结果为 **22/22 通过，0 跳过**。复测曾暴露测试固定等待 100ms 后关闭连接、偶发来不及记录首条分流日志的问题，已改为等待实际分流结果（有超时），没有为此修改生产配置。`git diff --check` 通过；仍未提交或发布。

## 提交前最终验证（2026-09-16）

已将改动带到最新 `origin/main`（`fc31824`），保留期间新增的全部上游规则。新快照为 30 份文件、14,565 条条目（含源文件与拆分结果）、3,722 条 classical 规则。全量 22 项测试通过且无跳过；六种配置、原有苹果分流顺序、回退及发布故障阻断均通过验证，workflow / Shell 语法和差异检查通过。没有改写上游规则内容。此记录为提交前证据，远端合入及 Actions 结果以随后实际运行状态为准。
