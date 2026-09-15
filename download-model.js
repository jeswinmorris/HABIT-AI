/**
 * Downloads the offline STT model used by src/core/voiceEngine.ts into public/.
 * The model is ~40 MB and is not committed to the repo, so `npm run dev` /
 * `npm run build:electron` have no speech input until you run this once:
 *
 *   node download-model.js
 *
 * Already installed? The script exits without touching anything.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const MODEL_URL = 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.tar.gz';
const dest = path.join(__dirname, 'public', 'habi-model.tar.gz');
if (!fs.existsSync(path.dirname(dest))) fs.mkdirSync(path.dirname(dest), { recursive: true });

function download(url, file, redirects = 0) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'habit-ai-setup' } }, (r) => {
      if (r.statusCode === 301 || r.statusCode === 302 || r.statusCode === 307 || r.statusCode === 308) {
        r.resume();
        if (redirects > 5) return rej(new Error('too many redirects'));
        return download(r.headers.location, file, redirects + 1).then(res, rej);
      }
      if (r.statusCode !== 200) { r.resume(); return rej(new Error('HTTP ' + r.statusCode + ' for ' + url)); }
      const out = fs.createWriteStream(file);
      let got = 0;
      r.on('data', (c) => {
        got += c.length;
        process.stdout.write('\r  ' + (got / 1048576).toFixed(1) + ' MB');
      });
      r.pipe(out);
      out.on('finish', () => out.close(() => res()));
      out.on('error', rej);
    }).on('error', rej);
  });
}

(async () => {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000000) {
    console.log('Model already installed:', dest);
    return;
  }
  console.log('Downloading Vosk EN model ->', path.relative(process.cwd(), dest));
  const tmp = dest + '.part';
  await download(MODEL_URL, tmp);
  fs.renameSync(tmp, dest);
  console.log('\nOK', dest, (fs.statSync(dest).size / 1048576).toFixed(1) + ' MB');
  console.log('Restart the app — Settings • Voice will now show VOSK READY.');
})();
