// Run: node scripts/test-web-status.cjs /path/to/php
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const net = require('node:net');
const {once} = require('node:events');

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'huss-status-test-'));
  const token = 'a'.repeat(64);
  fs.copyFileSync(path.join(__dirname, '../web-status/api.php'), path.join(directory, 'api.php'));
  fs.writeFileSync(path.join(directory, 'config.php'), `<?php return array('token' => '${token}');`);
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.argv[2] || 'php', ['-S', `127.0.0.1:${port}`, '-t', directory], {stdio: 'ignore', windowsHide: true});
  let spawnError;
  child.on('error', error => { spawnError = error; });
  const url = `http://127.0.0.1:${port}/api.php`;
  const snapshot = {connected: true, color: 3066993, summary: 'Operational', fields: [{name: 'Uptime', value: '1h', inline: true}], secret: 'must not be retained'};
  const post = (body, key = token) => fetch(url, {method: 'POST', headers: {'X-Status-Token': key, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      if (spawnError) throw spawnError;
      try { await fetch(url); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(ready, 'PHP server starts');
    assert.equal((await (await fetch(url)).json()).state, 'waiting');
    assert.equal((await post(snapshot, 'wrong')).status, 401);
    assert.equal((await post({connected: true})).status, 400);
    assert.equal((await post({...snapshot, summary: 'x'.repeat(33000)})).status, 413);
    assert.equal((await post(snapshot)).status, 200);
    const fresh = await (await fetch(url)).json();
    assert.equal(fresh.state, 'fresh');
    assert.equal(fresh.snapshot.connected, true);
    assert.equal(fresh.snapshot.secret, undefined);
    const today = new Date(Math.floor(fresh.receivedAt / 3600) * 3600000).toISOString().replace('.000Z', 'Z');
    assert.equal(fresh.history[today].samples, 1);
    const dateKey = today.slice(0, 10);
    assert.equal(fresh.overallHistory[dateKey].samples, 1);
    assert.equal(Object.keys(fresh.overallHistory).length, 1);
    assert.equal(fresh.history[today].services['Overall service'], 1);
    assert.equal(Object.keys(fresh.history).length, 1, 'no fabricated past history');
    assert.equal((await fetch(url.replace('api.php', 'snapshot.php'))).status, 404);
    const storage = path.join(directory, 'snapshot.php');
    const raw = fs.readFileSync(storage, 'utf8');
    fs.writeFileSync(storage, raw.replace(`"receivedAt":${fresh.receivedAt}`, `"receivedAt":${fresh.receivedAt - 90}`));
    const stale = await (await fetch(url)).json();
    assert.equal(stale.state, 'stale');
    assert.equal(stale.history[today].gap, true);
    assert.equal((await post({...snapshot, connected: false})).status, 200);
    assert.equal((await (await fetch(url)).json()).snapshot.connected, false);
    assert.equal((await post({...snapshot, fields: [{name:'Community', value:'🟡 Maintenance'}, {name:'Logistics', value:'🕒 Next war'}]})).status, 200);
    const updated = await (await fetch(url)).json();
    assert.equal(updated.history[today].services['Overall service'], 6, 'recovery must preserve earlier outage');
    assert.equal(updated.history[today].services.Community, 3);
    assert.equal(updated.history[today].services.Logistics, 2);
    assert.equal(updated.history[today].samples, 3);
    assert.equal(updated.overallHistory[dateKey].samples, 3, 'daily counters must not double count hourly observations');
    assert.equal(updated.overallHistory[dateKey].services['Overall service'], 6);
    assert.equal(updated.overallHistory[dateKey].gap, true);
    assert.equal(updated.history[today].gap, true, 'gap persists after recovery');
    const retained = fs.readFileSync(storage, 'utf8');
    const split = retained.indexOf('\n') + 1;
    const saved = JSON.parse(retained.slice(split));
    saved.history['2000-01-01'] = {services:{'Overall service':1},samples:1};
    const dayKey = offset => new Date((updated.receivedAt - offset * 86400) * 1000).toISOString().slice(0, 10);
    saved.overallHistory[dayKey(89)] = {services:{'Overall service':3},samples:2};
    saved.overallHistory[dayKey(90)] = {services:{'Overall service':6},samples:2};
    const hourKey = offset => new Date((Math.floor(updated.receivedAt / 3600) - offset) * 3600000).toISOString().replace('.000Z', 'Z');
    saved.history[hourKey(23)] = {services:{'Overall service':3},samples:2};
    saved.history[hourKey(24)] = {services:{'Overall service':6},samples:2};
    fs.writeFileSync(storage, retained.slice(0, split) + JSON.stringify(saved));
    const filtered = await (await fetch(url)).json();
    assert.equal(filtered.overallHistory[dayKey(89)].samples, 2);
    assert.equal(filtered.overallHistory[dayKey(90)], undefined);
    assert.equal(filtered.history['2000-01-01'], undefined, 'daily history is not fabricated into hours');
    assert.equal(filtered.history[hourKey(24)], undefined, 'GET excludes expired hours');
    assert.equal(filtered.history[hourKey(23)].samples, 2, 'oldest displayed hour remains');
    assert.equal((await post(snapshot)).status, 200);
    assert.equal((await (await fetch(url)).json()).history['2000-01-01'], undefined);
    const persisted = JSON.parse(fs.readFileSync(storage, 'utf8').slice(split));
    assert.equal(persisted.history[hourKey(24)], undefined, 'POST removes expired hours from storage');
    assert.equal(persisted.overallHistory[dayKey(90)], undefined);
    delete persisted.overallHistory;
    fs.writeFileSync(storage, retained.slice(0, split) + JSON.stringify(persisted));
    const migrated = await (await fetch(url)).json();
    assert.equal(migrated.overallHistory[dateKey].services['Overall service'], 6, 'existing hourly outages seed overall daily history');
    assert.equal((await post(snapshot)).status, 200);
    const afterMigration = await (await fetch(url)).json();
    assert.equal(afterMigration.overallHistory[dateKey].samples, migrated.overallHistory[dateKey].samples + 1);
    console.log('PASS: API authentication, validation, publishing, storage protection, stale detection, hourly history, gaps, worst status, retention and recovery.');
  } finally {
    if (child.exitCode === null && child.pid) {
      const stopped = once(child, 'exit');
      child.kill();
      await stopped;
    }
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('huss-status-test-'));
    fs.rmSync(resolved, {recursive: true, force: true});
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
