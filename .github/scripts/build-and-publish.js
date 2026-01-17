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

/* ===================== Subscriptions ===================== */
const subUrls = SUB_URLS.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const subNames = SUB_NAMES.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

function applySubscriptions(template) {
  let out = bumpIconsV(template);

  subUrls.forEach((url, i) => {
    const name = subNames[i] || `[Sub${i + 1}]`;
    out = out
      .replace(new RegExp(`替换订阅链接${i + 1}`, "g"), url)
      .replace(new RegExp(`\\[显示名称${i + 1}\\]`, "g"), name);
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
    }, res => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data || "{}"));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
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

    const outputs = { standard: {}, lite: {} };

    const multiStd = readIfExists(CONFIG_MULTIPLE_STD);
    if (multiStd) {
      const s = applySubscriptions(multiStd);
      outputs.standard[GIST_FILE_MULTIPLE_STD] = s;
      outputs.standard[GIST_FILE_MINI_STD] = deriveMini(s);
    }

    const singleStd = readIfExists(CONFIG_SINGLE_STD);
    if (singleStd) {
      outputs.standard[GIST_FILE_SINGLE_STD] = applySubscriptions(singleStd);
    }

    const multiLite = readIfExists(CONFIG_MULTIPLE_LITE);
    if (multiLite) {
      const s = applySubscriptions(multiLite);
      outputs.lite[GIST_FILE_MULTIPLE_LITE] = s;
      outputs.lite[GIST_FILE_MINI_LITE] = deriveMini(s);
    }

    const singleLite = readIfExists(CONFIG_SINGLE_LITE);
    if (singleLite) {
      outputs.lite[GIST_FILE_SINGLE_LITE] = applySubscriptions(singleLite);
    }

    if (DRY_RUN === "true") {
      writeStatus("DRYRUN");
      log("Dry run, skip publish");
      return;
    }

    if (GIST_ID_STANDARD && Object.keys(outputs.standard).length) {
      await httpJSON("PATCH", `https://api.github.com/gists/${GIST_ID_STANDARD}`, {
        files: outputs.standard,
        description: `update via CI | ${COMMIT_SHORT}`,
      });
    }

    if (GIST_ID_LITE && Object.keys(outputs.lite).length) {
      await httpJSON("PATCH", `https://api.github.com/gists/${GIST_ID_LITE}`, {
        files: outputs.lite,
        description: `update via CI | ${COMMIT_SHORT}`,
      });
    }

    writeStatus("OK");
  } catch (e) {
    writeStatus("ERROR");
    console.error(e);
    process.exit(1);
  }
})();
