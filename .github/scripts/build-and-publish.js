// .github/scripts/build-and-publish.js
// 环境变量（按调用场景传入）：
//   GIST_TOKEN, GIST_ID
//   SUB_URL_1, SUB_URL_2
//   CONFIG_MULTIPLE, CONFIG_SINGLE
//   GIST_FILE_MULTIPLE, GIST_FILE_SINGLE, GIST_FILE_MINI
//   COMMIT_SHORT, DRY_RUN ("true"/"false")

const fs = require("fs");
const https = require("https");
const path = require("path");
const crypto = require("crypto");

const {
  GIST_TOKEN,
  GIST_ID,
  SUB_URL_1,
  SUB_URL_2,
  CONFIG_MULTIPLE = "config/baiye-multiple.yaml",
  CONFIG_SINGLE = "config/baiye-single.yaml",
  GIST_FILE_MULTIPLE = "baiye-multiple.yaml",
  GIST_FILE_SINGLE = "baiye-single.yaml",
  GIST_FILE_MINI = "baiye-mini.yaml",
  DRY_RUN = "false",
} = process.env;

const COMMIT_SHORT = (process.env.COMMIT_SHORT || "dev").slice(0, 7);

if (!GIST_TOKEN || !GIST_ID) {
  console.error("❌ Missing GIST_TOKEN or GIST_ID.");
  process.exit(2);
}

const RETRY_STATUS = new Set([409, 500, 502, 503, 522, 524]);

function sha12(s) {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function jitter(ms) { return Math.round(ms * (0.8 + Math.random() * 0.4)); }

function bumpIconsV(s) {
  const re = /(https?:\/\/[^\s"'<>]+\/icons\/[^\s"'<>]+\.(?:png|jpe?g|webp|svg)(?:\?[^\s"'<>]*)?)/gi;
  return s.replace(re, (full) => {
    try {
      const u = new URL(full);
      u.searchParams.set("v", COMMIT_SHORT);
      return u.toString();
    } catch {
      return full;
    }
  });
}

function readIfExists(p) {
  const abs = path.resolve(p);
  if (fs.existsSync(abs)) return fs.readFileSync(abs, "utf8");
  return null;
}

function httpJSON(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        headers: {
          Authorization: `token ${GIST_TOKEN}`,
          "User-Agent": "github-actions",
          Accept: "application/vnd.github+json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          const status = res.statusCode || 0;
          const etag = res.headers.etag;
          if (status >= 200 && status < 300) {
            try {
              const json = data ? JSON.parse(data) : {};
              resolve({ status, json, etag, headers: res.headers });
            } catch {
              resolve({ status, json: {}, etag, headers: res.headers });
            }
          } else {
            reject(Object.assign(new Error(`HTTP ${status}: ${data}`), { status, body: data }));
          }
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getGist() {
  return httpJSON("GET", `https://api.github.com/gists/${GIST_ID}`);
}

async function patchGistOnce(files, description) {
  const body = JSON.stringify({ files, description });
  return httpJSON("PATCH", `https://api.github.com/gists/${GIST_ID}`, body);
}

async function patchGistWithRetry(files, description, maxRetries = 4) {
  let backoff = 600;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await patchGistOnce(files, description);
    } catch (e) {
      const st = e.status || 0;
      if (RETRY_STATUS.has(st) && i < maxRetries) {
        const d = jitter(backoff);
        console.warn(`⚠️ PATCH failed with ${st}, retry ${i + 1}/${maxRetries} after ${d}ms`);
        await sleep(d);
        backoff *= 2;
        continue;
      }
      throw e;
    }
  }
}

/** 生成 multiple / single / mini 文本 */
function buildOutputs() {
  const out = {};

  // multiple / mini
  if (SUB_URL_1 && SUB_URL_2) {
    const rawMulti = readIfExists(CONFIG_MULTIPLE);
    if (!rawMulti) throw new Error(`${CONFIG_MULTIPLE} not found`);
    const withIcon = bumpIconsV(rawMulti);
    const multiple = withIcon
      .replace(/替换订阅链接1/g, SUB_URL_1)
      .replace(/替换订阅链接2/g, SUB_URL_2)
      .replace(/\[显示名称A可修改\]/g, "[Haita]")
      .replace(/\[显示名称B可修改\]/g, "[BoostNet]");
    out.multiple = multiple;
    out.mini = multiple.replace(/geodata-loader:\s*standard/g, "geodata-loader: memconservative");
  }

  // single
  if (SUB_URL_1) {
    const rawSingle = readIfExists(CONFIG_SINGLE);
    if (rawSingle) {
      const withIcon = bumpIconsV(rawSingle);
      out.single = withIcon.replace(/替换订阅链接1/g, SUB_URL_1);
    }
  }

  return out;
}

/** 与当前 Gist 对比：未变化则不写入 */
function diffPlan(currentGistJSON, outputs, names) {
  const plan = {};
  const hashes = {};
  const filesNow = (currentGistJSON && currentGistJSON.files) || {};

  function unchanged(name, next) {
    const now = filesNow[name];
    if (!now) return false;
    if (now.truncated) return false; // 内容被截断无法比对，保守重写
    return now.content === next;
  }

  if (outputs.multiple && names.multiple) {
    hashes.multiple = sha12(outputs.multiple);
    if (!unchanged(names.multiple, outputs.multiple)) {
      plan[names.multiple] = { content: outputs.multiple };
    }
  }
  if (outputs.single && names.single) {
    hashes.single = sha12(outputs.single);
    if (!unchanged(names.single, outputs.single)) {
      plan[names.single] = { content: outputs.single };
    }
  }
  if (outputs.mini && names.mini) {
    hashes.mini = sha12(outputs.mini);
    if (!unchanged(names.mini, outputs.mini)) {
      plan[names.mini] = { content: outputs.mini };
    }
  }

  return { plan, hashes };
}

function fixedRawFromApi(owner, gistId, apiRawUrl, fileName) {
  // 首选规范形式（需要 owner）：
  if (owner) return `https://gist.githubusercontent.com/${owner}/${gistId}/raw/${fileName}`;
  // 退而求其次：从 API raw_url 去掉提交 hash
  // 形如 .../<user>/<id>/raw/<sha>/<file>
  try {
    const u = new URL(apiRawUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    const iRaw = parts.indexOf("raw");
    if (iRaw >= 0 && parts.length >= iRaw + 3) {
      // 移除 raw 后面的 sha 段
      parts.splice(iRaw + 1, 1);
      u.pathname = "/" + parts.join("/");
      return u.toString();
    }
  } catch {}
  // 再不行就返回 apiRawUrl 原样
  return apiRawUrl || `https://gist.githubusercontent.com/${gistId}/raw/${fileName}`;
}

(async () => {
  const wantNames = {
    multiple: GIST_FILE_MULTIPLE || null,
    single:   GIST_FILE_SINGLE   || null,
    mini:     GIST_FILE_MINI     || null,
  };

  const outputs = buildOutputs();
  if (!outputs.multiple && !outputs.single && !outputs.mini) {
    console.log("ℹ️ Nothing to build (missing inputs or configs).");
    process.exit(0);
  }

  const latest = await getGist();
  const { plan, hashes } = diffPlan(latest.json, outputs, wantNames);

  const hashStr = [
    hashes.multiple ? `multiple:${hashes.multiple}` : null,
    hashes.single   ? `single:${hashes.single}`     : null,
    hashes.mini     ? `mini:${hashes.mini}`         : null,
  ].filter(Boolean).join(" ");

  console.log(`🧩 Hashes => ${hashStr || "no-change"}`);

  // 落盘生成物（便于 artifacts）
  for (const [k, v] of Object.entries(outputs)) {
    const fname =
      (k === "multiple" && wantNames.multiple) ||
      (k === "single"   && wantNames.single)   ||
      (k === "mini"     && wantNames.mini);
    if (fname) {
      const gen = fname.replace(/\.ya?ml$/, "") + ".generated.yaml";
      fs.writeFileSync(gen, v, "utf8");
    }
  }

  if (Object.keys(plan).length === 0) {
    console.log("✅ No effective changes. Skip PATCH.");
    // 也输出当前固定链接表，方便复制
    const owner = latest.json?.owner?.login;
    const id = latest.json?.id || GIST_ID;
    const table = [];
    for (const fname of [wantNames.multiple, wantNames.single, wantNames.mini].filter(Boolean)) {
      const apiRaw = latest.json?.files?.[fname]?.raw_url || "";
      const url = fixedRawFromApi(owner, id, apiRaw, fname);
      table.push(`| ${fname} | ${url} |`);
    }
    if (table.length) {
      console.log("::notice title=Gist Links (no changes)::\n" + ["| File | URL |","|------|-----|",...table].join("\n"));
    }
    process.exit(0);
  }

  if (DRY_RUN === "true") {
    console.log("🔎 DRY_RUN=true → build only, skip publishing to Gist.");
    // 同时也给出推测的固定链接（基于最新 Gist 元数据）
    const owner = latest.json?.owner?.login;
    const id = latest.json?.id || GIST_ID;
    const table = [];
    for (const fname of Object.keys(plan)) {
      const apiRaw = latest.json?.files?.[fname]?.raw_url || "";
      const url = fixedRawFromApi(owner, id, apiRaw, fname);
      table.push(`| ${fname} | ${url} |`);
    }
    if (table.length) {
      console.log("::notice title=Gist Links (dry-run)::\n" + ["| File | URL |","|------|-----|",...table].join("\n"));
    }
    process.exit(0);
  }

  const desc = `update via CI | ${hashStr || "partial-change"} | ${COMMIT_SHORT}`;
  const patched = await patchGistWithRetry(plan, desc);

  // 输出固定 raw 地址表（不带 commit hash）
  const owner = patched.json?.owner?.login || latest.json?.owner?.login;
  const id = patched.json?.id || latest.json?.id || GIST_ID;

  const table = [];
  for (const fname of Object.keys(plan)) {
    const apiRaw = patched.json?.files?.[fname]?.raw_url || latest.json?.files?.[fname]?.raw_url || "";
    const url = fixedRawFromApi(owner, id, apiRaw, fname);
    console.log(`✅ ${fname} → ${url}`);
    table.push(`| ${fname} | ${url} |`);
  }
  if (table.length) {
    console.log("::notice title=Gist Links::\n" + ["| File | URL |","|------|-----|",...table].join("\n"));
  }
})().catch((e) => {
  console.error(`❌ Gist update failed: ${e.status || ""} ${e.message || e}`);
  process.exit(1);
});
