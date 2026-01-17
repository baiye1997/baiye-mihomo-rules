#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

/* ===================== 环境变量 ===================== */
const {
  GIST_TOKEN,
  GIST_ID_STANDARD = "",
  GIST_ID_LITE = "",
  SUB_URLS = "",
  SUB_NAMES = "",
  CONFIG_MULTIPLE_STD = "config/baiye-multiple.yaml",
  CONFIG_SINGLE_STD   = "config/baiye-single.yaml",
  CONFIG_MULTIPLE_LITE= "config/baiye-multiple-lite.yaml",
  CONFIG_SINGLE_LITE  = "config/baiye-single-lite.yaml",
  GIST_FILE_MULTIPLE_STD = "baiye-multiple.yaml",
  GIST_FILE_SINGLE_STD   = "baiye-single.yaml",
  GIST_FILE_MINI_STD     = "baiye-mini.yaml",
  GIST_FILE_MULTIPLE_LITE= "baiye-multiple-lite.yaml",
  GIST_FILE_SINGLE_LITE  = "baiye-single-lite.yaml",
  GIST_FILE_MINI_LITE    = "baiye-mini-lite.yaml",
  DRY_RUN = "false",
  QUIET = "true",
  STATUS_FILE = "",
} = process.env;

const COMMIT_SHORT = (process.env.COMMIT_SHORT || "dev").slice(0,7);
const statusFile = STATUS_FILE ? path.resolve(STATUS_FILE) : "";

/* ===================== 工具函数 ===================== */
function writeStatus(text){ if(statusFile) fs.writeFileSync(statusFile, text+"\n", "utf8"); }
function log(...args){ if(QUIET!=="true") console.log(...args); }
function maskUrl(s){ return s ? s.replace(/[0-9a-f]{20,}/gi,"***").replace(/([?&](?:access_token|token|auth)=)[^&#]+/gi,"$1***") : s; }
function appendSummary(lines=[]){ 
  if(!process.env.GITHUB_STEP_SUMMARY || !lines.length) return;
  try{
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, ["## Gist updated files","",...lines.map(s=>`- ${s}`),""].join("\n"), "utf8");
  }catch{}
}

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function jitter(ms){ return Math.round(ms*(0.8+Math.random()*0.4)); }

// 清理不可见控制字符，避免 Gist 422
function sanitizeContent(s){
  if(!s) return s;
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,""); 
}

// 给 icons 链接增加 ?v=COMMIT_SHORT，逼缓存刷新
function bumpIconsV(s){
  if(!s) return s;
  const re = /(https?:\/\/[^\s"'<>]+\/icons\/[^\s"'<>]+\.(?:png|jpe?g|webp|svg)(?:\?[^\s"'<>]*)?)/gi;
  return s.replace(re, url=>{
    try { const u = new URL(url); u.searchParams.set("v", COMMIT_SHORT); return u.toString(); } 
    catch{return url;}
  });
}

// 读取文件
function readIfExists(p){ const abs=path.resolve(p); return fs.existsSync(abs)?fs.readFileSync(abs,"utf8"):null; }

/* ===================== GitHub API ===================== */
function httpJSON(method, url, bodyObj, extraHeaders={}){
  const body = bodyObj ? JSON.stringify(bodyObj) : null;
  return new Promise((resolve,reject)=>{
    const req = https.request(url,{
      method,
      headers: {
        ...(GIST_TOKEN?{Authorization:`token ${GIST_TOKEN}`}:{ }),
        "User-Agent":"github-actions",
        Accept:"application/vnd.github+json",
        ...(body?{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body)}:{ }),
        ...extraHeaders
      },
      timeout:20000
    },res=>{
      let data="";
      res.on("data",d=>data+=d);
      res.on("end",()=>{
        const status=res.statusCode||0;
        if(status>=200 && status<300){
          try{ resolve({status,json:data?JSON.parse(data):{},headers:res.headers}); } 
          catch{ resolve({status,json:{},headers:res.headers}); }
        }else{
          const err=new Error(`HTTP ${status}: ${data}`);
          err.status=status;
          err.body=data;
          reject(err);
        }
      });
    });
    req.on("error",reject);
    if(body) req.write(body);
    req.end();
  });
}

async function getGist(id){ return httpJSON("GET",`https://api.github.com/gists/${id}`); }
async function patchGistOnce(id, files, desc){ return httpJSON("PATCH",`https://api.github.com/gists/${id}`, {files, description:desc}); }
async function patchGistWithRetry(id, files, desc,maxRetries=4){
  let backoff=600;
  for(let i=0;i<=maxRetries;i++){
    try{ return await patchGistOnce(id, files, desc);} 
    catch(e){
      if([409,425,429,500,502,503,522,524].includes(e.status) && i<maxRetries){
        await sleep(jitter(backoff));
        backoff*=2;
        continue;
      }
      throw e;
    }
  }
}

/* ===================== 内容构建 ===================== */
function substituteCommon(s){
  if(!s) return s;
  const urls = Array.isArray(SUB_URLS)?SUB_URLS.split(","):SUB_URLS.split(/\s+/);
  const names = Array.isArray(SUB_NAMES)?SUB_NAMES.split(","):SUB_NAMES.split(/\s+/);
  let out = bumpIconsV(s);
  urls.forEach((u,i)=>{ if(u) out=out.replace(new RegExp(`替换订阅链接${i+1}`,"g"),u); });
  names.forEach((n,i)=>{ if(n) out=out.replace(new RegExp(`\\[显示名称${i+1}\\]`,"g"),n); });
  return sanitizeContent(out);
}

// 生成 mini 版本
function deriveMini(from){ 
  if(!from) return from;
  return from.replace(/geodata-loader:\s*standard/gi,"geodata-loader: memconservative");
}

function buildOutputs(){
  const outputs={standard:{},lite:{}};

  // Standard multiple / mini
  const rawMultiStd = readIfExists(CONFIG_MULTIPLE_STD);
  if(rawMultiStd){
    const content=substituteCommon(rawMultiStd);
    outputs.standard[GIST_FILE_MULTIPLE_STD]=content;
    outputs.standard[GIST_FILE_MINI_STD]=deriveMini(content);
  }

  // Standard single
  const rawSingleStd = readIfExists(CONFIG_SINGLE_STD);
  if(rawSingleStd){
    outputs.standard[GIST_FILE_SINGLE_STD]=substituteCommon(rawSingleStd);
  }

  // Lite multiple / mini
  const rawMultiLite = readIfExists(CONFIG_MULTIPLE_LITE);
  if(rawMultiLite){
    const content=substituteCommon(rawMultiLite);
    outputs.lite[GIST_FILE_MULTIPLE_LITE]=content;
    outputs.lite[GIST_FILE_MINI_LITE]=deriveMini(content);
  }

  // Lite single
  const rawSingleLite = readIfExists(CONFIG_SINGLE_LITE);
  if(rawSingleLite){
    outputs.lite[GIST_FILE_SINGLE_LITE]=substituteCommon(rawSingleLite);
  }

  return outputs;
}

/* ===================== 主流程 ===================== */
(async()=>{
  try{
    if(!GIST_TOKEN){ writeStatus("ERROR"); throw new Error("Missing GIST_TOKEN"); }
    if(!GIST_ID_STANDARD && !GIST_ID_LITE){ writeStatus("ERROR"); throw new Error("No GIST_ID"); }

    const outputs = buildOutputs();
    if(!Object.keys(outputs.standard).length && !Object.keys(outputs.lite).length){
      writeStatus("NOCHANGE");
      log("No files to update.");
      return;
    }

    if(DRY_RUN==="true"){ writeStatus("DRYRUN"); log("Dry run, skipping patch"); return; }

    const desc=`update via CI | ${COMMIT_SHORT}`;
    const summary=[];

    // Standard
    if(GIST_ID_STANDARD && Object.keys(outputs.standard).length){
      await patchGistWithRetry(GIST_ID_STANDARD, outputs.standard, desc);
      const after = await getGist(GIST_ID_STANDARD);
      for(const f of Object.keys(outputs.standard)){
        const raw = after.json.files?.[f]?.raw_url || "";
        summary.push(`**standard/${f}**: ${maskUrl(raw)}`);
      }
    }

    // Lite
    if(GIST_ID_LITE && Object.keys(outputs.lite).length){
      await patchGistWithRetry(GIST_ID_LITE, outputs.lite, desc);
      const after = await getGist(GIST_ID_LITE);
      for(const f of Object.keys(outputs.lite)){
        const raw = after.json.files?.[f]?.raw_url || "";
        summary.push(`**lite/${f}**: ${maskUrl(raw)}`);
      }
    }

    appendSummary(summary);
    writeStatus("OK");
  }catch(e){
    writeStatus("ERROR");
    console.error("❌ Gist update failed:", e.message||e);
    process.exit(1);
  }
})();
