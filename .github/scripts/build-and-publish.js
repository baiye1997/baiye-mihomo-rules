const fs = require("fs");
const https = require("https");
const path = require("path");
const crypto = require("crypto");

const {
  GIST_TOKEN,
  GIST_ID_STANDARD,
  GIST_ID_LITE,
  SUB_URL_1,
  SUB_URL_2,
  DRY_RUN = "false",
  STATUS_FILE = ""
} = process.env;

const COMMIT_SHORT = (process.env.COMMIT_SHORT || "dev").slice(0, 7);
const statusFile = STATUS_FILE ? path.resolve(STATUS_FILE) : "";
const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;

function writeStatus(text) {
  if (!statusFile) return;
  try { fs.writeFileSync(statusFile, String(text).trim() + "\n", "utf8"); }
  catch {}
}

function maskUrl(raw = "") {
  return raw.replace(/[0-9a-f]{20,}/gi, "***");
}
function addAnnotation(title, url) {
  const masked = maskUrl(url);
  console.log(`::notice title=${title}::${masked}`);
  return masked;
}
function appendSummary(lines = []) {
  if (!stepSummaryPath || !lines.length) return;
  try {
    const out = [
      "## Gist updated files",
      "",
      ...lines.map(s => `- ${s}`),
      ""
    ].join("\n");
    fs.appendFileSync(stepSummaryPath, out, "utf8");
  } catch {}
}

function sha12(s){ return crypto.createHash("sha256").update(s).digest("hex").slice(0,12); }
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function jitter(ms){ return Math.round(ms*(0.8+Math.random()*0.4)); }

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

function httpJSON(method, url, body, headers={}){
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      headers: {
        Authorization: `token ${GIST_TOKEN}`,
        "User-Agent": "github-actions",
        Accept: "application/vnd.github+json",
        ...(body ? {"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)} : {}),
        ...headers,
      },
    }, (res)=>{
      let data=""; res.on("data",d=>data+=d);
      res.on("end", ()=>{
        const status = res.statusCode||0;
        if (status>=200 && status<300){
          try { resolve({status, json: data?JSON.parse(data):{}, headers: res.headers}); }
          catch { resolve({status, json:{}, headers: res.headers}); }
        } else {
          reject(Object.assign(new Error(`HTTP ${status}: ${data}`), {status, body:data}));
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getGist(id){ return httpJSON("GET", `https://api.github.com/gists/${id}`); }
async function patchGistOnce(id, files, description){
  const body = JSON.stringify({ files, description });
  return httpJSON("PATCH", `https://api.github.com/gists/${id}`, body);
}
async function patchGistWithRetry(id, files, description, maxRetries=4){
  let backoff = 600;
  for (let i=0;i<=maxRetries;i++){
    try { return await patchGistOnce(id, files, description); }
    catch(e){
      const st = e.status||0;
      if ([409,500,502,503,522,524].includes(st) && i<maxRetries){
        await sleep(jitter(backoff)); backoff*=2; continue;
      }
      throw e;
    }
  }
}

function buildOutputs() {
  const outputs = { standard: {}, lite: {} };

  // multiple.yaml / mini.yaml
  const rawMulti = readIfExists("config/baiye-multiple.yaml");
  if (rawMulti) {
    const withIcon = bumpIconsV(rawMulti)
      .replace(/替换订阅链接1/g, SUB_URL_1 || "")
      .replace(/替换订阅链接2/g, SUB_URL_2 || "")
      .replace(/\[显示名称A可修改\]/g, "[Haita]")
      .replace(/\[显示名称B可修改\]/g, "[BoostNet]");
    outputs.standard["baiye-multiple.yaml"] = withIcon;
    outputs.standard["baiye-mini.yaml"] = withIcon.replace(/geodata-loader:\s*standard/g, "geodata-loader: memconservative");
  }

  // single.yaml
  const rawSingle = readIfExists("config/baiye-single.yaml");
  if (rawSingle) {
    const withIcon = bumpIconsV(rawSingle).replace(/替换订阅链接1/g, SUB_URL_1 || "");
    outputs.standard["baiye-single.yaml"] = withIcon;
  }

  // multiple-lite.yaml / mini-lite.yaml
  const rawMultiLite = readIfExists("config/baiye-multiple-lite.yaml");
  if (rawMultiLite) {
    const withIcon = bumpIconsV(rawMultiLite)
      .replace(/替换订阅链接1/g, SUB_URL_1 || "")
      .replace(/替换订阅链接2/g, SUB_URL_2 || "")
      .replace(/\[显示名称A可修改\]/g, "[Haita]")
      .replace(/\[显示名称B可修改\]/g, "[BoostNet]");
    outputs.lite["baiye-multiple-lite.yaml"] = withIcon;
    outputs.lite["baiye-mini-lite.yaml"] = withIcon.replace(/geodata-loader:\s*standard/g, "geodata-loader: memconservative");
  }

  // single-lite.yaml
  const rawSingleLite = readIfExists("config/baiye-single-lite.yaml");
  if (rawSingleLite) {
    const withIcon = bumpIconsV(rawSingleLite).replace(/替换订阅链接1/g, SUB_URL_1 || "");
    outputs.lite["baiye-single-lite.yaml"] = withIcon;
  }

  return outputs;
}

(async ()=>{
  try {
    const outputs = buildOutputs();
    if (!Object.keys(outputs.standard).length && !Object.keys(outputs.lite).length){
      writeStatus("NOCHANGE");
      process.exit(0);
    }

    if (DRY_RUN === "true"){
      writeStatus("DRYRUN");
      process.exit(0);
    }

    const desc = `update via CI | ${COMMIT_SHORT}`;
    const summaryLines = [];

    // === 更新 standard Gist ===
    if (GIST_ID_STANDARD && Object.keys(outputs.standard).length){
      await patchGistWithRetry(GIST_ID_STANDARD, outputs.standard, desc);
      const after = await getGist(GIST_ID_STANDARD);
      for (const f of Object.keys(outputs.standard)) {
        const raw = after.json.files[f]?.raw_url || "";
        const masked = addAnnotation(`Gist Updated (standard - ${f})`, raw);
        summaryLines.push(`**standard/${f}**: ${masked}`);
      }
    }

    // === 更新 lite Gist ===
    if (GIST_ID_LITE && Object.keys(outputs.lite).length){
      await patchGistWithRetry(GIST_ID_LITE, outputs.lite, desc);
      const after = await getGist(GIST_ID_LITE);
      for (const f of Object.keys(outputs.lite)) {
        const raw = after.json.files[f]?.raw_url || "";
        const masked = addAnnotation(`Gist Updated (lite - ${f})`, raw);
        summaryLines.push(`**lite/${f}**: ${masked}`);
      }
    }

    appendSummary(summaryLines);
    writeStatus("OK");
    process.exit(0);
  } catch(e){
    writeStatus("ERROR");
    console.error("❌ Gist update failed:", e.message || e);
    process.exit(1);
  }
})();
