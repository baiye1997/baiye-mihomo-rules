// .github/scripts/build-and-publish.js
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
  CONFIG_SINGLE   = "config/baiye-single.yaml",
  GIST_FILE_MULTIPLE = "baiye-multiple.yaml",
  GIST_FILE_SINGLE   = "baiye-single.yaml",
  GIST_FILE_MINI     = "baiye-mini.yaml",
  DRY_RUN = "false",
  QUIET   = "true",
  STATUS_FILE = ""
} = process.env;

const COMMIT_SHORT = (process.env.COMMIT_SHORT || "dev").slice(0, 7);
const statusFile = STATUS_FILE ? path.resolve(STATUS_FILE) : "";

function writeStatus(text) {
  if (!statusFile) return;
  try { fs.writeFileSync(statusFile, String(text).trim() + "\n", "utf8"); }
  catch {}
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

async function getGist(){ return httpJSON("GET", `https://api.github.com/gists/${GIST_ID}`); }
async function patchGistOnce(files, description){
  const body = JSON.stringify({ files, description });
  return httpJSON("PATCH", `https://api.github.com/gists/${GIST_ID}`, body);
}
async function patchGistWithRetry(files, description, maxRetries=4){
  let backoff = 600;
  for (let i=0;i<=maxRetries;i++){
    try { return await patchGistOnce(files, description); }
    catch(e){
      const st = e.status||0;
      if ([409,500,502,503,522,524].includes(st) && i<maxRetries){
        await sleep(jitter(backoff)); backoff*=2; continue;
      }
      throw e;
    }
  }
}

function buildOutputs(){
  const out = {};
  if (SUB_URL_1 && SUB_URL_2){
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
  if (SUB_URL_1){
    const rawSingle = readIfExists(CONFIG_SINGLE);
    if (rawSingle){
      const withIcon = bumpIconsV(rawSingle);
      out.single = withIcon.replace(/替换订阅链接1/g, SUB_URL_1);
    }
  }
  return out;
}

function diffPlan(currentGistJSON, outputs, names){
  const plan = {};
  const hashes = {};
  const filesNow = (currentGistJSON && currentGistJSON.files) || {};

  function unchanged(name, next){
    const now = filesNow[name];
    if (!now) return false;
    if (now.truncated) return false;
    return now.content === next;
  }

  if (outputs.multiple && names.multiple){
    hashes.multiple = sha12(outputs.multiple);
    if (!unchanged(names.multiple, outputs.multiple)) plan[names.multiple] = {content: outputs.multiple};
  }
  if (outputs.single && names.single){
    hashes.single = sha12(outputs.single);
    if (!unchanged(names.single, outputs.single)) plan[names.single] = {content: outputs.single};
  }
  if (outputs.mini && names.mini){
    hashes.mini = sha12(outputs.mini);
    if (!unchanged(names.mini, outputs.mini)) plan[names.mini] = {content: outputs.mini};
  }
  return { plan, hashes };
}

(async ()=>{
  try {
    const wantNames = {
      multiple: GIST_FILE_MULTIPLE || null,
      single:   GIST_FILE_SINGLE   || null,
      mini:     GIST_FILE_MINI     || null,
    };

    const outputs = buildOutputs();
    if (!outputs.multiple && !outputs.single && !outputs.mini){
      writeStatus("NOCHANGE");
      process.exit(0);
    }

    const latest = await getGist();
    const { plan } = diffPlan(latest.json, outputs, wantNames);

    if (Object.keys(plan).length === 0){
      writeStatus("NOCHANGE");
      process.exit(0);
    }

    if (DRY_RUN === "true"){
      writeStatus("DRYRUN");
      process.exit(0);
    }

    const desc = `update via CI | ${COMMIT_SHORT}`;
    await patchGistWithRetry(plan, desc);

    writeStatus("OK");
    process.exit(0);
  } catch(e){
    writeStatus("ERROR");
    console.error("❌ Gist update failed:", e.message || e);
    process.exit(1);
  }
})();
