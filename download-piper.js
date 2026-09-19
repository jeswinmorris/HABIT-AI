/**
 * Download the Piper TTS runtime used by src/core/voiceEngine.ts into public/piper/.
 *
 * The URLs are read from the installed @mintplex-labs/piper-tts-web package itself, so they
 * cannot drift when upstream moves a repo (the old rhasspy/piper `wasm/` path 404s).
 *
 *   node download-piper.js                     default voices
 *   node download-piper.js --voice en_US-ryan-medium
 *
 * Failures are reported and never abort the run: without these files the AI simply uses the
 * operating system voice instead of Piper.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const PKG = '@mintplex-labs/piper-tts-web';
const dir = path.join(__dirname, 'public', 'piper');

const DEFAULT_VOICES = ['en_US-lessac-medium', 'en_US-amy-medium'];

function parseVoices() {
  const out = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--voice' && argv[i + 1]) out.push(argv[++i]);
    else if (argv[i].startsWith('--voice=')) out.push(argv[i].split('=')[1]);
  }
  return out.length ? out : DEFAULT_VOICES;
}

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'habit-ai-setup', Accept: '*/*' } }, (res) => {
      const code = res.statusCode || 0;
      if ((code === 301 || code === 302 || code === 303 || code === 307 || code === 308) && res.headers.location) {
        res.resume();
        if (redirects > 6) return reject(new Error('too many redirects'));
        // Location is often relative — resolve it against the URL we asked for
        let next;
        try { next = new URL(res.headers.location, url).toString() } catch { return reject(new Error('bad redirect: ' + res.headers.location)) }
        return get(next, redirects + 1).then(resolve, reject);
      }
      resolve({ res, code, finalUrl: url });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('timed out')));
  });
}

async function download(url, dest) {
  const { res, code } = await get(url);
  if (code !== 200) { res.resume(); throw new Error('HTTP ' + code); }
  const tmp = dest + '.part';
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
  fs.renameSync(tmp, dest);
  return fs.statSync(dest).size;
}

(async () => {
  let pkg;
  try { pkg = await import(PKG); }
  catch (e) {
    try { pkg = await import(path.join(__dirname, 'node_modules', PKG, 'dist', 'piper-tts-web.js')); }
    catch (e2) {
      console.error('  Cannot read ' + PKG + ' — run npm install first. (' + (e2.message || e.message) + ')');
      return; // never fail the whole setup over the optional voice
    }
  }
  const HF = pkg.HF_BASE, ONNX = pkg.ONNX_BASE, WASM = pkg.WASM_BASE, MAP = pkg.PATH_MAP || {};
  const voices = parseVoices();

  const jobs = [
    // piper phonemizer runtime
    [WASM + '.wasm', 'piper_phonemize.wasm'],
    [WASM + '.data', 'piper_phonemize.data'],
    [WASM + '.js', 'piper_phonemize.js'],
    // onnxruntime web assembly + the .mjs glue it fetches next to the wasm
    [ONNX + 'ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.wasm'],
    [ONNX + 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.mjs']
  ];
  for (const v of voices) {
    const p = MAP[v];
    if (!p) { console.log('  Unknown voice id (not in this piper package): ' + v); continue }
    jobs.push([HF + '/' + p, v + '.onnx']);
    jobs.push([HF + '/' + p + '.json', v + '.onnx.json']);
  }
  // also grab the male/female defaults voiceEngine may ask for
  for (const v of DEFAULT_VOICES) {
    const p = MAP[v];
    if (p && !voices.includes(v)) { jobs.push([HF + '/' + p, v + '.onnx']); jobs.push([HF + '/' + p + '.json', v + '.onnx.json']) }
  }

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  // onnxruntime's .mjs glue is not published on the wasm CDN — copy it from the installed
  // package, which is the exact version the app bundles.
  const glueTargets = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.jsep.mjs']
  for (const f of glueTargets) {
    const dest = path.join(dir, f)
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) continue
    for (const base of [path.join(__dirname, 'node_modules', 'onnxruntime-web', 'dist'), path.join(__dirname, '..', 'app', 'node_modules', 'onnxruntime-web', 'dist')]) {
      const src = path.join(base, f)
      try { if (fs.existsSync(src)) { fs.copyFileSync(src, dest); console.log('  copied from node_modules: ' + f); break } } catch {}
    }
  }
  console.log('Piper TTS files -> ' + path.relative(process.cwd(), dir));
  let ok = 0, skipped = 0, failed = 0;
  for (const [url, file] of jobs) {
    const dest = path.join(dir, file);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) { console.log('  ✓ already there: ' + file); skipped++; continue }
    console.log('  → ' + file);
    try {
      const size = await download(url, dest);
      console.log('    OK ' + file + ' (' + (size / 1048576).toFixed(1) + ' MB)');
      ok++;
    } catch (e) {
      try { if (fs.existsSync(dest + '.part')) fs.unlinkSync(dest + '.part') } catch {}
      console.log('    SKIP ' + file + ' — ' + (e.message || e));
      failed++;
    }
  }
  console.log('\nDone: ' + ok + ' downloaded, ' + skipped + ' already present, ' + failed + ' unavailable.');
  if (!ok && !skipped) console.log('No voice runtime installed — the AI will use the system voice. This does not affect speech RECOGNITION.');
  else console.log('Restart the app; Settings • Talkback should now say "Piper (natural)".');
})();
