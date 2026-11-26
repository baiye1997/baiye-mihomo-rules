"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { applySubscriptions, extractServerDomainFilters, deriveMini, parseStaticProxy } = require('../.github/scripts/build-and-publish');
const { validateConfig, validateWithCore } = require('../.github/scripts/validate-config');
const urls = ['https://example.invalid/one?token=a$&b', 'https://example.invalid/two'];
const names = ['[天照]', '[月读]'];
const template = fs.readFileSync('config/baiye-multiple.yaml', 'utf8');
const singleTemplate = fs.readFileSync('config/baiye-single.yaml', 'utf8');

test('subscription slots cannot shift when a URL is absent', () => {
  assert.throws(() => applySubscriptions(template, [], ['', urls[1]], names), /订阅 1/);
  assert.throws(() => applySubscriptions(template, [], [urls[0], ''], names), /订阅 2/);
  const c = validateConfig(applySubscriptions(template, [], urls, names));
  assert.equal(c['proxy-providers']['Sub-1'].url, urls[0]);
  assert.equal(c['proxy-providers']['Sub-2'].override['additional-prefix'], '[月读]');
});

test('invalid YAML and broken strategy references fail before publication', () => {
  assert.throws(() => applySubscriptions('proxy-groups: [invalid', [], urls, names), /YAML/);
  const c = validateConfig(applySubscriptions(template, [], urls, names));
  c['proxy-groups'][0].proxies.push('nonexistent');
  assert.throws(() => validateConfig(YAML.stringify(c)), /引用不存在/);
});

test('both YAML styles produce exact hosts without broad shared-domain exceptions', () => {
  const block = 'proxies:\n  - name: test\n    server: node.workers.dev\n  - name: ip\n    server: 1.2.3.4\n';
  assert.deepEqual(extractServerDomainFilters(block), ['node.workers.dev']);
  assert.deepEqual(extractServerDomainFilters('proxies: [{name: test, server: node.workers.dev}]'), ['node.workers.dev']);
  const c = validateConfig(applySubscriptions(template, ['node.workers.dev'], urls, names));
  assert.ok(c.dns['fake-ip-filter'].includes('node.workers.dev'));
  assert.ok(!c.dns['fake-ip-filter'].includes('+.workers.dev'));
});

test('published providers keep their URLs and prefixes with independent startup snapshots', () => {
  const snapshots = [
    [{ name: '美国启动', type: 'socks5', server: '127.0.0.1', port: 9 }],
    [{ name: '日本启动', type: 'socks5', server: '127.0.0.1', port: 10 }],
  ];
  for (const name of fs.readdirSync('config').filter(n => n.endsWith('.yaml'))) {
    const text = applySubscriptions(fs.readFileSync(path.join('config', name), 'utf8'), [], urls, names, snapshots);
    const c = validateConfig(text);
    Object.values(c['proxy-providers']).forEach((p, index) => {
      assert.deepEqual(p.payload, snapshots[index]);
      assert.equal(p.url, urls[index]);
      assert.equal(p.proxy, '📥 资源下载');
      if (name.includes('multiple')) {
        assert.equal(p.override['additional-prefix'], names[index]);
      } else {
        assert.equal(p.override?.['additional-prefix'], undefined);
      }
    });
    if (process.env.MIHOMO_BIN) validateWithCore(text, name);
  }
  assert.throws(() => applySubscriptions(template, [], urls, names, [snapshots[0], []]), /订阅 2 缺少启动/);
});

test('VLESS null flow is omitted without changing valid flow or the source snapshot', () => {
  const proxies = [
    { name: '日本 WS', type: 'vless', server: '127.0.0.1', port: 443, uuid: '00000000-0000-4000-8000-000000000001', network: 'ws', flow: null },
    { name: '美国 Vision', type: 'vless', server: '127.0.0.1', port: 443, uuid: '00000000-0000-4000-8000-000000000002', tls: true, flow: 'xtls-rprx-vision' },
  ];
  const output = applySubscriptions(template, [], urls, names, [proxies, proxies]);
  const c = validateConfig(output);
  for (const provider of Object.values(c['proxy-providers'])) {
    assert.ok(!Object.hasOwn(provider.payload[0], 'flow'));
    assert.deepEqual(provider.payload[1], proxies[1]);
    const { flow, ...expected } = proxies[0];
    assert.deepEqual(provider.payload[0], expected);
  }
  assert.equal(proxies[0].flow, null);
  if (process.env.MIHOMO_BIN) validateWithCore(output, 'VLESS null flow');
});

test('subscription node DNS is merged with default public DNS per slot and rejects proxy-pinned entries', () => {
  const dnsBySlot = [
    ['https://airport1.example/dns-query/token', 'https://bad.example/dns-query#Proxy'],
    ['https://airport2.example/dns-query/token'],
  ];
  const multi = validateConfig(applySubscriptions(template, [], urls, names, [
    [{ name: 'A', type: 'socks5', server: '127.0.0.1', port: 9 }],
    [{ name: 'B', type: 'socks5', server: '127.0.0.1', port: 10 }],
  ], dnsBySlot));
  assert.deepEqual(multi.dns['proxy-server-nameserver'], [
    '223.5.5.5',
    '119.29.29.29',
    'https://airport1.example/dns-query/token',
    'https://airport2.example/dns-query/token',
  ]);

  const single = validateConfig(applySubscriptions(singleTemplate, [], [urls[0]], ['[月读]'], [
    [{ name: 'A', type: 'socks5', server: '127.0.0.1', port: 9 }],
  ], dnsBySlot));
  assert.deepEqual(single.dns['proxy-server-nameserver'], [
    '223.5.5.5',
    '119.29.29.29',
    'https://airport1.example/dns-query/token',
  ]);
});

test('AI_STATIC_PROXY injects relayed dedicated node into AI groups without leaking credentials on error', () => {
  const staticUrl = 'socks5://demoUser:superSecret123@198.51.100.10:50101';
  const output = applySubscriptions(singleTemplate, [], [urls[0]], ['[月读]'], [
    [{ name: '日本01', type: 'socks5', server: '127.0.0.1', port: 9 }],
  ], undefined, staticUrl);
  const c = validateConfig(output);
  const node = c.proxies.find(p => p.name === '🇺🇸 专属静态住宅 AI');
  assert.deepEqual(node, {
    name: '🇺🇸 专属静态住宅 AI',
    type: 'socks5',
    server: '198.51.100.10',
    port: 50101,
    username: 'demoUser',
    password: 'superSecret123',
    udp: true,
    'dialer-proxy': '🔗 AI 接力中转',
  });
  const aiAuto = c['proxy-groups'].find(g => g.name === '🛡️ AI 自动优选');
  const aiPlatform = c['proxy-groups'].find(g => g.name === '🤖 AI 平台');
  const googleGroup = c['proxy-groups'].find(g => g.name === '🔍 谷歌服务');
  const relay = c['proxy-groups'].find(g => g.name === '🔗 AI 接力中转');
  assert.equal(aiAuto.proxies[0], '🇺🇸 专属静态住宅 AI');
  assert.equal(aiAuto.timeout, 5000);
  assert.equal(aiAuto['max-failed-times'], 3);
  assert.equal(aiAuto['expected-status'], 204);
  assert.deepEqual(aiPlatform.proxies.slice(0, 2), ['🛡️ AI 自动优选', '🇺🇸 专属静态住宅 AI']);
  assert.deepEqual(googleGroup.proxies.slice(0, 2), ['🛡️ AI 自动优选', '🇺🇸 专属静态住宅 AI']);
  assert.deepEqual(relay.proxies, ['🇯🇵 - 择优节点', '🇺🇸 - 择优节点', '🇭🇰 - 择优节点']);
  assert.equal(relay.timeout, 5000);
  assert.equal(relay['max-failed-times'], 3);
  assert.equal(relay['expected-status'], 204);
  if (process.env.MIHOMO_BIN) validateWithCore(output, 'AI_STATIC_PROXY');

  assert.throws(() => parseStaticProxy('not-a-url-secretTokenXYZ'), err => {
    assert.ok(!err.message.includes('secretTokenXYZ'));
    return true;
  });
});

test('rule download URLs and outbound references are validated before isolation', () => {
  const c = validateConfig(applySubscriptions(template, [], urls, names));
  const p = c['rule-providers'].ai_non_ip;
  const original = p.url;
  p.url = 'not-a-url';
  assert.throws(() => validateConfig(YAML.stringify(c)), /Provider URL/);
  p.url = original;
  p.proxy = 'nonexistent';
  assert.throws(() => validateConfig(YAML.stringify(c)), /Provider 代理引用不存在/);
});

test('publication requires a destination for each generated family before network access', () => {
  const { spawnSync } = require('node:child_process');
  for (const family of ['STANDARD', 'LITE']) {
    const env = { ...process.env, DRY_RUN: 'false', GIST_TOKEN: 'test-only', STATUS_FILE: '',
      CONFIG_MULTIPLE_STD: '', CONFIG_SINGLE_STD: '', CONFIG_MULTIPLE_LITE: '', CONFIG_SINGLE_LITE: '',
      GIST_ID_STANDARD: '', GIST_ID_LITE: '' };
    env[family === 'STANDARD' ? 'CONFIG_SINGLE_STD' : 'CONFIG_SINGLE_LITE'] = 'config/baiye-single.yaml';
    const result = spawnSync(process.execPath, ['.github/scripts/build-and-publish.js'], { env, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(`Missing GIST_ID_${family}`));
  }
});

test('failed snapshot download stops publication without exposing the subscription URL', async () => {
  const http = require('node:http');
  const { once } = require('node:events');
  const { promisify } = require('node:util');
  const execFile = promisify(require('node:child_process').execFile);
  const agents = [];
  const server = http.createServer((req, res) => {
    agents.push(req.headers['user-agent']);
    if (req.url === '/secret-subscription-token/http') {
      res.writeHead(302, { Location: '/redirected-subscription' });
    } else if (req.url === '/secret-subscription-token/parse') {
      res.end('proxies: [secret-subscription-token'); return;
    } else if (req.url === '/secret-subscription-token/validate') {
      res.end('proxies: []'); return;
    } else if (req.url === '/secret-subscription-token/reset') {
      req.socket.destroy(); return;
    } else res.writeHead(503);
    res.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const env = { ...process.env, DRY_RUN: 'false', GIST_TOKEN: 'test-only', GIST_ID_STANDARD: 'test-only', STATUS_FILE: '',
      CONFIG_MULTIPLE_STD: '', CONFIG_SINGLE_STD: 'config/baiye-single.yaml', CONFIG_MULTIPLE_LITE: '', CONFIG_SINGLE_LITE: '',
      SUB_URLS: `http://127.0.0.1:${server.address().port}/secret-subscription-token` };
    for (const [mode, diagnostic] of [
      ['http', 'stage=download, code=HTTP_503'],
      ['parse', 'stage=parse, code=UNKNOWN'],
      ['validate', 'stage=validate, code=UNKNOWN'],
      ['reset', 'stage=download, code=ECONNRESET'],
    ]) {
      await assert.rejects(execFile(process.execPath, ['.github/scripts/build-and-publish.js'], { env: { ...env, SUB_URLS: env.SUB_URLS + '/' + mode }, timeout: 5000 }), error => {
        assert.equal(error.code, 1);
        assert.ok(error.stderr.includes(diagnostic), error.stderr);
        assert.ok(!error.stderr.includes('secret-subscription-token'));
        assert.ok(!error.stderr.includes('redirected-subscription'));
        assert.ok(!error.stderr.includes('127.0.0.1'));
        return true;
      });
    }
    assert.deepEqual(agents, Array(5).fill('clash.meta'));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

for (const name of fs.readdirSync('config').filter(n => n.endsWith('.yaml'))) {
  test(`${name}: generated config and mini preserve policy, DNS hygiene, and pass core validation`, () => {
    const output = applySubscriptions(fs.readFileSync(path.join('config', name), 'utf8'), [], urls, names);
    const c = validateConfig(output);
    if (name.includes('multiple')) {
      assert.equal(Object.values(c['proxy-providers'])[0].override['additional-prefix'], '[天照]');
    } else {
      assert.equal(Object.values(c['proxy-providers'])[0].override?.['additional-prefix'], undefined);
    }
    for (const removed of ['neteasemusic_non_ip', 'neteasemusic_ip', 'lan_ip', 'domestic_ip', 'speedtest', 'download_domainset', 'download_non_ip', 'apple_intelligence']) {
      assert.equal(c['rule-providers'][removed], undefined);
    }
    assert.ok(c.rules.includes('DOMAIN-SUFFIX,push.apple.com,DIRECT'));
    assert.ok(c.rules.includes('DOMAIN,dl.wechat.com,DIRECT'));
    assert.ok(c.rules.includes('DOMAIN,mirrors.aliyun.com,DIRECT'));
    assert.ok(c.rules.includes('DOMAIN-SUFFIX,steamcontent.com,DIRECT'));
    assert.ok(c.rules.includes('DOMAIN-SUFFIX,bytedapm.com,DIRECT'));
    assert.ok(c.rules.includes('DOMAIN,cdnstatic.tencentcs.com,DIRECT'));
    assert.ok(c.rules.includes('DOMAIN,translate.googleapis.com,🚀 节点选择'));
    assert.ok(c.rules.includes('DOMAIN,translate.google.com,🚀 节点选择'));
    assert.ok(c.rules.includes('DOMAIN,translate.google.cn,🚀 节点选择'));
    assert.ok(c.rules.includes('DOMAIN,api.github.com,🚀 节点选择'));
    assert.ok(c.rules.includes('DOMAIN-SUFFIX,cursor.com,🤖 AI 平台'));
    assert.ok(c.rules.includes('DOMAIN-SUFFIX,claudeusercontent.com,🤖 AI 平台'));
    assert.ok(c.rules.includes('GEOIP,private,DIRECT'));
    assert.ok(c.rules.includes('GEOIP,cn,DIRECT'));
    assert.ok(!c.rules.includes('GEOIP,cn,DIRECT,no-resolve'));
    assert.ok(c.rules.findIndex(r => r.startsWith('GEOSITE,category-games@cn,')) < c.rules.indexOf('RULE-SET,game_non_ip,🎮 游戏平台'));
    assert.ok(Array.isArray(c.dns['direct-nameserver']) && c.dns['direct-nameserver'].length >= 2);
    assert.ok(c.dns['nameserver-policy']?.['geosite:private,cn']);
    assert.ok(c.dns['nameserver-policy']?.['geosite:gfw']);
    assert.ok(c.dns['fallback-filter']?.ipcidr?.includes('127.0.0.0/8'));
    assert.equal(c.sniffer.sniff.QUIC, undefined);
    assert.equal(c.tun['endpoint-independent-nat'], true);
    assert.equal(c['proxy-groups'].find(g => g.name === '🤖 AI 平台').proxies[0], '🛡️ AI 自动优选');
    assert.equal(c['proxy-groups'].find(g => g.name === '🔍 谷歌服务').proxies[0], '🛡️ AI 自动优选');
    assert.ok(c.rules.indexOf('GEOSITE,google-cn,🌐 全球直连') < c.rules.indexOf('GEOSITE,google,🔍 谷歌服务'));
    assert.equal(c['proxy-groups'].find(g => g.name === '🍎 苹果服务').proxies[0], 'DIRECT');
    assert.equal(c['proxy-groups'].find(g => g.name === 'Ⓜ️ 微软服务').proxies[0], 'DIRECT');
    const smartGroup = c['proxy-groups'].find(g => g.name === '♻️ 智能选择');
    const manualGroup = c['proxy-groups'].find(g => g.name === '👆 手动选择');
    const aiAutoGroup = c['proxy-groups'].find(g => g.name === '🛡️ AI 自动优选');
    assert.equal(smartGroup.timeout, 3000);
    assert.equal(smartGroup['expected-status'], 204);
    assert.equal(smartGroup.proxies, undefined);
    assert.equal(smartGroup['empty-fallback'], 'REJECT');
    assert.equal(aiAutoGroup.timeout, 5000);
    assert.equal(aiAutoGroup['max-failed-times'], 3);
    assert.equal(aiAutoGroup['expected-status'], 204);
    assert.equal(aiAutoGroup.hidden, true);
    assert.ok(c['proxy-groups'].some(g => g.name === '🧠 AI 手动节点'));
    assert.notEqual(manualGroup.url, smartGroup.url);
    assert.equal(manualGroup.url, 'https://www.gstatic.com/generate_204?ui=1');
    for (const provider of Object.values(c['proxy-providers'])) {
      assert.equal(provider['health-check'].interval, 600);
      assert.equal(provider['health-check'].timeout, 3000);
      assert.equal(provider['health-check'].lazy, true);
      assert.equal(provider['health-check']['expected-status'], 204);
    }
    assert.ok(!c['proxy-groups'].some(g => g.name === '☁️ OneDrive' || g.name === '🎵 Spotify'));
    for (const g of c['proxy-groups'].filter(g => g['include-all-providers'] && !g.proxies?.length)) assert.equal(g['empty-fallback'], 'REJECT');
    assert.ok(!c['proxy-groups'].some(g => g.name.includes('低倍率')));
    for (const key of ['cdn_domainset', 'cdn_non_ip']) {
      if (c['rule-providers'][key]) assert.ok(c.rules.includes(`RULE-SET,${key},🚀 节点选择`));
    }
    if (process.env.MIHOMO_BIN) validateWithCore(output, name);
    if (name.includes('single')) {
      const mini = deriveMini(output);
      const m = validateConfig(mini);
      assert.equal(m.sniffer.enable, false);
      assert.equal(m['geodata-loader'], 'memconservative');
      assert.deepEqual(m.rules, c.rules);
      if (process.env.MIHOMO_BIN) validateWithCore(mini, name.replace('single', 'mini'));
    }
  });
}

test('publisher dry-run validates single-subscription outputs without second subscription or token', { skip: !process.env.MIHOMO_BIN }, () => {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env, DRY_RUN: 'true', QUIET: 'false', SUB_URLS: urls[0], SUB_NAMES: '[月读]', STATUS_FILE: '',
    CONFIG_MULTIPLE_STD: '', CONFIG_MULTIPLE_LITE: '',
    CONFIG_SINGLE_STD: 'config/baiye-single.yaml', GIST_FILE_SINGLE_STD: 'baiye-single.yaml', GIST_FILE_MINI_STD: 'baiye-mini.yaml',
    CONFIG_SINGLE_LITE: 'config/baiye-single-lite.yaml', GIST_FILE_SINGLE_LITE: 'baiye-single-lite.yaml', GIST_FILE_MINI_LITE: 'baiye-mini-lite.yaml',
    AI_STATIC_PROXY: 'socks5://user:pass@198.51.100.10:50101',
  };
  delete env.GIST_TOKEN;
  delete env.SUB_SERVER_DOMAINS;
  const result = spawnSync(process.execPath, ['.github/scripts/build-and-publish.js'], { env, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Standard Gist 文件数: 2, Lite\/GEO Gist 文件数: 2/);
  assert.match(result.stdout, /DRY RUN/);
  const missing = spawnSync(process.execPath, ['.github/scripts/build-and-publish.js'], { env: { ...env, SUB_URLS: '' }, encoding: 'utf8', timeout: 5000 });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /订阅 1 缺失/);
});
