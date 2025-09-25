// 环境变量：SUB_URL_1, GIST_TOKEN, GIST_ID, CONFIG_PATH, COMMIT_SHORT, GIST_FILE_SINGLE

const fs = require('fs');
const https = require('https');
const path = require('path');

const short = (process.env.COMMIT_SHORT || 'dev').slice(0, 7);
const gistFileSingle = process.env.GIST_FILE_SINGLE || 'baiye-single.yaml';

function patchGist({ gistId, token, filename, content }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ files: { [filename]: { content } } });
    const req = https.request(
      `https://api.github.com/gists/${gistId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `token ${token}`,
          'User-Agent': 'github-actions',
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(data)); } catch { resolve({}); }
          } else {
            reject(new Error(`Gist update failed ${res.statusCode}: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function bumpIconsV(s) {
  const re = /(https?:\/\/[^\s"'<>]+\/icons\/[^\s"'<>]+\.(?:png|jpe?g|webp|svg)(?:\?[^\s"'<>]*)?)/gi;
  return s.replace(re, (full) => {
    try {
      const u = new URL(full);
      u.searchParams.set('v', short);
      return u.toString();
    } catch {
      return full;
    }
  });
}

(async () => {
  const sub1 = process.env.SUB_URL_1;
  const token = process.env.GIST_TOKEN;
  const gistId = process.env.GIST_ID;

  if (!sub1) throw new Error('Missing SUB_URL_1');
  if (!token || !gistId) throw new Error('Missing GIST_TOKEN or GIST_ID');

  const srcRel = process.env.CONFIG_PATH || 'config/baiye-single.yaml';
  const srcPath = path.resolve(srcRel);
  if (!fs.existsSync(srcPath)) throw new Error(`${srcRel} not found`);

  const raw = fs.readFileSync(srcPath, 'utf8');

  // 加 icon v=short；替换订阅1
  const withIconV = bumpIconsV(raw);
  const outSingle = withIconV.replace(/替换订阅链接1/g, sub1);

  const genSingle = (gistFileSingle.replace(/\.ya?ml$/, '') + '.generated.yaml');
  fs.writeFileSync(genSingle, outSingle, 'utf8');

  const r = await patchGist({ gistId, token, filename: gistFileSingle, content: outSingle });
  console.log('✅ single →', r?.files?.[gistFileSingle]?.raw_url);
  console.log(`::notice title=Gist Updated (single)::${r?.files?.[gistFileSingle]?.raw_url}`);
})().catch((err) => {
  console.error('❌', err.message || err);
  process.exit(1);
});
