"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const YAML = require("yaml");
const repo = path.resolve(__dirname, "../..");

function validateConfig(text) {
  let config;
  try { config = YAML.parse(text, { merge: true, maxAliasCount: 10000 }); }
  catch { throw new Error("配置 YAML 解析失败"); }
  if (!config || !Array.isArray(config["proxy-groups"]) || !Array.isArray(config.rules)) {
    throw new Error("配置缺少策略组或规则");
  }
  const names = config["proxy-groups"].map(g => g.name);
  if (new Set(names).size !== names.length) throw new Error("策略组名称重复");
  const known = new Set(["DIRECT", "REJECT", "REJECT-DROP", "PASS", "COMPATIBLE", ...names, ...(config.proxies || []).map(p => p.name)]);
  for (const group of config["proxy-groups"]) {
    for (const ref of group.proxies || []) if (!known.has(ref)) throw new Error(`策略组引用不存在: ${ref}`);
    for (const ref of group.use || []) if (!config["proxy-providers"]?.[ref]) throw new Error(`订阅引用不存在: ${ref}`);
  }
  for (const rule of config.rules) {
    const parts = rule.split(",");
    const target = parts.at(-1) === "no-resolve" ? parts.at(-2) : parts.at(-1);
    if (!known.has(target)) throw new Error(`规则目标不存在: ${target}`);
    if (parts[0] === "RULE-SET" && !config["rule-providers"]?.[parts[1]]) throw new Error(`规则集不存在: ${parts[1]}`);
  }
  for (const provider of [...Object.values(config["proxy-providers"] || {}), ...Object.values(config["rule-providers"] || {})]) {
    if (provider.type !== "http") continue;
    let url;
    try { url = new URL(provider.url); } catch { /* checked below */ }
    if (!["http:", "https:"].includes(url?.protocol)) throw new Error("Provider URL 无效或未替换");
    if (provider.proxy && !known.has(provider.proxy)) throw new Error(`Provider 代理引用不存在: ${provider.proxy}`);
  }
  return config;
}

function isolatedConfig(text, dir) {
  const config = validateConfig(text);
  const geoDir = process.env.MIHOMO_GEODATA_DIR;
  if (!geoDir) throw new Error("需要设置 MIHOMO_GEODATA_DIR，指向 geoip.dat / geosite.dat 所在目录");
  for (const name of ["geoip.dat", "geosite.dat"]) fs.copyFileSync(path.join(geoDir, name), path.join(dir, name));
  config["geo-auto-update"] = false;
  for (const provider of Object.values(config["proxy-providers"] || {})) {
    delete provider.url;
    delete provider.path;
    provider.type = "inline";
    provider.payload = [{ name: "美国 AI 校验节点 0.5X", type: "socks5", server: "127.0.0.1", port: 9 }];
    provider["health-check"] = { enable: false };
  }
  for (const provider of Object.values(config["rule-providers"] || {})) {
    const source = path.resolve(repo, provider.path);
    const relative = path.relative(repo, source);
    if (!relative.startsWith(`rules${path.sep}`)) throw new Error("规则文件必须位于仓库 rules 目录");
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    provider.path = target;
    provider.type = "file";
    delete provider.url;
    delete provider.proxy;
  }
  return config;
}

function validateWithCore(text, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mihomo-validate-"));
  try {
    const config = isolatedConfig(text, dir);
    const file = path.join(dir, "config.json");
    fs.writeFileSync(file, JSON.stringify(config));
    const result = spawnSync(process.env.MIHOMO_BIN || "mihomo", ["-t", "-d", dir, "-f", file], { encoding: "utf8", timeout: 60000 });
    if (result.error) throw new Error(`Mihomo 校验无法执行: ${result.error.code || "error"}`);
    if (result.status !== 0) throw new Error(`Mihomo 校验失败: ${name}\n${result.stdout}\n${result.stderr}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

module.exports = { validateConfig, isolatedConfig, validateWithCore };
