const fs = require('fs');
const https = require('https');
const path = require('path');

const short = (process.env.COMMIT_SHORT || 'dev').slice(0, 7);

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

(async () => {
  const sub1 = process.env.SUB_URL_1;
  const gistToken = process.env.GIST_TOKEN;
  const gistId = process.env.GIST_ID;
  const gistFile = process.env.GIST_FILE_NAME || 'baiye-single.yaml';

  if (!sub1) throw new Error('Missing SUB_URL_1');
  if (!gistToken || !gistId) throw new Error('Missing GIST_TOKEN or GIST_ID');

  const srcRel = process.env.CONFIG_PATH || 'baiye-single.yaml';
  const srcPath = path.resolve(srcRel);
  if (!fs.existsSync(srcPath)) throw new Error(`${srcRel} not found`);

  const raw = fs.readFileSync(srcPath, 'utf8');

  // 给 icons 链接加短哈希
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

  const withIconV = bumpIconsV(raw);
  const out = withIconV.replace(/替换订阅链接1/g, sub1);

  fs.writeFileSync('baiye-single.generated.yaml', out, 'utf8');

  const res = await patchGist({ gistId, token: gistToken, filename: gistFile, content: out });

  const file = res?.files?.[gistFile];
  const rawUrl = file?.raw_url || '(no raw_url returned)';
  console.log('✅ Gist updated. Raw URL:', rawUrl);
  console.log(`::notice title=Gist Raw URL::${rawUrl}`);
})().catch((err) => {
  console.error('❌', err.message || err);
  process.exit(1);
});
