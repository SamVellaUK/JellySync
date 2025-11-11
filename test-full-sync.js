const path = require('path');
const { loadConfig } = require('./lib/config');
const { getAllUsers, getUserLibraries, getWatchedItems } = require('./lib/api');

async function testFullSync() {
  console.log('='.repeat(60));
  console.log('Testing Full Sync - Diagnostic Mode');
  console.log('='.repeat(60));

  const config = loadConfig(path.join(__dirname, 'config.json'));

  console.log('\nConfiguration:');
  console.log('- Master Server:', config.masterServer);
  console.log('- Sync Users:', config.syncUsers);
  console.log('- Subscribers:', config.subscribers.map(s => s.name).join(', '));

  const masterServer = config.subscribers.find(s => s.name.toLowerCase() === config.masterServer.toLowerCase());

  if (!masterServer) {
    console.error('ERROR: Master server not found!');
    return;
  }

  console.log('\n' + '='.repeat(60));
  console.log('Step 1: Getting users from master server');
  console.log('='.repeat(60));

  const allUsers = await getAllUsers(masterServer);
  console.log(`Found ${allUsers.length} users:`, allUsers.map(u => u.Name).join(', '));

  // Filter by syncUsers
  const filteredUsers = allUsers.filter(user => {
    if (!config.syncUsers || config.syncUsers.length === 0) return true;
    return config.syncUsers.some(u => u.toLowerCase() === user.Name.toLowerCase());
  });

  console.log(`Filtering to ${filteredUsers.length} users:`, filteredUsers.map(u => u.Name).join(', '));

  for (const user of filteredUsers) {
    console.log('\n' + '='.repeat(60));
    console.log(`Step 2: Getting libraries for user: ${user.Name}`);
    console.log('='.repeat(60));

    const libraries = await getUserLibraries(masterServer, user.Id);
    console.log(`Found ${libraries.length} media libraries:`, libraries.map(l => `${l.Name} (${l.CollectionType})`).join(', '));

    for (const library of libraries) {
      console.log('\n' + '-'.repeat(60));
      console.log(`Step 3: Getting watched items from: ${library.Name}`);
      console.log('-'.repeat(60));

      const items = await getWatchedItems(masterServer, user.Id, library.Id, library.CollectionType);
      console.log(`Found ${items.length} watched/in-progress items`);

      if (items.length > 0) {
        console.log('\nFirst 5 items:');
        items.slice(0, 5).forEach((item, i) => {
          console.log(`  ${i + 1}. ${item.Name} (${item.Type})`);
          console.log(`     - Providers:`, item.ProviderIds || 'NONE');
          console.log(`     - UserData:`, item.UserData ? 'Present' : 'MISSING');
          if (item.UserData) {
            console.log(`     - Played:`, item.UserData.Played);
            console.log(`     - Position:`, item.UserData.PlaybackPositionTicks);
            console.log(`     - LastPlayed:`, item.UserData.LastPlayedDate);
          }
        });
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Diagnostic Complete');
  console.log('='.repeat(60));
}

testFullSync().catch(err => {
  console.error('Error:', err);
  console.error('Stack:', err.stack);
  process.exit(1);
});
