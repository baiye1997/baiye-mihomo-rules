#!/usr/bin/env node
"use strict";

const fs = require("fs");
const https = require("https");
const http = require("http");
const net = require("net");
const path = require("path");
const YAML = require("yaml");
const { validateConfig, validateWithCore } = require("./validate-config.js");

const AI_STATIC_NODE_NAME = "🇺🇸 专属静态住宅 AI";
const AI_RELAY_GROUP_NAME = "🔗 AI 接力中转";
const AI_AUTO_GROUP_NAME = "🛡️ AI 自动优选";
const AI_PLATFORM_GROUP_NAME = "🤖 AI 平台";

/* ===================== ENV ===================== */
const {
  GIST_TOKEN,
  GIST_ID_STANDARD = "",
  GIST_ID_LITE = "",

  SUB_URLS = "",
  SUB_NAMES = "",
  SUB_SERVER_DOMAINS = "",
  AI_STATIC_PROXY = "",

  CONFIG_MULTIPLE_STD,
  CONFIG_SINGLE_STD,
  CONFIG_MULTIPLE_LITE,
  CONFIG_SINGLE_LITE,

  GIST_FILE_MULTIPLE_STD,
  GIST_FILE_SINGLE_STD,
  GIST_FILE_MINI_STD,

  GIST_FILE_MULTIPLE_LITE,
  GIST_FILE_SINGLE_LITE,
  GIST_FILE_MINI_LITE,

  DRY_RUN = "false",
  QUIET = "true",
  STATUS_FILE = "",
} = process.env;

const COMMIT_SHORT = String(process.env.COMMIT_SHORT || "dev").slice(0, 7);
const statusFile = STATUS_FILE ? path.resolve(STATUS_FILE) : "";
const isQuiet = QUIET === "true";

/* ===================== Utils ===================== */
function log(...a) { if (!isQuiet) console.log(...a); }
function writeStatus(s) {
  if (!statusFile) return;
  try { fs.writeFileSync(statusFile, s + "\n", "utf8"); } catch {}
}

function readIfExists(p) {
  if (!p) return null;
  const abs = path.resolve(p);
  return fs.readFileSync(abs, "utf8");
}

function bumpIconsV(s) {
  return s.replace(
    /(https?:\/\/[^\s"'<>]+\/icons\/[^\s"'<>]+\.(png|jpe?g|webp|svg)(\?[^\s"'<>]*)?)/gi,
    (m) => {
      try {
        const u = new URL(m);
        u.searchParams.set("v", COMMIT_SHORT);
        return u.toString();
      } catch {
        return m;
      }
    }
  );
}

function maskUrl(raw = "") {
  if (!raw) return raw;
  return raw.replace(/([?&]token=)[^&]+/gi, "$1***");
}

/* ===================== Subscriptions & Static AI Proxy ===================== */
const subUrls = SUB_URLS
  .split(/\r?\n/)
  .map(normalizeSubscriptionUrl);
const subNames = SUB_NAMES.split(/\r?\n/).map(s => s.trim());
const manualServerDomains = SUB_SERVER_DOMAINS
  .split(/[\r\n,]+/)
  .map(s => normalizeDomainFilter(s))
  .filter(Boolean);

function normalizeDomainFilter(raw = "") {
  let s = String(raw).trim();
  if (!s) return "";
  s = s.replace(/^server\s*:\s*/i, "").trim();
  s = s.replace(/^['"]|['"]$/g, "").trim();
  if (!s || net.isIP(s) || s.includes(":")) return "";
  s = s.replace(/^\+\./, "").replace(/^\*\./, "");
  return `+.${s}`;
}

function normalizeSubscriptionUrl(raw = "") {
  return String(raw)
    .trim()
    .replace(
      /^http:\/\/gist\.githubusercontent\.com\//i,
      "https://gist.githubusercontent.com/"
    );
}

function extractServerDomainFilters(text = "") {
  const data = YAML.parse(text, { merge: true, maxAliasCount: 10000 });
  if (!Array.isArray(data?.proxies)) return [];
  // Exact server hosts avoid exempting unrelated tenants of shared domains.
  return [...new Set(data.proxies.map(p => {
    const host = String(p?.server || "").trim().replace(/\.$/, "").toLowerCase();
    return host && !net.isIP(host) && !host.includes(":") ? host : null;
  }).filter(Boolean))];
}

function sanitizeProxyNameservers(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map(item => String(item || "").trim())
    .filter(item => item && !item.includes("#"));
}

function parseStaticProxy(raw = "") {
  const text = String(raw || "").trim();
  if (!text) return null;
  let u;
  try {
    u = new URL(text);
  } catch {
    throw new Error("AI_STATIC_PROXY 格式无效，应为 socks5://user:pass@host:port 或 http://user:pass@host:port");
  }
  const protocolMap = { "socks5:": "socks5", "socks5h:": "socks5", "http:": "http", "https:": "http" };
  const type = protocolMap[u.protocol.toLowerCase()];
  const host = u.hostname.replace(/^\[|\]$/g, "").trim();
  const port = Number(u.port);
  if (!type || !host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("AI_STATIC_PROXY 协议、主机或端口无效");
  }
  const proxy = {
    name: AI_STATIC_NODE_NAME,
    type,
    server: host,
    port,
  };
  if (u.username) proxy.username = decodeURIComponent(u.username);
  if (u.password) proxy.password = decodeURIComponent(u.password);
  if (type === "socks5") proxy.udp = true;
  if (u.protocol.toLowerCase() === "https:") proxy.tls = true;
  proxy["dialer-proxy"] = AI_RELAY_GROUP_NAME;
  return proxy;
}

function detectRequiredSlots(templates) {
  const slots = new Set();
  for (const template of templates) {
    if (!template) continue;
    const config = YAML.parse(template, { merge: true, maxAliasCount: 10000 });
    for (const provider of Object.values(config?.["proxy-providers"] || {})) {
      const m = /^替换订阅链接([0-9]+)$/.exec(provider?.url || "");
      if (m) slots.add(Number(m[1]) - 1);
    }
  }
  return [...slots].sort((a, b) => a - b);
}

function httpsText(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const req = (new URL(url).protocol === "http:" ? http : https).get(url, {
      headers: { "User-Agent": "clash.meta" },
      timeout: 20000,
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        resolve(httpsText(next, redirects - 1));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(Object.assign(new Error('HTTP failure'), { code: `HTTP_${res.statusCode}` }));
        return;
      }
      let data = "";
      res.setEncoding("utf8");
      res.on("data", d => data += d);
      res.on("end", () => resolve(data));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on("error", reject);
  });
}

async function collectSubscriptions(requiredSlots = []) {
  const targetSlots = requiredSlots.length
    ? requiredSlots
    : subUrls.map((u, i) => (u ? i : -1)).filter(i => i >= 0);

  const snapshots = [];
  const filtersBySlot = [];
  const dnsBySlot = [];

  await Promise.all(targetSlots.map(async (i) => {
    const url = subUrls[i];
    if (!url) return;
    let stage = 'download';
    try {
      const text = await httpsText(url);
      stage = 'parse';
      const data = YAML.parse(text, { merge: true, maxAliasCount: 10000 });
      stage = 'validate';
      if (!Array.isArray(data?.proxies) || !data.proxies.length) throw new Error("empty snapshot");
      snapshots[i] = data.proxies;
      filtersBySlot[i] = extractServerDomainFilters(text);
      dnsBySlot[i] = sanitizeProxyNameservers(data?.dns?.["proxy-server-nameserver"]);
    } catch (e) {
      // Never publish a configuration that needs unavailable nodes to fetch its own nodes.
      // Only emit known codes, never error messages that may contain URLs or YAML credentials.
      const code = /^(HTTP_[1-5][0-9]{2}|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPROTO|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE|ERR_TLS_CERT_ALTNAME_INVALID)$/.test(e.code || '') ? e.code : 'UNKNOWN';
      throw new Error(`订阅 ${i + 1} 节点快照获取失败，停止发布 (stage=${stage}, code=${code})`);
    }
  }));

  return { filtersBySlot, snapshots, dnsBySlot };
}

function applySubscriptions(
  template,
  serverDomainFilters = [],
  urls = subUrls,
  names = subNames,
  snapshots,
  proxyServerNameserver,
  aiStaticProxyRaw = ""
) {
  const doc = YAML.parseDocument(bumpIconsV(template), { merge: true });
  if (doc.errors.length) throw new Error("配置模板不是有效 YAML");
  const config = doc.toJS({ maxAliasCount: 10000 });
  const usedSlots = [];

  for (const [key, provider] of Object.entries(config["proxy-providers"] || {})) {
    const slot = /^替换订阅链接([0-9]+)$/.exec(provider.url || "");
    if (!slot) continue;
    const index = Number(slot[1]) - 1;
    usedSlots.push(index);
    const url = urls[index];
    let parsed;
    try { parsed = new URL(url); } catch { /* checked below */ }
    if (!url || !["https:", "http:"].includes(parsed?.protocol)) {
      throw new Error(`订阅 ${index + 1} 缺失或 URL 无效`);
    }
    doc.setIn(["proxy-providers", key, "url"], url);
    doc.setIn(["proxy-providers", key, "override", "additional-prefix"], names[index] || `[Sub${index + 1}]`);
    if (snapshots) {
      if (!Array.isArray(snapshots[index]) || !snapshots[index].length) throw new Error(`订阅 ${index + 1} 缺少启动节点快照`);
      doc.setIn(["proxy-providers", key, "payload"], snapshots[index].map(proxy => {
        // Some VLESS subscriptions emit null for an absent flow; Mihomo requires omission or a string.
        if (proxy.type !== 'vless' || proxy.flow !== null) return proxy;
        const normalized = { ...proxy };
        delete normalized.flow;
        return normalized;
      }));
      doc.setIn(["proxy-providers", key, "proxy"], "📥 资源下载");
    }
  }

  // Merge fake-ip-filter domains (supports flat array or per-slot array)
  const resolvedFilters = [];
  if (Array.isArray(serverDomainFilters)) {
    if (serverDomainFilters.some(Array.isArray)) {
      for (const slotIdx of usedSlots) {
        if (Array.isArray(serverDomainFilters[slotIdx])) resolvedFilters.push(...serverDomainFilters[slotIdx]);
      }
    } else {
      resolvedFilters.push(...serverDomainFilters);
    }
  }

  // Optional static residential AI proxy injection via GitHub Secret
  const staticProxy = parseStaticProxy(aiStaticProxyRaw);
  if (staticProxy) {
    const existingProxies = Array.isArray(config.proxies) ? config.proxies : [];
    doc.setIn(["proxies"], [...existingProxies.filter(p => p?.name !== AI_STATIC_NODE_NAME), staticProxy]);

    const groups = config["proxy-groups"] || [];
    const autoIdx = groups.findIndex(g => g.name === AI_AUTO_GROUP_NAME);
    if (autoIdx >= 0) {
      const current = (groups[autoIdx].proxies || []).filter(n => n !== AI_STATIC_NODE_NAME);
      doc.setIn(["proxy-groups", autoIdx, "proxies"], [AI_STATIC_NODE_NAME, ...current]);
    }
    const aiIdx = groups.findIndex(g => g.name === AI_PLATFORM_GROUP_NAME);
    if (aiIdx >= 0) {
      const current = (groups[aiIdx].proxies || []).filter(n => n !== AI_STATIC_NODE_NAME);
      const insertAt = current.includes(AI_AUTO_GROUP_NAME) ? current.indexOf(AI_AUTO_GROUP_NAME) + 1 : 0;
      current.splice(insertAt, 0, AI_STATIC_NODE_NAME);
      doc.setIn(["proxy-groups", aiIdx, "proxies"], current);
    }
    if (!groups.some(g => g.name === AI_RELAY_GROUP_NAME)) {
      const relayGroup = {
        name: AI_RELAY_GROUP_NAME,
        type: "fallback",
        url: "https://www.gstatic.com/generate_204",
        interval: 300,
        lazy: true,
        timeout: 5000,
        "max-failed-times": 3,
        "expected-status": 204,
        hidden: true,
        proxies: ["🇯🇵 - 择优节点", "🇺🇸 - 择优节点", "🇭🇰 - 择优节点"],
      };
      const proxyGroupsNode = doc.getIn(["proxy-groups"]);
      proxyGroupsNode.add(doc.createNode(relayGroup));
    }
    if (!net.isIP(staticProxy.server) && !staticProxy.server.includes(":")) {
      resolvedFilters.push(staticProxy.server.toLowerCase());
    }
  }

  if (resolvedFilters.length) {
    const existing = config.dns?.["fake-ip-filter"] || [];
    const merged = [...new Set([...existing, ...resolvedFilters.sort((a, b) => a.localeCompare(b))])];
    doc.setIn(["dns", "fake-ip-filter"], merged);
  }

  // Merge subscription proxy-server-nameserver AFTER default public DNS (avoid single-point override & races)
  const extraProxyDns = [];
  if (Array.isArray(proxyServerNameserver)) {
    if (proxyServerNameserver.some(Array.isArray)) {
      for (const slotIdx of usedSlots) {
        extraProxyDns.push(...sanitizeProxyNameservers(proxyServerNameserver[slotIdx]));
      }
    } else {
      extraProxyDns.push(...sanitizeProxyNameservers(proxyServerNameserver));
    }
  }
  if (extraProxyDns.length) {
    const existingProxyDns = sanitizeProxyNameservers(config.dns?.["proxy-server-nameserver"]);
    doc.setIn(["dns", "proxy-server-nameserver"], [...new Set([...existingProxyDns, ...extraProxyDns])]);
  }

  const output = doc.toString();
  if (/替换订阅链接|\[显示名称|\[\*\*\*\]/.test(output)) throw new Error("生成配置仍有未替换占位符");
  validateConfig(output);
  return output;
}

function deriveMini(s) {
  return s
    .replace(/geodata-loader:\s*standard/gi, "geodata-loader: memconservative")
    .replace(/(sniffer:\s*\n\s*)enable:\s*true/i, "$1enable: false");
}

/* ===================== HTTP ===================== */
function httpJSON(method, url, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      headers: {
        Authorization: `token ${GIST_TOKEN}`,
        "User-Agent": "github-actions",
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }, res => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/* ===================== Main ===================== */
async function main() {
  try {
    if (DRY_RUN !== "true" && !GIST_TOKEN) throw new Error("Missing GIST_TOKEN");
    if (DRY_RUN !== "true") {
      if ((CONFIG_MULTIPLE_STD || CONFIG_SINGLE_STD) && !GIST_ID_STANDARD.trim()) throw new Error("Missing GIST_ID_STANDARD");
      if ((CONFIG_MULTIPLE_LITE || CONFIG_SINGLE_LITE) && !GIST_ID_LITE.trim()) throw new Error("Missing GIST_ID_LITE");
    }

    log("开始处理配置文件...");

    const outputs = { standard: {}, lite: {} };
    const templateTexts = {
      multiStd: readIfExists(CONFIG_MULTIPLE_STD),
      singleStd: readIfExists(CONFIG_SINGLE_STD),
      multiLite: readIfExists(CONFIG_MULTIPLE_LITE),
      singleLite: readIfExists(CONFIG_SINGLE_LITE),
    };

    // Fail before network access if required slots/templates or AI_STATIC_PROXY are invalid.
    for (const text of Object.values(templateTexts)) {
      if (text) applySubscriptions(text, [], subUrls, subNames, undefined, undefined, AI_STATIC_PROXY);
    }

    const requiredSlots = detectRequiredSlots(Object.values(templateTexts));
    const { filtersBySlot, snapshots, dnsBySlot } = DRY_RUN === "true"
      ? {
        filtersBySlot: requiredSlots.reduce((acc, idx) => { acc[idx] = [...manualServerDomains]; return acc; }, []),
        snapshots: requiredSlots.reduce((acc, idx) => { acc[idx] = [{ name: "美国 AI 启动校验", type: "socks5", server: "127.0.0.1", port: 9 }]; return acc; }, []),
        dnsBySlot: [],
      }
      : await collectSubscriptions(requiredSlots);

    if (manualServerDomains.length) {
      for (const idx of requiredSlots) {
        filtersBySlot[idx] = [...new Set([...(filtersBySlot[idx] || []), ...manualServerDomains])];
      }
    }

    const generate = template => applySubscriptions(
      template,
      filtersBySlot,
      subUrls,
      subNames,
      snapshots,
      dnsBySlot,
      AI_STATIC_PROXY
    );

    // --- Standard Gist ---
    let multiStdOut = null;
    if (templateTexts.multiStd) {
      multiStdOut = generate(templateTexts.multiStd);
      outputs.standard[GIST_FILE_MULTIPLE_STD] = { content: multiStdOut };
    }
    let singleStdOut = null;
    if (templateTexts.singleStd) {
      singleStdOut = generate(templateTexts.singleStd);
      outputs.standard[GIST_FILE_SINGLE_STD] = { content: singleStdOut };
    }
    if (GIST_FILE_MINI_STD && (multiStdOut || singleStdOut)) {
      outputs.standard[GIST_FILE_MINI_STD] = { content: deriveMini(multiStdOut || singleStdOut) };
    }

    // --- Lite Gist ---
    let multiLiteOut = null;
    if (templateTexts.multiLite) {
      multiLiteOut = generate(templateTexts.multiLite);
      outputs.lite[GIST_FILE_MULTIPLE_LITE] = { content: multiLiteOut };
    }
    let singleLiteOut = null;
    if (templateTexts.singleLite) {
      singleLiteOut = generate(templateTexts.singleLite);
      outputs.lite[GIST_FILE_SINGLE_LITE] = { content: singleLiteOut };
    }
    if (GIST_FILE_MINI_LITE && (multiLiteOut || singleLiteOut)) {
      outputs.lite[GIST_FILE_MINI_LITE] = { content: deriveMini(multiLiteOut || singleLiteOut) };
    }

    log(`处理完成，Standard Gist 文件数: ${Object.keys(outputs.standard).length}, Lite/GEO Gist 文件数: ${Object.keys(outputs.lite).length}`);

    const files = { ...outputs.standard, ...outputs.lite };
    if (!Object.keys(files).length) throw new Error("没有可验证的输出配置");
    if (Object.hasOwn(files, "undefined")) throw new Error("缺少输出文件名");
    for (const [name, { content }] of Object.entries(files)) {
      validateConfig(content);
      validateWithCore(content, name);
    }

    if (DRY_RUN === "true") {
      writeStatus("DRYRUN");
      log("=== DRY RUN 模式 ===");
      return;
    }

    // === 并发更新 Gist ===
    const tasks = [];

    if (GIST_ID_STANDARD && Object.keys(outputs.standard).length) {
      tasks.push((async () => {
        log(`正在更新标准版 Gist: ${GIST_ID_STANDARD}...`);
        const resp = await httpJSON("PATCH", `https://api.github.com/gists/${GIST_ID_STANDARD}`, {
          files: outputs.standard,
          description: `update via CI | ${COMMIT_SHORT}`,
        });
        log("✅ 标准版 Gist 更新成功");
        Object.keys(outputs.standard).forEach(f => log(`  ${f}: ${maskUrl(resp.files[f]?.raw_url)}`));
      })());
    }

    if (GIST_ID_LITE && Object.keys(outputs.lite).length) {
      tasks.push((async () => {
        log(`正在更新 Lite/GEO Gist: ${GIST_ID_LITE}...`);
        const resp = await httpJSON("PATCH", `https://api.github.com/gists/${GIST_ID_LITE}`, {
          files: outputs.lite,
          description: `update via CI | ${COMMIT_SHORT}`,
        });
        log("✅ Lite/GEO Gist 更新成功");
        Object.keys(outputs.lite).forEach(f => log(`  ${f}: ${maskUrl(resp.files[f]?.raw_url)}`));
      })());
    }

    if (tasks.length > 0) {
      await Promise.all(tasks);
    } else {
      log("没有需要更新的内容");
    }

    writeStatus("OK");
    log("🎉 所有 Gist 更新完成");
  } catch (e) {
    writeStatus("ERROR");
    console.error("❌ Gist 更新失败:", e.message);
    process.exit(1);
  }
}

module.exports = { applySubscriptions, extractServerDomainFilters, deriveMini, parseStaticProxy };
if (require.main === module) main();
