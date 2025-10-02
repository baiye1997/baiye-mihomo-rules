#!/usr/bin/env node
"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");
const crypto = require("crypto");

/* ===================== 环境变量 ===================== */
const {
  // Credentials
  GIST_TOKEN,
  GIST_ID_STANDARD = "",
  GIST_ID_LITE = "",

  // Sub URLs
  SUB_URL_1 = "",
  SUB_URL_2 = "",

  // File paths (sources)
  CONFIG_MULTIPLE_STD = "config/baiye-multiple.yaml",
  CONFIG_SINGLE_STD   = "config/baiye-single.yaml",
  CONFIG_MULTIPLE_LITE= "config/baiye-multiple-lite.yaml",
  CONFIG_SINGLE_LITE  = "config/baiye-single-lite.yaml",

  // Filenames (targets)
  GIST_FILE_MULTIPLE_STD = "baiye-multiple.yaml",
  GIST_FILE_SINGLE_STD   = "baiye-single.yaml",
  GIST_FILE_MINI_STD     = "baiye-mini.yaml",

  GIST_FILE_MULTIPLE_LITE= "baiye-multiple-lite.yaml",
  GIST_FILE_SINGLE_LITE  = "baiye-single-lite.yaml",
  GIST_FILE_MINI_LITE    = "baiye-mini-lite.yaml",

  // Optional cosmetics
  DISPLAY_NAME_A = "[Haita]",
  DISPLAY_NAME_B = "[BoostNet]",

  // Controls
  DRY_RUN = "false",
  QUIET   = "true",
  STATUS_FILE = "",
} = process.env;

const COMMIT_SHORT = String(process.env.COMMIT_SHORT || "dev").slice(0, 7);
const statusFile   = STATUS_FILE ? path.resolve(STATUS_FILE) : "";
const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;

/* ===================== 小工具函数 ===================== */
function writeStatus(text) {
  if (!statusFile) return;
  try { fs.writeFileSync(statusFile, String(text).trim() + "\n", "utf8"); } catch {}
}
const isQuiet = QUIET === "true";
function log(...args){ if (!isQuiet) console.log(...args); }
function notice(title, msg) { console.log(`::notice title=${title}::${msg}`); }

function maskUrl(raw = "") {
  if (!raw) return raw;
  // 脱敏：长 hex、access_token、gist_token 等
  let s = raw.replace(/[0-9a-f]{20,}/gi, "***");
  s = s.replace(/([?&](?:access_token|token|auth)=)[^&#]+/gi, "$1***");
  return s;
}

function appendSummary(lines = []) {
  if (!stepSummaryPath || !lines.length) return;
  try {
    const out = ["## Gist updated files", "", ...lines.map(s => `- ${s}`), ""].join("\n");
    fs.appendFileSync(stepSummaryPath, out, "utf8");
  } catch {}
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function jitter(ms){ return Math.round(ms*(0.8+Math.random()*0.4)); }

/** 给 icons 链接增加 ?v=COMMIT_SHORT，逼缓存刷新 */
function bumpIconsV(s){
  const re = /(https?:\/\/[^\s"'<>]+\/icons\/[^\s"'<>]+\.(?:png|jpe?g|webp|svg)(?:\?[^\s"'<>]*)?)/gi;
  return s.replace(re, (full) => {
    try { const u = new URL(full); u.searchParams.set("v", COMMIT_SHORT); return u.toString(); }
    catch { return full; }
  });
}

function readIfExists(p){
  const abs = path.resolve(p);
  if (fs.existsSync(abs)) return fs.readFileSync(abs, "utf8");
  return null;
}

/* ===================== HTTP / GitHub API ===================== */
function httpJSON(method, url, bodyObj, extraHeaders = {}){
  const body = bodyObj ? JSON.stringify(bodyObj) : null;
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      headers: {
        ...(GIST_TOKEN ? { Authorization: `token ${GIST_TOKEN}` } : {}),
        "User-Agent": "github-actions",
        Accept: "application/vnd.github+json",
        ...(body ? { "Content-Type":"application/json", "Content-Length": Buffer.byteLength(body) } : {}),
        ...extraHeaders,
      },
      timeout: 20000,
    }, (res) => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => {
        const status = res.statusCode || 0;
        if (status >= 200 && status < 300) {
          try { resolve({ status, json: data ? JSON.parse(data) : {}, headers: res.headers }); }
          catch { resolve({ status, json: {}, headers: res.headers }); }
        } else {
          const err = new Error(`HTTP ${status}: ${data}`);
          err.status = status;
          err.body = data;
          reject(err);
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getGist(id){ return httpJSON("GET", `https://api.github.com/gists/${id}`); }

function normalizeFiles(filesMap) {
  const out = {};
  for (const [name, val] of Object.entries(filesMap || {})) {
    out[name] = typeof val === "string" ? { content: val } : val;
  }
  return out;
}

async function patchGistOnce(id, files, description){
  return httpJSON("PATCH", `https://api.github.com/gists/${id}`, {
    files: normalizeFiles(files),
    description,
  });
}

async function patchGistWithRetry(id, files, description, maxRetries = 4){
  let backoff = 600;
  for (let i = 0; i <= maxRetries; i++){
    try {
      return await patchGistOnce(id, files, description);
    } catch (e) {
      const st = e.status || 0;
      // 冲突/边缘网络/Cloudflare 超时等：退避重试
      if ([409, 425, 429, 500, 502, 503, 522, 524].includes(st) && i < maxRetries){
        await sleep(jitter(backoff));
        backoff *= 2;
        continue;
      }
      throw e;
    }
  }
}

/* ===================== 内容构建 ===================== */
function substituteCommon(s) {
  if (!s) return s;
  return bumpIconsV(s)
    .replace(/替换订阅链接1/g, SUB_URL_1 || "")
    .replace(/替换订阅链接2/g, SUB_URL_2 || "")
    .replace(/\[显示名称A可修改\]/g, DISPLAY_NAME_A)
    .replace(/\[显示名称B可修改\]/g, DISPLAY_NAME_B);
}

function deriveMini(from) {
  if (!from) return from;
  return from.replace(/geodata-loader:\s*standard/gi, "geodata-loader: memconservative");
}

function buildOutputs() {
  const outputs = { standard: {}, lite: {} };

  // === standard: multiple / mini ===
  const rawMultiStd = readIfExists(CONFIG_MULTIPLE_STD);
  if (rawMultiStd) {
    const withIcon = substituteCommon(rawMultiStd);
    outputs.standard[GIST_FILE_MULTIPLE_STD] = withIcon;
    outputs.standard[GIST_FILE_MINI_STD]     = deriveMini(withIcon);
  }

  // === standard: single ===
  const rawSingleStd = readIfExists(CONFIG_SINGLE_STD);
  if (rawSingleStd) {
    outputs.standard[GIST_FILE_SINGLE_STD] = substituteCommon(rawSingleStd);
  }

  // === lite: multiple / mini ===
  const rawMultiLite = readIfExists(CONFIG_MULTIPLE_LITE);
  if (rawMultiLite) {
    const withIcon = substituteCommon(rawMultiLite);
    outputs.lite[GIST_FILE_MULTIPLE_LITE] = withIcon;
    outputs.lite[GIST_FILE_MINI_LITE]     = deriveMini(withIcon);
  }

  // === lite: single ===
  const rawSingleLite = readIfExists(CONFIG_SINGLE_LITE);
  if (rawSingleLite) {
    outputs.lite[GIST_FILE_SINGLE_LITE] = substituteCommon(rawSingleLite);
  }

  return outputs;
}

/* ===================== 主流程 ===================== */
(async () => {
  try {
    // 基础校验
    if (!GIST_TOKEN) {
      writeStatus("ERROR");
      throw new Error("Missing GIST_TOKEN (with 'gist' scope).");
    }
    if (!GIST_ID_STANDARD && !GIST_ID_LITE) {
      writeStatus("ERROR");
      throw new Error("Neither GIST_ID_STANDARD nor GIST_ID_LITE provided.");
    }

    const outputs = buildOutputs();
    const stdCount = Object.keys(outputs.standard).length;
    const liteCount = Object.keys(outputs.lite).length;
    if (!stdCount && !liteCount) {
      writeStatus("NOCHANGE");
      log("No source files found. Nothing to update.");
      return;
    }

    if (DRY_RUN === "true") {
      writeStatus("DRYRUN");
      notice("Dry Run", "Files constructed; skipping PATCH to Gist.");
      return;
    }

    const desc = `update via CI | ${COMMIT_SHORT}`;
    const summaryLines = [];

    // === 更新 standard Gist ===
    if (GIST_ID_STANDARD && stdCount) {
      await patchGistWithRetry(GIST_ID_STANDARD, outputs.standard, desc);
      const after = await getGist(GIST_ID_STANDARD);
      for (const f of Object.keys(outputs.standard)) {
        const raw = after.json.files?.[f]?.raw_url || "";
        const masked = maskUrl(raw);
        notice(`Gist Updated (standard - ${f})`, masked);
        summaryLines.push(`**standard/${f}**: ${masked}`);
      }
    }

    // === 更新 lite Gist ===
    if (GIST_ID_LITE && liteCount) {
      await patchGistWithRetry(GIST_ID_LITE, outputs.lite, desc);
      const after = await getGist(GIST_ID_LITE);
      for (const f of Object.keys(outputs.lite)) {
        const raw = after.json.files?.[f]?.raw_url || "";
        const masked = maskUrl(raw);
        notice(`Gist Updated (lite - ${f})`, masked);
        summaryLines.push(`**lite/${f}**: ${masked}`);
      }
    }

    appendSummary(summaryLines);
    writeStatus("OK");
  } catch (e) {
    writeStatus("ERROR");
    console.error("❌ Gist update failed:", e.message || e);
    process.exit(1);
  }
})();
