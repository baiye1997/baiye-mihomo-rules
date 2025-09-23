// 环境变量：SUB_URL_1, SUB_URL_2, GIST_TOKEN, GIST_ID,
//          CONFIG_PATH, COMMIT_SHORT, GIST_FILE_MULTIPLE, GIST_FILE_MINI

const fs = require('fs');
const https = require('https');
const path = require('path');

const short = (process.env.COMMIT_SHORT || 'dev').slice(0, 7);
const gistFileMultiple = process.env.GIST_FILE_MULTIPLE || 'baiye-multiple.yaml';
const gistFileMini = process.env.GIST_FILE_MINI || 'BaiyeMini.yaml';

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
  // 覆盖/追加 v=short，保留其它 query
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
  const sub2 = process.env.SUB_URL_2;
  const gistToken = process.env.GIST_TOKEN;
  const gistId = process.env.GIST_ID;

  if (!sub1 || !sub2) throw new Error('Missing SUB_URL_1 or SUB_URL_2');
  if (!gistToken || !gistId) throw new Error('Missing GIST_TOKEN or GIST_ID');

  const srcRel = process.env.CONFIG_PATH || 'config/baiye-multiple.yaml';
  const srcPath = path.resolve(srcRel);
  if (!fs.existsSync(srcPath)) throw new Error(`${srcRel} not found`);

  const raw = fs.readFileSync(srcPath, 'utf8');

  // 1) multiple：加 icon 短哈希 + 填充两个订阅 + 可选显示名替换（保留为你的习惯）
  const withIconV = bumpIconsV(raw);
  const outMultiple = withIconV
    .replace(/替换订阅链接1/g, sub1)
    .replace(/替换订阅链接2/g, sub2)
    .replace(/\[显示名称A可修改\]/g, '[Haita]')
    .replace(/\[显示名称B可修改\]/g, '[BoostNet]');

  fs.writeFileSync('baiye-multiple.generated.yaml', outMultiple, 'utf8');
  const res1 = await patchGist({
    gistId, token: gistToken, filename: gistFileMultiple, content: outMultiple
  });
  console.log('✅ multiple updated:', res1?.files?.[gistFileMultiple]?.raw_url);

  // 2) mini：在 multiple 的基础上改 geodata-loader
  const outMini = outMultiple.replace(/geodata-loader:\s*standard/g, 'geodata-loader: memconservative');
  fs.writeFileSync('BaiyeMini.generated.yaml', outMini, 'utf8');
  const res2 = await patchGist({
    gistId, token: gistToken, filename: gistFileMini, content: outMini
  });
  console.log('✅ mini updated:', res2?.files?.[gistFileMini]?.raw_url);

  console.log(`::notice title=Gist Updated::${res1?.files?.[gistFileMultiple]?.raw_url}\n${res2?.files?.[gistFileMini]?.raw_url}`);
})().catch((err) => {
  console.error('❌', err.message || err);
  process.exit(1);
});
