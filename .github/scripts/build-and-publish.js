// 环境变量：SUB_URL_1, SUB_URL_2, GIST_TOKEN, GIST_ID, GIST_FILE_NAME
// 用法：node .github/scripts/build-and-publish.js

const fs = require('fs');
const https = require('https');
const path = require('path');

function patchGist({ gistId, token, filename, content }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      files: { [filename]: { content } }
    });
    const req = https.request(
      `https://api.github.com/gists/${gistId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `token ${token}`,
          'User-Agent': 'github-actions',
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      res => {
        let data = '';
        res.on('data', d => (data += d));
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
  const sub2 = process.env.SUB_URL_2;
  const gistToken = process.env.GIST_TOKEN;
  const gistId = process.env.GIST_ID;
  const gistFile = process.env.GIST_FILE_NAME || 'baiye-multiple.yaml';

  if (!sub1 || !sub2) throw new Error('Missing SUB_URL_1 or SUB_URL_2');
  if (!gistToken || !gistId) throw new Error('Missing GIST_TOKEN or GIST_ID');
  
  const srcRel = process.env.CONFIG_PATH || 'baiye-multiple.yaml'; // 新增：可用环境变量覆盖
  const srcPath = path.resolve(srcRel);
  if (!fs.existsSync(srcPath)) throw new Error(`${srcRel} not found at repo root`);

  const raw = fs.readFileSync(srcPath, 'utf8');

  // 占位符替换（可按需扩展）
  const out = raw
    .replace(/替换订阅链接1/g, sub1)
    .replace(/替换订阅链接2/g, sub2)
    .replace(/\[替换显示A\]/g, '[Haita]')
    .replace(/\[替换显示B\]/g, '[BoostNet]');

  fs.writeFileSync('baiye-multiple.generated.yaml', out, 'utf8');

  const res = await patchGist({
    gistId,
    token: gistToken,
    filename: gistFile,
    content: out
  });

  // 打印 Raw 地址，方便你复制
  const file = res?.files?.[gistFile];
  const rawUrl = file?.raw_url || '(no raw_url returned)';
  console.log('✅ Gist updated. Raw URL:', rawUrl);
  // 也给个 GitHub Actions notice
  console.log(`::notice title=Gist Raw URL::${rawUrl}`);
})().catch(err => {
  console.error('❌', err.message || err);
  process.exit(1);
});
