#!/usr/bin/env node
"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");

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
const CACHE_BUST = String(process.env.GIST_CACHE_BUST || process.env.GITHUB_RUN_ID || COMMIT_SHORT);
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
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
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

function bumpProviderPaths(s) {
  return s.replace(
    /(path:\s*["']?\.\/proxy_provider\/providers-)(\d+)(\.yaml["']?)/g,
    `$1$2-${CACHE_BUST}$3`
  );
}

function maskUrl(raw = "") {
  if (!raw) return raw;
  return raw.replace(/([?&]token=)[^&]+/gi, "$1***");
}

/* ===================== Subscriptions ===================== */
const subUrls = SUB_URLS.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const subNames = SUB_NAMES.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
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

function parentDomainFilter(server = "") {
  const host = String(server)
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\.$/, "");
  if (!host || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) return "";

  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return "";

  const twoLabelSuffixes = new Set([
    "com.cn", "net.cn", "org.cn", "gov.cn",
    "com.hk", "net.hk", "org.hk",
    "com.tw", "net.tw", "org.tw",
    "co.uk", "org.uk", "ac.uk",
    "co.jp", "ne.jp", "or.jp",
    "com.au", "net.au", "org.au",
    "us.kg",
  ]);
  const tail2 = labels.slice(-2).join(".");
  const tail3 = labels.slice(-3).join(".");
  const parent = labels.length >= 3 && twoLabelSuffixes.has(tail2) ? tail3 : tail2;
  return normalizeDomainFilter(parent);
}

function extractServerDomainFilters(text = "") {
  const filters = new Set();
  const serverRe = /(?:^|[,{]\s*)server\s*:\s*['"]?([^'",}\s#]+)['"]?/gim;
  let match;
  while ((match = serverRe.exec(text))) {
    const filter = parentDomainFilter(match[1]);
    if (filter) filters.add(filter);
  }
  return [...filters];
}

function httpsText(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
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

async function collectServerDomainFilters() {
  const filters = new Set(manualServerDomains);

  await Promise.all(subUrls.map(async (url, i) => {
    try {
      const text = await httpsText(url);
      extractServerDomainFilters(text).forEach(d => filters.add(d));
    } catch (e) {
      log(`WARN: 订阅 ${i + 1} server 域名提取失败，跳过自动 fake-ip-filter 注入：${e.message}`);
    }
  }));

  return [...filters].sort((a, b) => a.localeCompare(b));
}

function appendFakeIpFilters(config, filters) {
  if (!filters.length) return config;

  return config.replace(
    /(^\s{2}fake-ip-filter:\n(?:^\s{4}- .*(?:\n|$))+)/gm,
    (block) => {
      const existing = new Set();
      block.split(/\r?\n/).forEach(line => {
        const m = line.match(/^\s*-\s*['"]?([^'"]+?)['"]?\s*$/);
        if (m) existing.add(m[1].trim());
      });

      const additions = filters
        .filter(d => !existing.has(d))
        .map(d => `    - "${d}"`);

      return additions.length ? block + additions.join("\n") + "\n" : block;
    }
  );
}

function applySubscriptions(template, serverDomainFilters = []) {
  if (!template) return template;
  let out = bumpProviderPaths(bumpIconsV(template));

  subUrls.forEach((url, i) => {
    const name = subNames[i] || `[Sub${i + 1}]`;
    const placeholders = [
      `替换订阅链接${i + 1}`,
      `[***]`,
      `***`
    ];
    placeholders.forEach(placeholder => {
      out = out.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g"), url);
    });
    out = out.replace(new RegExp(`\\[显示名称${i + 1}\\]`, "g"), name);
  });
  return appendFakeIpFilters(out, serverDomainFilters);
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
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/* ===================== Main ===================== */
(async () => {
  try {
    if (!GIST_TOKEN) throw new Error("Missing GIST_TOKEN");

    log("开始处理配置文件...");
    
    const outputs = { standard: {}, lite: {} };
    const serverDomainFilters = await collectServerDomainFilters();
    if (serverDomainFilters.length) {
      log(`已为 Gist 配置注入 ${serverDomainFilters.length} 个代理服务器 fake-ip-filter 域名`);
    }

    // --- 读取逻辑保持不变 ---
    const multiStd = readIfExists(CONFIG_MULTIPLE_STD);
    if (multiStd) {
      const s = applySubscriptions(multiStd, serverDomainFilters);
      outputs.standard[GIST_FILE_MULTIPLE_STD] = { content: s };
      outputs.standard[GIST_FILE_MINI_STD] = { content: deriveMini(s) };
    }

    const singleStd = readIfExists(CONFIG_SINGLE_STD);
    if (singleStd) {
      outputs.standard[GIST_FILE_SINGLE_STD] = { content: applySubscriptions(singleStd, serverDomainFilters) };
    }

    const multiLite = readIfExists(CONFIG_MULTIPLE_LITE);
    if (multiLite) {
      const s = applySubscriptions(multiLite, serverDomainFilters);
      outputs.lite[GIST_FILE_MULTIPLE_LITE] = { content: s };
      outputs.lite[GIST_FILE_MINI_LITE] = { content: deriveMini(s) };
    }

    const singleLite = readIfExists(CONFIG_SINGLE_LITE);
    if (singleLite) {
      outputs.lite[GIST_FILE_SINGLE_LITE] = { content: applySubscriptions(singleLite, serverDomainFilters) };
    }

    log(`处理完成，Standard Gist 文件数: ${Object.keys(outputs.standard).length}, Lite/GEO Gist 文件数: ${Object.keys(outputs.lite).length}`);

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
})();
