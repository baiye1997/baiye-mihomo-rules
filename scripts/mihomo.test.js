"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: pause } = require('node:timers/promises');
const { applySubscriptions, deriveMini } = require('../.github/scripts/build-and-publish');
const { isolatedConfig, validateConfig } = require('../.github/scripts/validate-config');
const enabled = Boolean(process.env.MIHOMO_BIN && process.env.MIHOMO_GEODATA_DIR);

async function freePort() {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}

async function runConfig(name, nodes, check, mini = false, cold = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mihomo-regression-'));
  let ruleDownloads = 0;
  const health = http.createServer((req, res) => {
    if (cold && req.url === '/subscription') { res.writeHead(503); res.end(); return; }
    if (cold && req.url.startsWith('/rules/') && !req.url.includes('..')) {
      ruleDownloads++;
      res.writeHead(200); res.end(fs.readFileSync(path.join(process.cwd(), req.url))); return;
    }
    res.writeHead(204); res.end();
  });
  health.listen(0, '127.0.0.1'); await once(health, 'listening');
  let proc;
  try {
    let text = applySubscriptions(fs.readFileSync(`config/${name}`, 'utf8'), [], ['https://example.invalid/one', 'https://example.invalid/two'], ['[天照]', '[月读]']);
    if (mini) text = deriveMini(text);
    const original = validateConfig(text);
    const c = isolatedConfig(text, dir);
    const api = await freePort(), mixed = await freePort();
    const probe = `http://127.0.0.1:${health.address().port}/`;
    c['external-controller'] = `127.0.0.1:${api}`; c['mixed-port'] = mixed;
    c.dns.enable = false; c.tun.enable = false; c.sniffer.enable = false; c['log-level'] = 'info';
    if (cold) {
      // Exercise real HTTP providers and an empty rules cache, not inline/file replacements.
      c.dns.enable = original.dns.enable; c.dns.listen = '127.0.0.1:0';
      fs.rmSync(path.join(dir, 'rules'), { recursive: true, force: true });
      c['proxy-providers'] = original['proxy-providers'];
      c['rule-providers'] = original['rule-providers'];
      for (const p of Object.values(c['proxy-providers'])) { p.url = probe + 'subscription'; p.proxy = '🚀 节点选择'; }
      for (const p of Object.values(c['rule-providers'])) p.url = probe + p.path.replace(/^\.\//, '');
    }
    for (const [key, p] of Object.entries(c['proxy-providers'])) {
      // Named DIRECT fixtures exercise selection without real subscription traffic.
      p.payload = nodes.map(node => typeof node === 'string' ? { name: node, type: 'direct' } : node);
      p['health-check'] = { ...original['proxy-providers'][key]['health-check'], url: probe };
    }
    // Preserve production intervals/laziness so startup fallback is not masked by accelerated probes.
    for (const g of c['proxy-groups']) if (g.url) g.url = probe;
    const domains = ['chatgpt.com', 'api.anthropic.com', 'gemini.google.com', 'apple-relay.apple.com', 'apple-relay.cloudflare.com', 'push.apple.com', 'dl.steam.clngaa.com', 'steamchina.com','cn.apple.com','gs-loc-cn.apple.com'];
    c.hosts = Object.fromEntries(domains.map(domain => [domain, '127.0.0.1']));
    const file = path.join(dir, 'config.json'); fs.writeFileSync(file, JSON.stringify(c));
    let logs = '';
    proc = spawn(process.env.MIHOMO_BIN, ['-d', dir, '-f', file]);
    proc.stdout.on('data', b => logs += b); proc.stderr.on('data', b => logs += b);
    async function get(resource) {
      const res = await fetch(`http://127.0.0.1:${api}/${resource}`, { signal: AbortSignal.timeout(1000) });
      assert.ok(res.ok); return res.json();
    }
    async function request(domain) {
      await new Promise((resolve, reject) => {
        const req = http.get({ hostname: '127.0.0.1', port: mixed,
          path: `http://${domain}:${health.address().port}/route-probe`, agent: false,
          headers: { Host: `${domain}:${health.address().port}` }, timeout: 2000 }, res => {
          res.resume();
          res.on('end', () => res.statusCode === 204 ? resolve() : reject(new Error(`Probe ${domain}: HTTP ${res.statusCode}\n${logs}`)));
          res.on('error', reject);
        });
        req.on('timeout', () => req.destroy(new Error(`Probe ${domain} timed out`)));
        req.on('error', reject);
      });
    }
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        const data = await get('providers/rules');
        if (Object.values(data.providers).every(p => p.ruleCount > 0)) {
          // Rule counts become visible before Mihomo marks the tunnel Running.
          await request('127.0.0.1');
          ready = true; break;
        }
      } catch { /* server starting */ }
      await pause(50);
    }
    assert.ok(ready, logs);
    async function connect(domain) {
      await request(domain);
      for (let i = 0; i < 100 && !logs.includes(`--> ${domain}:`); i++) await pause(20);
      assert.ok(logs.includes(`--> ${domain}:`), `No routing result for ${domain}\n${logs}`);
    }
    await check({ get, connect, logs: () => logs, ruleDownloads: () => ruleDownloads });
  } finally {
    if (proc && proc.exitCode === null) { proc.kill(); await once(proc, 'exit'); }
    health.closeAllConnections(); await new Promise(resolve => health.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const extraAiNames = ['🇻🇳 越南原生', '🇲🇾Malaysia 01', '🇦🇺Australia 01', '🇮🇩 印度尼西亚', '🇮🇳India 01', '🇫🇷 法国原生', '🇬🇧 英国原生', '🇩🇪 德国原生', '🇪🇸 西班牙原生', '🇳🇱 Netherlands 01', '🇹🇷 土耳其原生', '🇨🇦 加拿大', '🇮🇹Italy 01', '🇺🇦 乌克兰', '🇵🇹 葡萄牙', '🇿🇦 南非', '🇲🇽México 01', '🇧🇷Brazil 01', '🇹🇭Thailand 01', '香港 AI专用'];
const normal = ['美国正常', '美国低倍率 0.5X', '日本原生x15', '韩国 AI专用', '台湾正常', '🇺🇸 Ashland AI', '🇳🇱 Netherlands 01', 'LAN', '香港普通', '🇭🇰 下载专用01x3', '🇺🇸 下载专用USx3', '🇯🇵 下载专用03x3', '🇭🇰 下载专用04x3', '美国 3X', '美国x30', '美国13x', '🇺🇸United States 01', '🇨🇳Taiwan 01', '🇸🇬Singapore 01', '🇯🇵Japan 01', '🇺🇸 美国A1|国际优化', '🇰🇷 韩国原生', '剩余流量：1000 GB', '距离下次重置剩余：30 天', '套餐到期：2026-12-04', '官网：极速云导航.com'];
normal.push(...extraAiNames.filter(n => !normal.includes(n)), '俄罗斯普通', '未知地区普通');
for (const name of fs.readdirSync('config').filter(n => n.endsWith('.yaml'))) {
  test(`${name}: core routing and subscription name filters`, { skip: !enabled, timeout: 30000 }, async () => {
    await runConfig(name, normal, async ({ get, connect, logs }) => {
      const groups = (await get('proxies')).proxies;
      const ai = groups['🧠 AI 专用节点'].all;
      assert.ok(ai.some(n => n.includes('Ashland')));
      assert.ok(ai.some(n => n.includes('台湾')));
      for (const name of ['🇺🇸United States 01', '🇨🇳Taiwan 01', '🇸🇬Singapore 01', '🇯🇵Japan 01', '🇺🇸 美国A1|国际优化']) {
        assert.ok(ai.includes('[天照]' + name), name);
      }
      assert.ok(!groups['👆 手动选择'].all.some(n => /剩余|到期|官网/.test(n)));
      assert.ok(ai.some(n => n.includes('韩国原生')));
      assert.ok(ai.some(n => n.includes('日本原生x15')));
      assert.ok(ai.some(n => n.includes('韩国 AI专用')));
      assert.ok(!ai.some(n => /香港普通|俄罗斯普通|未知地区普通/.test(n)));
      for (const name of extraAiNames) assert.ok(ai.includes('[天照]' + name), name);
      assert.ok(groups['👆 手动选择'].all.some(n => n.includes('Netherlands')));
      assert.ok(!groups['👆 手动选择'].all.some(n => n.endsWith(']LAN')));
      assert.ok(!groups['♻️ 智能选择'].all.some(n => /x15/.test(n)));
      assert.ok(!Object.keys(groups).some(n => /^(📦 CDN|♻️).*低倍率/.test(n)));
      for (const name of ['[天照]美国低倍率 0.5X', '[月读]美国 3X']) {
        if (groups['👆 手动选择'].all.includes(name)) assert.ok(groups['♻️ 智能选择'].all.includes(name));
      }

      for (const domain of ['chatgpt.com','api.anthropic.com','gemini.google.com','apple-relay.apple.com','apple-relay.cloudflare.com','push.apple.com','dl.steam.clngaa.com','steamchina.com','cn.apple.com','gs-loc-cn.apple.com']) await connect(domain);
      const output = logs();
      // Preserve the upstream Apple Service -> Apple CN order; routing is a policy choice.
      assert.ok(output.split('\n').some(l => l.includes('--> cn.apple.com:') && l.includes('🍎 苹果服务')), output);
      assert.ok(output.split('\n').some(l => l.includes('--> gs-loc-cn.apple.com:') && l.includes('DIRECT')), output);
      for (const domain of ['chatgpt.com','api.anthropic.com','gemini.google.com','apple-relay.apple.com','apple-relay.cloudflare.com']) assert.ok(output.split('\n').some(l => l.includes(`--> ${domain}:`) && l.includes('🤖 AI 平台')), domain + '\n' + output);
      for (const domain of ['push.apple.com','dl.steam.clngaa.com','steamchina.com']) assert.ok(output.split('\n').some(l => l.includes(`--> ${domain}:`) && l.includes('DIRECT')), domain + '\n' + output);
    });
  });
}

test('mini without eligible AI nodes rejects instead of selecting COMPATIBLE', { skip: !enabled, timeout: 30000 }, async () => {
  await runConfig('baiye-multiple-lite.yaml', ['香港普通'], async ({ get }) => {
    const p=(await get('proxies')).proxies;
    assert.deepEqual(p['🧠 AI 专用节点'].all, ['REJECT']);
    assert.equal(p['🇯🇵 - 择优节点'].now, 'REJECT');
  }, true);
});


test('cold start downloads all HTTP rule sets through payload nodes when both subscriptions return 503', { skip: !enabled, timeout: 30000 }, async () => {
  await runConfig('baiye-multiple.yaml', ['美国启动节点'], async ({ get, connect, logs, ruleDownloads }) => {
    const p = (await get('proxies')).proxies;
    assert.ok(p['🧠 AI 专用节点'].all.some(n => n.startsWith('[天照]')));
    assert.ok(p['🧠 AI 专用节点'].all.some(n => n.startsWith('[月读]')));
    const rules = (await get('providers/rules')).providers;
    assert.equal(ruleDownloads(), Object.keys(rules).length);
    assert.ok(Object.values(rules).every(r => r.ruleCount > 0));
    await connect('chatgpt.com');
    assert.ok(logs().split('\n').some(l => l.includes('--> chatgpt.com:') && l.includes('🤖 AI 平台')));
  }, false, true);
});
