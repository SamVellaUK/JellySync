// Offline test for cross-server user mapping in lib/sync.js (no network, API layer is stubbed).
// Run: node test-user-mapping.js
const assert = require('assert');
const path = require('path');

const origLog = console.log, origErr = console.error;
const calls = [];
let serverUsers = {};

function stub(file, exports) {
  const resolved = require.resolve(path.join(__dirname, 'lib', file));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

stub('api', {
  getUserByName: async (server, name) => (serverUsers[server.name] || []).includes(name) ? `${server.name}:${name}` : null,
  updatePlaybackPosition: async (server, userId) => { calls.push({ type: 'position', userId }); },
  updatePlayedStatus: async (server, userId, itemId, played) => { calls.push({ type: 'played', userId, played }); },
  updateFavoriteStatus: async (server, userId) => { calls.push({ type: 'favorite', userId }); }
});
stub('matcher', {
  findEpisode: async () => ({ Id: 'item1', Name: 'Ep' }),
  findMovie: async () => ({ Id: 'item1', Name: 'Movie' })
});
stub('fileCopy', { handleFileCopy: () => {} });

const { processWebhook } = require('./lib/sync');

const played = (user, server) => ({
  NotificationType: 'UserDataSaved', SaveReason: 'TogglePlayed', ServerName: server,
  NotificationUsername: user, ItemType: 'Episode', Name: 'Ep', Played: true
});

async function run(name, config, users, webhook, expectedUsers, expectedStatus = 'success') {
  calls.length = 0;
  serverUsers = users;
  const result = await processWebhook(webhook, config);
  assert.deepStrictEqual(calls.map(c => c.userId).sort(), expectedUsers.sort(), `${name}: users written`);
  assert.strictEqual(result.status, expectedStatus, `${name}: status (${JSON.stringify(result)})`);
  origLog(`ok - ${name}`);
}

(async () => {
  console.log = console.error = () => {};
  const out = [];
  const report = async (...args) => { try { await run(...args); out.push(null); } catch (e) { out.push(e); } };

  // Master has Family <-> Steve paired via userMap; child has plain names
  const paired = {
    masterServer: 'Media', syncUsers: ['Family'],
    subscribers: [
      { name: 'Media', syncEvents: ['UserDataSaved'], userMap: { Family: 'Steve' } },
      { name: 'bazzite', syncEvents: ['UserDataSaved'] }
    ]
  };
  const pairedUsers = { Media: ['Family', 'Steve'], bazzite: ['Family'] };

  // The bug: bazzite Family -> Media must update Steve AND Family
  await report('child -> paired master updates both accounts', paired, pairedUsers,
    played('Family', 'bazzite'), ['Media:Steve', 'Media:Family']);
  // Unchanged behaviour: master Family -> child Family + same-server partner Steve
  await report('paired master Family -> child + partner', paired, pairedUsers,
    played('Family', 'Media'), ['bazzite:Family', 'Media:Steve']);
  // Unchanged behaviour: master Steve -> child Family + same-server partner Family
  await report('paired master Steve -> child + partner', paired, pairedUsers,
    played('Steve', 'Media'), ['bazzite:Family', 'Media:Family']);

  // README "cross-server mismatch": canonical Alice doesn't exist on the target, only alice_remote
  const mismatch = {
    masterServer: 'master', syncUsers: ['Alice'],
    subscribers: [
      { name: 'master', syncEvents: ['UserDataSaved'] },
      { name: 'remote', syncEvents: ['UserDataSaved'], userMap: { Alice: 'alice_remote' } }
    ]
  };
  await report('name mismatch: only the mapped user, no error', mismatch, { master: ['Alice'], remote: ['alice_remote'] },
    played('Alice', 'master'), ['remote:alice_remote']);

  console.log = origLog; console.error = origErr;
  const failed = out.filter(Boolean);
  failed.forEach(e => console.error(`FAIL - ${e.message}`));
  console.log(failed.length ? `\n${failed.length} failed` : '\nall passed');
  process.exit(failed.length ? 1 : 0);
})();
