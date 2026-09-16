"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { applySubscriptions, extractServerDomainFilters, deriveMini } = require('../.github/scripts/build-and-publish');
const { validateConfig, validateWithCore } = require('../.github/scripts/validate-config');
const urls = ['https://example.invalid/one?token=a$&b', 'https://example.invalid/two'];
const names = ['[天照]', '[月读]'];
const template = fs.readFileSync('config/baiye-multiple.yaml', 'utf8');

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
      assert.equal(p.proxy, '🚀 节点选择');
      assert.equal(p.override['additional-prefix'], names[index]);
    });
    if (process.env.MIHOMO_BIN) validateWithCore(text, name);
  }
  assert.throws(() => applySubscriptions(template, [], urls, names, [snapshots[0], []]), /订阅 2 缺少启动/);
});

test('rule download URLs and outbound references are validated before isolation', () => {
  const c = validateConfig(applySubscriptions(template, [], urls, names));
  const p = c['rule-providers'].apple_intelligence;
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
  const server = http.createServer((req, res) => { res.writeHead(503); res.end(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const env = { ...process.env, DRY_RUN: 'false', GIST_TOKEN: 'test-only', GIST_ID_STANDARD: 'test-only', STATUS_FILE: '',
      CONFIG_MULTIPLE_STD: '', CONFIG_SINGLE_STD: 'config/baiye-single.yaml', CONFIG_MULTIPLE_LITE: '', CONFIG_SINGLE_LITE: '',
      SUB_URLS: `http://127.0.0.1:${server.address().port}/secret-subscription-token` };
    await assert.rejects(execFile(process.execPath, ['.github/scripts/build-and-publish.js'], { env, timeout: 5000 }), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /节点快照获取失败/);
      assert.ok(!error.stderr.includes('secret-subscription-token'));
      return true;
    });
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

for (const name of fs.readdirSync('config').filter(n => n.endsWith('.yaml'))) {
  test(`${name}: generated config and mini preserve policy and pass core validation`, () => {
    const output = applySubscriptions(fs.readFileSync(path.join('config', name), 'utf8'), [], urls, names);
    const c = validateConfig(output);
    assert.equal(Object.values(c['proxy-providers'])[0].override['additional-prefix'], '[天照]');
    assert.ok(c.rules.indexOf('RULE-SET,apple_intelligence,🤖 AI 平台') < c.rules.findIndex(r => r.startsWith('GEOSITE,apple,') || r.startsWith('RULE-SET,apple_services,')));
    assert.ok(c.rules.includes('DOMAIN-SUFFIX,push.apple.com,DIRECT'));
    assert.ok(c.rules.findIndex(r => r.startsWith('GEOSITE,category-games@cn,')) < c.rules.indexOf('RULE-SET,game_non_ip,🎮 游戏平台'));
    for (const g of c['proxy-groups'].filter(g => g['include-all-providers'] && !g.proxies?.length)) assert.equal(g['empty-fallback'], 'REJECT');
    if (process.env.MIHOMO_BIN) validateWithCore(output, name);
    if (name.includes('multiple')) {
      const mini = deriveMini(output);
      const m = validateConfig(mini);
      assert.equal(m.sniffer.enable, false);
      assert.equal(m['geodata-loader'], 'memconservative');
      assert.deepEqual(m.rules, c.rules);
      if (process.env.MIHOMO_BIN) validateWithCore(mini, name.replace('multiple', 'mini'));
    }
  });
}

test('publisher dry-run validates all six outputs without token or subscription network', { skip: !process.env.MIHOMO_BIN }, () => {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env, DRY_RUN: 'true', QUIET: 'false', SUB_URLS: urls.join('\n'), SUB_NAMES: names.join('\n'), STATUS_FILE: '' };
  delete env.GIST_TOKEN;
  delete env.SUB_SERVER_DOMAINS;
  for (const [key, file] of [['MULTIPLE_STD','multiple'],['SINGLE_STD','single'],['MULTIPLE_LITE','multiple-lite'],['SINGLE_LITE','single-lite']]) {
    env[`CONFIG_${key}`] = `config/baiye-${file}.yaml`;
    env[`GIST_FILE_${key}`] = `baiye-${file}.yaml`;
  }
  env.GIST_FILE_MINI_STD = 'baiye-mini.yaml';
  env.GIST_FILE_MINI_LITE = 'baiye-mini-lite.yaml';
  const result = spawnSync(process.execPath, ['.github/scripts/build-and-publish.js'], { env, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Standard Gist 文件数: 3, Lite\/GEO Gist 文件数: 3/);
  assert.match(result.stdout, /DRY RUN/);
  const missing = spawnSync(process.execPath, ['.github/scripts/build-and-publish.js'], { env: { ...env, SUB_URLS: '\n' + urls[1] }, encoding: 'utf8', timeout: 5000 });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /订阅 1 缺失/);
});
