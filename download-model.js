/**
 * Downloads the offline speech-recognition model used by src/core/voiceEngine.ts.
 * ~40 MB, kept out of the repository, and the app has no mic input until it exists:
 *
 *   npm run model          (or: node download-model.js)
 *
 * Failure never aborts the rest of the setup; without the model the app falls back to the
 * operating system's speech recogniser and Settings • Voice shows the reason.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const SOURCES = [
  'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.tar.gz',
  'https://github.com/alphacep/vosk-model-small-en-us/releases/download/v0.15/vosk-model-small-en-us-0.15.tar.gz'
];
const dest = path.join(__dirname, 'public', 'habi-model.tar.gz');

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'habit-ai-setup' } }, (res) => {
      const code = res.statusCode || 0;
      if ((code === 301 || code === 302 || code === 303 || code === 307 || code === 308) && res.headers.location) {
        res.resume();
        if (redirects > 6) return reject(new Error('too many redirects'));
        let next;
        try { next = new URL(res.headers.location, url).toString() } catch { return reject(new Error('bad redirect: ' + res.headers.location)) }
        return get(next, redirects + 1).then(resolve, reject);
      }
      resolve({ res, code });
    });
    req.on('error', reject);
    req.setTimeout(90000, () => req.destroy(new Error('timed out')));
  });
}

async function download(url, file) {
  const { res, code } = await get(url);
  if (code !== 200) { res.resume(); throw new Error('HTTP ' + code + ' for ' + url) }
  const tmp = file + '.part';
  const out = fs.createWriteStream(tmp);
  let got = 0;
  let last = 0;
  const report = (g, t) => process.stdout.write('      ' + (g / 1048576).toFixed(1) + (t ? ' / ' + (t / 1048576).toFixed(1) : '') + ' MB\n')
  const total = Number(res.headers['content-length'] || 0);
  await new Promise((resolve, reject) => {
    res.on('data', (c) => {
      got += c.length;
      if (got - (last || 0) >= 5242880) { last = got; report(got, total) }
    });
    res.pipe(out);
    out.on('finish', () => out.close(resolve));
    out.on('error', reject);
    res.on('error', reject);
  });
  fs.renameSync(tmp, file);
  return fs.statSync(file).size;
}

(async () => {
  try {
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000000) {
      console.log('Offline speech model already installed: ' + path.relative(process.cwd(), dest));
      return;
    }
    if (!fs.existsSync(path.dirname(dest))) fs.mkdirSync(path.dirname(dest), { recursive: true });
    console.log('Downloading the Vosk English model (' + path.relative(process.cwd(), dest) + ')');
    let err = null;
    for (const url of SOURCES) {
      try {
        const size = await download(url, dest);
        console.log('\nOK — ' + (size / 1048576).toFixed(1) + ' MB at ' + path.relative(process.cwd(), dest));
        console.log('Restart the app: Settings • Voice should read VOSK READY.');
        return;
      } catch (e) { err = e; console.log('  mirror failed: ' + (e.message || e)) }
    }
    console.log('\nCould not download the model' + (err ? ' (' + err.message + ')' : '') + '.');
    console.log('The app still listens through the system speech engine; for offline recognition');
    console.log('drop ' + path.basename(dest) + ' into public\\ yourself (vosk-model-small-en-us-0.15.tar.gz).');
  } finally {
    process.exitCode = 0; // never break `npm run setup`
  }
})();
