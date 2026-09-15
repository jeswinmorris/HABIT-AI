/**
 * Downloads the Piper TTS runtime + the en_US-lessac-medium voice into public/piper/.
 * voiceEngine.ts looks for exactly these paths; without them TTS falls back to the
 * browser/WebSpeech voice (works, but sounds generic and needs an OS voice installed).
 *
 *   node download-piper.js      (or: npm run piper)
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'public', 'piper');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const files = [
  // phonemizer wasm runtime
  'https://raw.githubusercontent.com/rhasspy/piper/master/wasm/piper_phonemize.wasm',
  'https://raw.githubusercontent.com/rhasspy/piper/master/wasm/piper_phonemize.data',
  'https://raw.githubusercontent.com/rhasspy/piper/master/wasm/piper_phonemize.js',
  // voice model + config
  'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx',
  'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json'
];

function pipeTo(r, destPath, res, rej, redirects) {
  if (r.statusCode === 301 || r.statusCode === 302 || r.statusCode === 307 || r.statusCode === 308) {
    r.resume();
    if (redirects > 5) return rej(new Error('too many redirects'));
    return https.get(r.headers.location, (r2) => pipeTo(r2, destPath, res, rej, redirects + 1), rej);
  }
  if (r.statusCode !== 200) {
    r.resume();
    console.log('FAIL', destPath, 'HTTP', r.statusCode);
    return res();
  }
  const file = fs.createWriteStream(destPath);
  r.pipe(file);
  file.on('finish', () => file.close(() => { console.log('OK  ', path.basename(destPath)); res(); }));
  file.on('error', rej);
}

function dl(url, destPath) {
  return new Promise((res, rej) => {
    console.log('Downloading', path.basename(destPath));
    https.get(url, (r) => pipeTo(r, destPath, res, rej, 0), rej).on('error', rej);
  });
}

(async () => {
  for (const url of files) {
    const dest = path.join(dir, path.basename(url));
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) continue;
    await dl(url, dest);
  }
  console.log('Done:', fs.readdirSync(dir).join(', '));
})();
