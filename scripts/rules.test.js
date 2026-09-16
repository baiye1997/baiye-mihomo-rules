"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const YAML = require('yaml');
const { validateWithCore } = require('../.github/scripts/validate-config');
const { applySubscriptions } = require('../.github/scripts/build-and-publish');

const lines = text => text.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
function entries(file, text = fs.readFileSync(file, 'utf8')) {
  const rules = file.endsWith('.yaml') ? YAML.parse(text)?.payload : lines(text);
  assert.ok(Array.isArray(rules) && rules.length > 0, `${file}: empty/missing payload`);
  for (const rule of rules) {
    assert.equal(typeof rule, 'string', file);
    if (file.includes('/domainset/')) {
      assert.match(rule, /^(?:\+\.)?[A-Za-z0-9_*?\-]+(?:\.[A-Za-z0-9_*?\-]+)*\.?$/, `${file}: ${rule}`);
      continue;
    }
    const [kind, value, option, ...extra] = rule.split(',');
    assert.ok(value && extra.length === 0, `${file}: ${rule}`);
    if (kind === 'IP-CIDR' || kind === 'IP-CIDR6') {
      const [ip, prefix, ...rest] = value.split('/');
      const version = kind === 'IP-CIDR' ? 4 : 6;
      assert.ok(net.isIP(ip) === version && /^\d+$/.test(prefix) && Number(prefix) <= (version === 4 ? 32 : 128) && rest.length === 0, `${file}: ${rule}`);
      assert.ok(option === undefined || option === 'no-resolve', `${file}: ${rule}`);
    } else {
      // Reject new upstream formats until their parser and routing intent are reviewed.
      assert.ok(['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN-WILDCARD', 'PROCESS-NAME'].includes(kind), `${file}: unsupported ${kind}`);
      assert.equal(option, undefined, `${file}: unexpected outbound/option`);
      if (kind !== 'PROCESS-NAME') assert.match(value, /^[A-Za-z0-9_*?.\-]+$/, `${file}: ${rule}`);
    }
  }
  return rules;
}

test('all rule files have valid content, complete sources and exact game split', () => {
  const files = ['ip', 'non_ip', 'domainset', 'yaml'].flatMap(dir => fs.readdirSync(`rules/${dir}`).map(name => `rules/${dir}/${name}`));
  const sourceRows = lines(fs.readFileSync('rules/.source/rules_sources.txt', 'utf8'));
  const destinations = sourceRows.map(row => {
    const [url, dest, ...extra] = row.split(/\s+/);
    assert.equal(extra.length, 0);
    assert.equal(new URL(url).protocol, 'https:');
    assert.ok(files.includes(dest), dest);
    return dest;
  });
  assert.equal(new Set(destinations).size, destinations.length);
  const local = ['rules/domainset/fake-ip.list','rules/domainset/sniff-skip.list','rules/non_ip/game.txt','rules/ip/game.txt'];
  assert.deepEqual([...destinations, ...local].sort(), files.sort());
  for (const file of files) entries(file);
  const game = entries('rules/yaml/Game.yaml');
  assert.deepEqual(game.filter(r => r.startsWith('DOMAIN')), entries('rules/non_ip/game.txt'));
  assert.deepEqual(game.filter(r => r.startsWith('IP-CIDR')), entries('rules/ip/game.txt'));
});

test('download validation rejects HTML, empty content, malformed CIDRs and hidden outbound fields', () => {
  for (const [file, text] of [
    ['rules/domainset/a.txt', '<html>Service unavailable</html>'],
    ['rules/non_ip/a.txt', '# empty'],
    ['rules/ip/a.txt', 'IP-CIDR,999.1.2.3/24'],
    ['rules/ip/a.txt', 'IP-CIDR6,::1/129'],
    ['rules/non_ip/a.txt', 'DOMAIN,example.com,DIRECT'],
    ['rules/yaml/Game.yaml', 'error: rate limit'],
  ]) assert.throws(() => entries(file, text));
});

test('Mihomo parses every classical rule as a top-level rule without silently dropping provider lines', { skip: !process.env.MIHOMO_BIN }, () => {
  const c = YAML.parse(applySubscriptions(fs.readFileSync('config/baiye-single.yaml','utf8'), [], ['https://example.invalid/one'], ['[天照]']), { merge: true, maxAliasCount: 10000 });
  c.rules = ['ip','non_ip'].flatMap(dir => fs.readdirSync(`rules/${dir}`).flatMap(name => entries(`rules/${dir}/${name}`).map(rule => {
    const parts = rule.split(',');
    parts.splice(2, 0, 'DIRECT');
    return parts.join(',');
  })));
  c.rules.push('MATCH,DIRECT');
  validateWithCore(YAML.stringify(c), 'all classical rules');
});
