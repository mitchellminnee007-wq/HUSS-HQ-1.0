const { spawn } = require('node:child_process');
const path = require('node:path');
const LANGUAGES = { en: 'English', nl: 'Dutch', fr: 'French', de: 'German' };
const MODELS = { en: 'en_US-ryan-medium', nl: 'nl_BE-nathalie-medium', fr: 'fr_FR-siwis-medium', de: 'de_DE-thorsten-medium' };
let generationTail = Promise.resolve(), pending = 0;
function cleanText(value) {
  return String(value || '').replace(/https?:\/\/\S+/gi, ' link ').replace(/<@!?\d+>/g, ' member ').replace(/<@&\d+>/g, ' role ').replace(/<#\d+>/g, ' channel ').replace(/<a?:([\w]+):\d+>/g, '$1').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
}
function synthesize(text, language = 'en', signal) {
  if (!LANGUAGES[language]) return Promise.reject(new Error('Unsupported speech language.'));
  if (signal?.aborted) return Promise.reject(new Error('Speech cancelled.'));
  if (pending >= 20) return Promise.reject(new Error('Speech generation is busy. Try again shortly.'));
  pending++;
  const result = generationTail.then(() => render(text, language, signal));
  generationTail = result.catch(() => {}).finally(() => { pending--; if (!owners.size) closeWorker(); });
  return result;
}
// One persistent worker and one cached model bound CPU and memory usage.
const owners = new Set();
let worker, active;
function closeWorker(error = new Error('Speech worker stopped.')) {
  const child = worker; worker = null;
  if (active) { const task = active; active = null; task.reject(error); }
  child?.kill();
}
function ensureWorker() {
  if (worker) return worker;
  const child = spawn(process.env.HUSS_PIPER_PYTHON || '/opt/huss-piper-venv/bin/python', ['-u', path.join(__dirname, 'tts-worker.py'), process.env.HUSS_PIPER_MODELS || '/opt/huss-piper-voices'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  worker = child;
  let output = '';
  child.stdout.on('data', chunk => {
    if (worker !== child) return;
    output += chunk.toString('utf8');
    if (output.length > 18 * 1024 * 1024) return closeWorker(new Error('Speech is too long.'));
    let end;
    while ((end = output.indexOf('\n')) >= 0) {
      const line = output.slice(0, end); output = output.slice(end + 1);
      const task = active; active = null;
      if (!task) continue;
      try { const result = JSON.parse(line); if (result.error) task.reject(new Error('Speech generation failed.')); else task.resolve(Buffer.from(result.audio || '', 'base64')); }
      catch { task.reject(new Error('Invalid speech response.')); }
    }
  });
  const failed = () => { if (worker === child) closeWorker(new Error('Speech tools are unavailable. Ask an officer to check the bot.')); };
  child.on('error', failed); child.on('exit', failed); child.stdin.on('error', failed);
  return child;
}
function request(text, language, signal, warm = false) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Speech cancelled.'));
    const child = ensureWorker();
    const abort = () => closeWorker(new Error('Speech cancelled.'));
    const timer = setTimeout(() => closeWorker(new Error('Speech generation timed out.')), 30000);
    const finish = (fn, value) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); fn(value); };
    active = {resolve: value => finish(resolve, value), reject: error => finish(reject, error)};
    signal?.addEventListener('abort', abort, {once:true});
    child.stdin.write(JSON.stringify({model: MODELS[language], text, warm}) + '\n');
  });
}
function retain(guildId) {
  owners.add(guildId);
  // Warm English during the Discord connection; later messages reuse it.
  const warm = generationTail.then(() => owners.size ? request('', 'en', undefined, true) : undefined);
  generationTail = warm.catch(() => {});
}
function release(guildId) {
  owners.delete(guildId);
  if (!owners.size) closeWorker();
}
async function render(text, language, signal) {
  const audio = await request(text, language, signal);
  if (signal?.aborted) throw new Error('Speech cancelled.');
  return new Promise((resolve, reject) => {
    const convert = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', '22050', '-ac', '1', '-i', 'pipe:0', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'], {stdio:['pipe','pipe','ignore'], windowsHide:true});
    const chunks = []; let size = 0, settled = false;
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); convert.kill();
      if (!owners.size) closeWorker();
      if (error) reject(error); else resolve(Buffer.concat(chunks));
    };
    const abort = () => finish(new Error('Speech cancelled.'));
    const timer = setTimeout(() => finish(new Error('Speech conversion timed out.')), 10000);
    signal?.addEventListener('abort', abort, {once:true});
    convert.on('error', () => finish(new Error('Speech conversion unavailable.')));
    convert.stdin.on('error', () => finish(new Error('Speech conversion failed.')));
    convert.on('close', code => finish(code === 0 && size ? null : new Error('Speech conversion failed.')));
    convert.stdout.on('data', chunk => { size += chunk.length; if (size > 12 * 1024 * 1024) return finish(new Error('Speech is too long.')); chunks.push(chunk); });
    convert.stdin.end(audio);
  });
}
module.exports = { LANGUAGES, cleanText, synthesize, retain, release };
