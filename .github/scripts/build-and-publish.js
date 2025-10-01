// .github/scripts/build-and-publish.js
// env（按调用场景传入）：
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

function sha12(s) {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);
}

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
          const etag = res.headers.etag;
          const status = res.statusCode || 0;
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

const RETRY_STATUS = new Set([409, 500, 502, 503, 522, 524]);
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function jitter(ms) { return Math.round(ms * (0.8 + Math.random() * 0.4)); }

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
        const d = Math.round(backoff * (0.8 + Math.random() * 0.4));
        console.warn(`⚠️ PATCH failed with ${st}, retry ${i + 1}/${maxRetries} after ${d}ms`);
        await new Promise(r => setTimeout(r, d));
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

  // multiple / mini（需要 SUB_URL_1 + SUB_URL_2 + CONFIG_MULTIPLE）
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

  // single（需要 SUB_URL_1 + CONFIG_SINGLE）
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
    if (now.truncated) return false; // 无法比对，保守重写
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

  // 将生成物保存到工作区（便于 artifact 或本地排查）
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
    process.exit(0);
  }

  if (DRY_RUN === "true") {
    console.log("🔎 DRY_RUN=true → build only, skip publishing to Gist.");
    process.exit(0);
  }

  const desc = `update via CI | ${hashStr || "partial-change"} | ${COMMIT_SHORT}`;
  const patched = await patchGistWithRetry(plan, desc);

  const owner = patched.json?.owner?.login;
  const id = patched.json?.id || GIST_ID;
  for (const fname of Object.keys(plan)) {
    const fmeta = patched.json?.files?.[fname];
    if (fmeta?.raw_url) {
      const raw = `https://gist.githubusercontent.com/${owner}/${id}/raw/${fmeta.raw_url.split("/raw/")[1]}`;
      console.log(`✅ ${fname} → ${raw}`);
    } else {
      console.log(`✅ ${fname} updated.`);
    }
  }
})().catch((e) => {
  console.error(`❌ Gist update failed: ${e.status || ""} ${e.message || e}`);
  process.exit(1);
});
