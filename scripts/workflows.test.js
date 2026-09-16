"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const purge = YAML.parse(fs.readFileSync('.github/workflows/purge-cdn.yml', 'utf8'));

test('empty successful download fails sync and preserves the existing destination', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-sync-check-'));
  try {
    for (const sub of ['scripts','rules/.source','rules/non_ip','bin']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
    fs.copyFileSync('scripts/update_rules.sh', path.join(dir, 'scripts/update_rules.sh'));
    fs.writeFileSync(path.join(dir, 'rules/.source/rules_sources.txt'), 'https://example.invalid/empty rules/non_ip/a.txt\n');
    fs.writeFileSync(path.join(dir, 'rules/non_ip/a.txt'), 'DOMAIN,example.com\n');
    fs.writeFileSync(path.join(dir, 'bin/curl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const result = spawnSync('bash', ['scripts/update_rules.sh'], { cwd: dir, env: { ...process.env, PATH: path.join(dir, 'bin') + path.delimiter + process.env.PATH }, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(fs.readFileSync(path.join(dir,'rules/non_ip/a.txt'),'utf8'), 'DOMAIN,example.com\n');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CDN detection includes every commit in a push and propagates purge failures', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-purge-check-'));
  try {
    for (const sub of ['config','rules/non_ip','bin']) fs.mkdirSync(path.join(dir,sub), { recursive: true });
    function git(...args) {
      const r = spawnSync('git', ['-c','user.name=Test','-c','user.email=test@example.invalid',...args], { cwd: dir, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
    }
    git('init','-q');
    fs.writeFileSync(path.join(dir,'config/a.yaml'), 'rules/non_ip/a.txt\nrules/non_ip/b.txt\n');
    git('add','.'); git('commit','-qm','baseline'); const before = git('rev-parse','HEAD');
    for (const name of ['a','b']) {
      fs.writeFileSync(path.join(dir,`rules/non_ip/${name}.txt`),'DOMAIN,example.com\n');
      git('add','.'); git('commit','-qm',name);
    }
    const env = { ...process.env, BEFORE_SHA: before, FORCE_PURGE: 'false', GITHUB_OUTPUT: path.join(dir,'output'), GITHUB_STEP_SUMMARY: path.join(dir,'summary'), PATH: path.join(dir,'bin') + path.delimiter + process.env.PATH };
    const steps = purge.jobs.release_purge.steps;
    const detect = spawnSync('bash',['-c',steps.find(s => s.id === 'detect').run], { cwd: dir, env, encoding:'utf8', timeout:5000 });
    assert.equal(detect.status,0,detect.stderr);
    assert.deepEqual(fs.readFileSync(path.join(dir,'referenced.targets.txt'),'utf8').trim().split('\n'), ['rules/non_ip/a.txt','rules/non_ip/b.txt']);
    fs.writeFileSync(path.join(dir,'bin/curl'),'#!/bin/sh\nexit 22\n',{mode:0o755});
    const run = steps.find(s => s.name.startsWith('Purge jsDelivr')).run.replace('${{ github.repository }}','test/repo');
    const result = spawnSync('bash',['-c',run], { cwd: dir, env, encoding:'utf8', timeout:5000 });
    assert.notEqual(result.status,0,result.stdout);
  } finally { fs.rmSync(dir, { recursive:true, force:true }); }
});
