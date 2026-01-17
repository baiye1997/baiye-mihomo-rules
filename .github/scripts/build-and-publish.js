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

/* ===================== 修复：正确的JSON转义 ===================== */
function escapeForJson(content) {
  if (typeof content !== 'string') return content;
  // 首先进行标准的JSON转义
  return JSON.stringify(content).slice(1, -1);
  // 上面的代码会：把 " 转义为 \"，\ 转义为 \\，保持换行符为实际的换行
}

/* ===================== Subscriptions ===================== */
const subUrls = SUB_URLS.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const subNames = SUB_NAMES.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

function applySubscriptions(template) {
  if (!template) return template;
  let out = bumpIconsV(template);

  subUrls.forEach((url, i) => {
    const name = subNames[i] || `[Sub${i + 1}]`;
    // 替换多个可能的占位符格式
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

  return out;
}

function deriveMini(s) {
  return s.replace(/geodata-loader:\s*standard/gi, "geodata-loader: memconservative");
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

    // 读取和处理配置文件
    const multiStd = readIfExists(CONFIG_MULTIPLE_STD);
    if (multiStd) {
      log(`读取多订阅标准版配置文件: ${CONFIG_MULTIPLE_STD}`);
      const s = applySubscriptions(multiStd);
      outputs.standard[GIST_FILE_MULTIPLE_STD] = {
        content: s  // 注意：这里使用原始字符串，不需要转义！
      };
      outputs.standard[GIST_FILE_MINI_STD] = {
        content: deriveMini(s)
      };
    } else {
      log(`未找到多订阅标准版配置文件: ${CONFIG_MULTIPLE_STD}`);
    }

    const singleStd = readIfExists(CONFIG_SINGLE_STD);
    if (singleStd) {
      log(`读取单订阅标准版配置文件: ${CONFIG_SINGLE_STD}`);
      outputs.standard[GIST_FILE_SINGLE_STD] = {
        content: applySubscriptions(singleStd)
      };
    } else {
      log(`未找到单订阅标准版配置文件: ${CONFIG_SINGLE_STD}`);
    }

    const multiLite = readIfExists(CONFIG_MULTIPLE_LITE);
    if (multiLite) {
      log(`读取多订阅精简版配置文件: ${CONFIG_MULTIPLE_LITE}`);
      const s = applySubscriptions(multiLite);
      outputs.lite[GIST_FILE_MULTIPLE_LITE] = {
        content: s
      };
      outputs.lite[GIST_FILE_MINI_LITE] = {
        content: deriveMini(s)
      };
    } else {
      log(`未找到多订阅精简版配置文件: ${CONFIG_MULTIPLE_LITE}`);
    }

    const singleLite = readIfExists(CONFIG_SINGLE_LITE);
    if (singleLite) {
      log(`读取单订阅精简版配置文件: ${CONFIG_SINGLE_LITE}`);
      outputs.lite[GIST_FILE_SINGLE_LITE] = {
        content: applySubscriptions(singleLite)
      };
    } else {
      log(`未找到单订阅精简版配置文件: ${CONFIG_SINGLE_LITE}`);
    }

    log(`处理完成，标准版文件数: ${Object.keys(outputs.standard).length}, 精简版文件数: ${Object.keys(outputs.lite).length}`);

    if (DRY_RUN === "true") {
      writeStatus("DRYRUN");
      log("=== DRY RUN 模式 ===");
      // 输出示例内容
      Object.entries(outputs.standard).forEach(([filename, fileObj]) => {
        log(`标准版 ${filename} 内容前100字符:`);
        console.log(fileObj.content.substring(0, 100));
        log("---");
      });
      return;
    }

    // === PATCH Standard Gist ===
    if (GIST_ID_STANDARD && Object.keys(outputs.standard).length) {
      log(`更新标准版 Gist: ${GIST_ID_STANDARD}`);
      try {
        const resp = await httpJSON("PATCH", `https://api.github.com/gists/${GIST_ID_STANDARD}`, {
          files: outputs.standard,
          description: `update via CI | ${COMMIT_SHORT}`,
        });
        log("✅ 标准版 Gist 更新成功");
        Object.keys(outputs.standard).forEach(f => {
          log(`  ${f}: ${maskUrl(resp.files[f]?.raw_url)}`);
        });
      } catch (e) {
        console.error("❌ 标准版 Gist 更新失败:", e.message);
        throw e;
      }
    }

    // === PATCH Lite Gist ===
    if (GIST_ID_LITE && Object.keys(outputs.lite).length) {
      log(`更新精简版 Gist: ${GIST_ID_LITE}`);
      try {
        const resp = await httpJSON("PATCH", `https://api.github.com/gists/${GIST_ID_LITE}`, {
          files: outputs.lite,
          description: `update via CI | ${COMMIT_SHORT}`,
        });
        log("✅ 精简版 Gist 更新成功");
        Object.keys(outputs.lite).forEach(f => {
          log(`  ${f}: ${maskUrl(resp.files[f]?.raw_url)}`);
        });
      } catch (e) {
        console.error("❌ 精简版 Gist 更新失败:", e.message);
        throw e;
      }
    }

    writeStatus("OK");
    log("🎉 所有 Gist 更新完成");
  } catch (e) {
    writeStatus("ERROR");
    console.error("❌ Gist 更新失败:", e.message);
    
    // 如果可能是YAML格式问题，给出提示
    if (e.message.includes("422") && e.message.includes("Invalid request")) {
      console.error("\n💡 可能的解决方案:");
      console.error("1. 检查配置文件是否为有效的YAML格式");
      console.error("2. 确保配置文件中没有未闭合的引号或括号");
      console.error("3. 尝试手动更新Gist确认权限");
      console.error("4. 使用 DRY_RUN=true 检查处理后的内容");
    }
    
    process.exit(1);
  }
})();
