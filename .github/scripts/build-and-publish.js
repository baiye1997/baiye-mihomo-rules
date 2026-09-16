#!/usr/bin/env node
"use strict";

const fs = require("fs");
const https = require("https");
const http = require("http");
const path = require("path");
const YAML = require("yaml");
const { validateConfig, validateWithCore } = require("./validate-config.js");

/* ===================== ENV ===================== */
const {
  GIST_TOKEN,
  GIST_ID_STANDARD = "",
  GIST_ID_LITE = "",

  SUB_URLS = "",
  SUB_NAMES = "",
  SUB_SERVER_DOMAINS = "",

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

/* ===================== Subscriptions ===================== */
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
  if (!s || /^\d+\.\d+\.\d+\.\d+$/.test(s) || s.includes(":")) return "";
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
    return host && !require("net").isIP(host) && !host.includes(":") ? host : null;
  }).filter(Boolean))];
}

function httpsText(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const req = (new URL(url).protocol === "http:" ? http : https).get(url, {
      headers: { "User-Agent": "github-actions" },
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
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = "";
      res.setEncoding("utf8");
      res.on("data", d => data += d);
      res.on("end", () => resolve(data));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

async function collectSubscriptions() {
  const filters = new Set(manualServerDomains);
  const snapshots = await Promise.all(subUrls.map(async (url, i) => {
    if (!url) return null;
    try {
      const text = await httpsText(url);
      const data = YAML.parse(text, { merge: true, maxAliasCount: 10000 });
      if (!Array.isArray(data?.proxies) || !data.proxies.length) throw new Error("empty snapshot");
      extractServerDomainFilters(text).forEach(d => filters.add(d));
      return data.proxies;
    } catch (e) {
      // Never publish a configuration that needs unavailable nodes to fetch its own nodes.
      throw new Error(`订阅 ${i + 1} 节点快照获取失败，停止发布`);
    }
  }));
  return { filters: [...filters].sort((a, b) => a.localeCompare(b)), snapshots };
}

function applySubscriptions(template, serverDomainFilters = [], urls = subUrls, names = subNames, snapshots) {
  const doc = YAML.parseDocument(bumpIconsV(template), { merge: true });
  if (doc.errors.length) throw new Error("配置模板不是有效 YAML");
  const config = doc.toJS({ maxAliasCount: 10000 });
  for (const [key, provider] of Object.entries(config["proxy-providers"] || {})) {
    const slot = /^替换订阅链接([0-9]+)$/.exec(provider.url || "");
    if (!slot) continue;
    const index = Number(slot[1]) - 1;
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
      doc.setIn(["proxy-providers", key, "payload"], snapshots[index]);
      doc.setIn(["proxy-providers", key, "proxy"], "🚀 节点选择");
    }
  }
  if (serverDomainFilters.length) {
    const existing = config.dns?.["fake-ip-filter"] || [];
    doc.setIn(["dns", "fake-ip-filter"], [...new Set([...existing, ...serverDomainFilters])]);
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
    // Fail before network access if required slots/templates are invalid.
    for (const file of [CONFIG_MULTIPLE_STD, CONFIG_SINGLE_STD, CONFIG_MULTIPLE_LITE, CONFIG_SINGLE_LITE]) {
      if (file) applySubscriptions(readIfExists(file));
    }
    const { filters: serverDomainFilters, snapshots } = DRY_RUN === "true"
      ? { filters: manualServerDomains, snapshots: subUrls.map(() => [{ name: "美国 AI 启动校验", type: "socks5", server: "127.0.0.1", port: 9 }]) }
      : await collectSubscriptions();
    const generate = template => applySubscriptions(template, serverDomainFilters, subUrls, subNames, snapshots);
    if (serverDomainFilters.length) {
      log(`已为 Gist 配置注入 ${serverDomainFilters.length} 个代理服务器 fake-ip-filter 域名`);
    }

    // --- 读取逻辑保持不变 ---
    const multiStd = readIfExists(CONFIG_MULTIPLE_STD);
    if (multiStd) {
      const s = generate(multiStd);
      outputs.standard[GIST_FILE_MULTIPLE_STD] = { content: s };
      outputs.standard[GIST_FILE_MINI_STD] = { content: deriveMini(s) };
    }

    const singleStd = readIfExists(CONFIG_SINGLE_STD);
    if (singleStd) {
      outputs.standard[GIST_FILE_SINGLE_STD] = { content: generate(singleStd) };
    }

    const multiLite = readIfExists(CONFIG_MULTIPLE_LITE);
    if (multiLite) {
      const s = generate(multiLite);
      outputs.lite[GIST_FILE_MULTIPLE_LITE] = { content: s };
      outputs.lite[GIST_FILE_MINI_LITE] = { content: deriveMini(s) };
    }

    const singleLite = readIfExists(CONFIG_SINGLE_LITE);
    if (singleLite) {
      outputs.lite[GIST_FILE_SINGLE_LITE] = { content: generate(singleLite) };
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

    // === 优化：并发更新 Gist ===
    const tasks = [];

    // 任务 1: Standard Gist
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

    // 任务 2: Lite Gist
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

    // 等待所有任务完成
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

module.exports = { applySubscriptions, extractServerDomainFilters, deriveMini };
if (require.main === module) main();
