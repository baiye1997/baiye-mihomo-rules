// 环境变量：SUB_URL_1, SUB_URL_2, GIST_TOKEN,
//          GIST_ID (可选, 两文件同Gist时用), GIST_ID_MULTIPLE, GIST_ID_MINI,
//          CONFIG_PATH, COMMIT_SHORT,
//          GIST_FILE_MULTIPLE, GIST_FILE_MINI

const fs = require('fs');
const https = require('https');
const path = require('path');

const short = (process.env.COMMIT_SHORT || 'dev').slice(0, 7);
const gistFileMultiple = process.env.GIST_FILE_MULTIPLE || 'baiye-multiple.yaml';
const gistFileMini = process.env.GIST_FILE_MINI || 'baiye-mini.yaml';

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
  const sub2 = process.env.SUB_URL_2;
  const token = process.env.GIST_TOKEN;

  // Gist 目标：允许统一或拆分
  const gistIdFallback = process.env.GIST_ID; // 统一
  const gistIdMultiple = process.env.GIST_ID_MULTIPLE || gistIdFallback;
  const gistIdMini = process.env.GIST_ID_MINI || gistIdFallback;

  if (!sub1 || !sub2) throw new Error('Missing SUB_URL_1 or SUB_URL_2');
  if (!token || !gistIdMultiple || !gistIdMini) {
    throw new Error('Missing GIST_TOKEN or target Gist ID(s)');
  }

  const srcRel = process.env.CONFIG_PATH || 'config/baiye-multiple.yaml';
  const srcPath = path.resolve(srcRel);
  if (!fs.existsSync(srcPath)) throw new Error(`${srcRel} not found`);

  const raw = fs.readFileSync(srcPath, 'utf8');

  // multiple：icon v + 订阅替换 + 显示名
  const withIconV = bumpIconsV(raw);
  const outMultiple = withIconV
    .replace(/替换订阅链接1/g, sub1)
    .replace(/替换订阅链接2/g, sub2)
    .replace(/\[显示名称A可修改\]/g, '[Haita]')
    .replace(/\[显示名称B可修改\]/g, '[BoostNet]');

  const genMulti = (gistFileMultiple.replace(/\.ya?ml$/, '') + '.generated.yaml');
  fs.writeFileSync(genMulti, outMultiple, 'utf8');

  const r1 = await patchGist({
    gistId: gistIdMultiple, token, filename: gistFileMultiple, content: outMultiple
  });
  console.log('✅ multiple →', r1?.files?.[gistFileMultiple]?.raw_url);

  // mini：geodata-loader: standard -> memconservative
  const outMini = outMultiple.replace(/geodata-loader:\s*standard/g, 'geodata-loader: memconservative');
  const genMini = (gistFileMini.replace(/\.ya?ml$/, '') + '.generated.yaml');
  fs.writeFileSync(genMini, outMini, 'utf8');

  const r2 = await patchGist({
    gistId: gistIdMini, token, filename: gistFileMini, content: outMini
  });
  console.log('✅ mini →', r2?.files?.[gistFileMini]?.raw_url);

  console.log(`::notice title=Gist Updated::${r1?.files?.[gistFileMultiple]?.raw_url}\n${r2?.files?.[gistFileMini]?.raw_url}`);
})().catch((err) => {
  console.error('❌', err.message || err);
  process.exit(1);
});
