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
  QUIET   = "true",              // 新增：静默模式
  STATUS_FILE = ""               // 新增：结果写入文件（可选）
} = process.env;

const COMMIT_SHORT = (process.env.COMMIT_SHORT || "dev").slice(0, 7);

function log(...args){ if (QUIET !== "true") console.log(...args); }

if (!GIST_TOKEN || !GIST_ID) {
  console.error("❌ Missing GIST_TOKEN or GIST_ID.");
  process.exit(2);
}

const RETRY_STATUS = new Set([409, 500, 502, 503, 522, 524]);

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
      if (RETRY_STATUS.has(st) && i<maxRetries){
        await sleep(jitter(backoff)); backoff*=2; continue;
      }
      throw e;
    }
  }
}

/** 生成 multiple/single/mini 文本 */
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

/** 与当前 Gist 对比：未变化则不写入 */
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
  const wantNames = {
    multiple: GIST_FILE_MULTIPLE || null,
    single:   GIST_FILE_SINGLE   || null,
    mini:     GIST_FILE_MINI     || null,
  };

  const outputs = buildOutputs();
  if (!outputs.multiple && !outputs.single && !outputs.mini){
    if (STATUS_FILE) fs.writeFileSync(STATUS_FILE, "NOCHANGE\n");
    process.exit(0);
  }

  const latest = await getGist();
  const { plan, hashes } = diffPlan(latest.json, outputs, wantNames);

  // 落盘（供你本地调试需要时打开；不上传 artifact）
  for (const [k,v] of Object.entries(outputs)){
    const fname = (k==="multiple"&&wantNames.multiple) || (k==="single"&&wantNames.single) || (k==="mini"&&wantNames.mini);
    if (fname){
      const gen = fname.replace(/\.ya?ml$/, "") + ".generated.yaml";
      try { fs.writeFileSync(gen, v, "utf8"); } catch {}
    }
  }

  if (Object.keys(plan).length === 0){
    if (STATUS_FILE) fs.writeFileSync(STATUS_FILE, "NOCHANGE\n");
    process.exit(0);
  }

  if (DRY_RUN === "true"){
    if (STATUS_FILE) fs.writeFileSync(STATUS_FILE, "DRYRUN\n");
    process.exit(0);
  }

  const desc = `update via CI | ${Object.values(hashes).filter(Boolean).join(" ")} | ${COMMIT_SHORT}`;
  await patchGistWithRetry(plan, desc);

  if (STATUS_FILE) fs.writeFileSync(STATUS_FILE, "OK\n");
  // 全静默：不打印链接、不打印文件名
  process.exit(0);
})().catch((e)=>{
  console.error(`❌ Gist update failed: ${e.status || ""} ${e.message || e}`);
  process.exit(1);
});
