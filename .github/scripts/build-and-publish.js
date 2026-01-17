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

function maskUrl(raw = "") {
  if (!raw) return raw;
  return raw.replace(/([?&]token=)[^&]+/gi, "$1***");
}

/* ===================== 修复：JSON转义 ===================== */
function escapeForJson(content) {
  if (typeof content !== 'string') return content;
  return content
    .replace(/\\/g, '\\\\')  // 反斜杠转义
    .replace(/"/g, '\\"')    // 双引号转义
    .replace(/\n/g, '\\n')   // 换行转义
    .replace(/\r/g, '\\r')   // 回车转义
    .replace(/\t/g, '\\t');  // 制表符转义
}

/* ===================== Subscriptions ===================== */
const subUrls = SUB_URLS.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const subNames = SUB_NAMES.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

function applySubscriptions(template) {
  if (!template) return template;
  let out = bumpIconsV(template);

  subUrls.forEach((url, i) => {
    const name = subNames[i] || `[Sub${i + 1}]`;
    out = out
      .replace(new RegExp(`替换订阅链接${i + 1}`, "g"), url)
      .replace(new RegExp(`\\[显示名称${i + 1}\\]`, "g"), name)
      .replace(new RegExp(`\\[\\*\\*\\*\\]`, "g"), url); // 也处理 [***] 格式
  });

  return out;
}

function deriveMini(s) {
  return s.replace(/geodata-loader:\s*standard/gi, "geodata-loader: memconservative");
}

/* ===================== HTTP ===================== */
function httpJSON(method, url, body) {
  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: {
        Authorization: `token ${GIST_TOKEN}`,
        "User-Agent": "github-actions",
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      timeout: 20000,
    };
    
    const req = https.request(url, options, res => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`));
        }
      });
    });
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

/* ===================== Main ===================== */
(async () => {
  try {
    if (!GIST_TOKEN) throw new Error("Missing GIST_TOKEN");

    const outputs = { standard: {}, lite: {} };

    // 处理标准版配置文件
    const multiStd = readIfExists(CONFIG_MULTIPLE_STD);
    if (multiStd) {
      const s = applySubscriptions(multiStd);
      // 修复：使用对象格式，并转义内容
      outputs.standard[GIST_FILE_MULTIPLE_STD] = {
        content: escapeForJson(s)
      };
      outputs.standard[GIST_FILE_MINI_STD] = {
        content: escapeForJson(deriveMini(s))
      };
    }

    const singleStd = readIfExists(CONFIG_SINGLE_STD);
    if (singleStd) {
      outputs.standard[GIST_FILE_SINGLE_STD] = {
        content: escapeForJson(applySubscriptions(singleStd))
      };
    }

    // 处理精简版配置文件
    const multiLite = readIfExists(CONFIG_MULTIPLE_LITE);
    if (multiLite) {
      const s = applySubscriptions(multiLite);
      outputs.lite[GIST_FILE_MULTIPLE_LITE] = {
        content: escapeForJson(s)
      };
      outputs.lite[GIST_FILE_MINI_LITE] = {
        content: escapeForJson(deriveMini(s))
      };
    }

    const singleLite = readIfExists(CONFIG_SINGLE_LITE);
    if (singleLite) {
      outputs.lite[GIST_FILE_SINGLE_LITE] = {
        content: escapeForJson(applySubscriptions(singleLite))
      };
    }

    // 调试输出
    log(`准备更新文件数 - 标准版: ${Object.keys(outputs.standard).length}, 精简版: ${Object.keys(outputs.lite).length}`);
    
    if (DRY_RUN === "true") {
      writeStatus("DRYRUN");
      log("Dry run, skip publish");
      // 输出预览
      Object.keys(outputs.standard).forEach(filename => {
        log(`标准版 ${filename}: ${outputs.standard[filename].content.length} 字符`);
      });
      Object.keys(outputs.lite).forEach(filename => {
        log(`精简版 ${filename}: ${outputs.lite[filename].content.length} 字符`);
      });
      return;
    }

    // === PATCH Standard Gist ===
    if (GIST_ID_STANDARD && Object.keys(outputs.standard).length) {
      log(`正在更新标准版 Gist: ${GIST_ID_STANDARD}`);
      try {
        const resp = await httpJSON("PATCH", 
          `https://api.github.com/gists/${GIST_ID_STANDARD}`, 
          {
            files: outputs.standard,
            description: `update via CI | ${COMMIT_SHORT}`,
          }
        );
        log("标准版 Gist 更新成功");
        Object.keys(outputs.standard).forEach(f => {
          log(`  ${f}: ${maskUrl(resp.files?.[f]?.raw_url || 'unknown')}`);
        });
      } catch (e) {
        console.error("标准版 Gist 更新失败:", e.message);
        throw e;
      }
    } else {
      log("跳过标准版 Gist 更新: 无配置或缺少 GIST_ID_STANDARD");
    }

    // === PATCH Lite Gist ===
    if (GIST_ID_LITE && Object.keys(outputs.lite).length) {
      log(`正在更新精简版 Gist: ${GIST_ID_LITE}`);
      try {
        const resp = await httpJSON("PATCH", 
          `https://api.github.com/gists/${GIST_ID_LITE}`, 
          {
            files: outputs.lite,
            description: `update via CI | ${COMMIT_SHORT}`,
          }
        );
        log("精简版 Gist 更新成功");
        Object.keys(outputs.lite).forEach(f => {
          log(`  ${f}: ${maskUrl(resp.files?.[f]?.raw_url || 'unknown')}`);
        });
      } catch (e) {
        console.error("精简版 Gist 更新失败:", e.message);
        throw e;
      }
    } else {
      log("跳过精简版 Gist 更新: 无配置或缺少 GIST_ID_LITE");
    }

    writeStatus("OK");
    log("✅ 所有 Gist 更新完成");
  } catch (e) {
    writeStatus("ERROR");
    console.error("❌ Gist 更新失败:", e.message);
    // 输出更多调试信息
    if (e.message.includes("422")) {
      console.error("\n常见 422 错误原因:");
      console.error("1. GIST_TOKEN 权限不足");
      console.error("2. Gist ID 不正确");
      console.error("3. JSON 格式不正确（已修复）");
      console.error("4. 文件内容包含无效字符");
    }
    process.exit(1);
  }
})();
