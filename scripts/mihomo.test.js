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

const normal = ['美国正常', '美国低倍率 0.5X', '日本原生x15', '韩国 AI专用', '台湾正常', '🇺🇸 Ashland AI', '🇳🇱 Netherlands 01', 'LAN', '香港普通'];
for (const name of fs.readdirSync('config').filter(n => n.endsWith('.yaml'))) {
  test(`${name}: core routing, name filters and low-rate preference`, { skip: !enabled, timeout: 30000 }, async () => {
    await runConfig(name, normal, async ({ get, connect, logs }) => {
      const groups = (await get('proxies')).proxies;
      const ai = groups['🧠 AI 专用节点'].all;
      assert.ok(ai.some(n => n.includes('Ashland')));
      assert.ok(ai.some(n => n.includes('台湾')));
      assert.ok(ai.some(n => n.includes('日本原生x15')));
      assert.ok(!ai.some(n => n.includes('韩国') || n.includes('香港普通')));
      assert.ok(groups['👆 手动选择'].all.some(n => n.includes('Netherlands')));
      assert.ok(!groups['👆 手动选择'].all.some(n => n.endsWith(']LAN')));
      assert.ok(!groups['♻️ 智能选择'].all.some(n => /x15|0\.5X/.test(n)));
      if (groups['♻️ 低倍率自动']) assert.equal(groups['♻️ 低倍率自动'].now, '♻️ 低倍率测速');
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

test('no low-rate nodes: CDN automatically uses regular proxy pool', { skip: !enabled, timeout: 30000 }, async () => {
  await runConfig('baiye-single.yaml', ['美国正常','韩国原生x15'], async ({ get }) => {
    let p;
    for (let i=0;i<60;i++) { p=(await get('proxies')).proxies; if(p['♻️ 低倍率自动'].now==='♻️ 智能选择') break; await pause(100); }
    assert.equal(p['♻️ 低倍率测速'].now, 'REJECT');
    assert.equal(p['♻️ 低倍率自动'].now, '♻️ 智能选择');
    assert.equal(p['🇰🇷 - 择优节点'].now, 'REJECT');
  });
});

test('mini without eligible AI nodes rejects instead of selecting COMPATIBLE', { skip: !enabled, timeout: 30000 }, async () => {
  await runConfig('baiye-multiple-lite.yaml', ['香港普通'], async ({ get }) => {
    const p=(await get('proxies')).proxies;
    assert.deepEqual(p['🧠 AI 专用节点'].all, ['REJECT']);
    assert.equal(p['🇯🇵 - 择优节点'].now, 'REJECT');
  }, true);
});


test('unreachable low-rate pool falls back while keeping ordinary nodes available', { skip: !enabled, timeout: 30000 }, async () => {
  await runConfig('baiye-single.yaml', ['美国正常', { name: '美国低倍率 0.5X', type: 'socks5', server: '127.0.0.1', port: 9 }], async ({ get }) => {
    let p;
    for (let i=0;i<60;i++) { p=(await get('proxies')).proxies; if(p['♻️ 低倍率自动'].now==='♻️ 智能选择') break; await pause(100); }
    assert.equal(p['♻️ 低倍率自动'].now, '♻️ 智能选择');
    assert.ok(p['♻️ 智能选择'].now.includes('美国正常'));
  });
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
