const { getAllUsers, getUserLibraries, getWatchedItems, getUserByName, updatePlaybackPosition } = require('./api');
const { findEpisode, findMovie } = require('./matcher');
const { shouldSyncUser } = require('./config');

/**
 * Sync a single item from master to target server
 */
async function syncItemToTarget(sourceItem, sourceUsername, targetServer) {
  try {
    // Get target user
    const targetUserId = await getUserByName(targetServer, sourceUsername);
    if (!targetUserId) {
      console.error(`[FULL-SYNC] User ${sourceUsername} not found on ${targetServer.name}`);
      return { success: false, reason: 'user_not_found' };
    }

    // Find matching item on target server
    const itemType = sourceItem.Type;
    const itemName = sourceItem.Name;
    const providers = sourceItem.ProviderIds || {};

    let targetItem = null;

    if (itemType === 'Episode') {
      // Convert ProviderIds to webhook format for compatibility with existing functions
      const webhookProviders = {};
      Object.entries(providers).forEach(([key, value]) => {
        webhookProviders[`Provider_${key}`] = value;
      });
      targetItem = await findEpisode(targetServer, targetUserId, itemName, webhookProviders);
    } else if (itemType === 'Movie') {
      const webhookProviders = {};
      Object.entries(providers).forEach(([key, value]) => {
        webhookProviders[`Provider_${key}`] = value;
      });
      targetItem = await findMovie(targetServer, targetUserId, itemName, webhookProviders);
    } else {
      console.error(`[FULL-SYNC] Unsupported item type: ${itemType}`);
      return { success: false, reason: 'unsupported_type' };
    }

    if (!targetItem) {
      console.error(`[FULL-SYNC] Could not find matching item "${itemName}" on ${targetServer.name}`);
      return { success: false, reason: 'item_not_found' };
    }

    // Check if target already has the same or newer playstate
    const sourceUserData = sourceItem.UserData || {};
    const targetUserData = targetItem.UserData || {};

    const sourceLastPlayed = sourceUserData.LastPlayedDate ? new Date(sourceUserData.LastPlayedDate) : new Date(0);
    const targetLastPlayed = targetUserData.LastPlayedDate ? new Date(targetUserData.LastPlayedDate) : new Date(0);

    // Skip if target has more recent playback
    if (targetLastPlayed > sourceLastPlayed) {
      console.log(`[FULL-SYNC] Skipping "${itemName}" - target has newer playstate`);
      return { success: true, reason: 'already_synced' };
    }

    // Sync the playback state
    await updatePlaybackPosition(
      targetServer,
      targetUserId,
      targetItem.Id,
      sourceUserData.PlaybackPositionTicks || 0,
      sourceUserData.LastPlayedDate,
      sourceItem.RunTimeTicks || 0,
      sourceUserData.Played || false  // Pass the Played status from source
    );

    console.log(`[FULL-SYNC] ✓ Synced "${itemName}" to ${targetServer.name}`);
    return { success: true };

  } catch (error) {
    console.error(`[FULL-SYNC] Error syncing item:`, error.message);
    return { success: false, reason: error.message };
  }
}

/**
 * Perform full sync from master server to all other servers
 */
async function performFullSync(config) {
  console.log('\n' + '='.repeat(60));
  console.log('[FULL-SYNC] Starting full resync from master server');
  console.log('='.repeat(60));

  if (!config.masterServer) {
    console.error('[FULL-SYNC] No master server configured - skipping full sync');
    return;
  }

  // Find master server config
  const masterServer = config.subscribers.find(s => s.name.toLowerCase() === config.masterServer.toLowerCase());
  if (!masterServer) {
    console.error(`[FULL-SYNC] Master server "${config.masterServer}" not found in subscribers`);
    return;
  }

  // Get target servers (all except master)
  const targetServers = config.subscribers.filter(s => s.name.toLowerCase() !== config.masterServer.toLowerCase());
  if (targetServers.length === 0) {
    console.log('[FULL-SYNC] No target servers to sync to');
    return;
  }

  console.log(`[FULL-SYNC] Master: ${masterServer.name}`);
  console.log(`[FULL-SYNC] Targets: ${targetServers.map(s => s.name).join(', ')}`);

  try {
    // Get all users from master server
    const allUsers = await getAllUsers(masterServer);

    // Filter users based on syncUsers config
    const users = allUsers.filter(user => shouldSyncUser(user.Name, config.syncUsers));

    if (users.length === 0) {
      console.log('[FULL-SYNC] No users to sync (check syncUsers configuration)');
      return;
    }

    if (config.syncUsers && config.syncUsers.length > 0) {
      console.log(`[FULL-SYNC] Syncing ${users.length} user(s): ${users.map(u => u.Name).join(', ')}`);
      const skippedUsers = allUsers.filter(user => !shouldSyncUser(user.Name, config.syncUsers));
      if (skippedUsers.length > 0) {
        console.log(`[FULL-SYNC] Skipping ${skippedUsers.length} user(s) not in syncUsers list`);
      }
    }

    let totalSynced = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    // For each user
    for (const user of users) {
      console.log(`\n[FULL-SYNC] Processing user: ${user.Name}`);

      // Get user's libraries
      const libraries = await getUserLibraries(masterServer, user.Id);

      // For each library
      for (const library of libraries) {
        console.log(`[FULL-SYNC] Processing library: ${library.Name} (${library.CollectionType})`);

        // Get all watched items in this library
        const items = await getWatchedItems(masterServer, user.Id, library.Id, library.CollectionType);

        // Sync each item to all target servers
        for (const item of items) {
          for (const targetServer of targetServers) {
            const result = await syncItemToTarget(item, user.Name, targetServer);

            if (result.success) {
              if (result.reason === 'already_synced') {
                totalSkipped++;
              } else {
                totalSynced++;
              }
            } else {
              totalErrors++;
            }
          }
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('[FULL-SYNC] Full sync completed');
    console.log(`[FULL-SYNC] Synced: ${totalSynced}, Skipped: ${totalSkipped}, Errors: ${totalErrors}`);
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('[FULL-SYNC] Error during full sync:', error.message);
    console.error('[FULL-SYNC] Stack trace:', error.stack);
  }
}

/**
 * Schedule periodic full syncs
 */
function scheduleFullSync(config) {
  if (!config.masterServer) {
    console.log('[FULL-SYNC] No master server configured - periodic sync disabled');
    return;
  }

  const intervalMs = config.fullResyncIntervalHours * 60 * 60 * 1000;
  console.log(`[FULL-SYNC] Scheduling full resync every ${config.fullResyncIntervalHours} hours`);

  setInterval(async () => {
    console.log(`[FULL-SYNC] Scheduled resync triggered`);
    await performFullSync(config);
  }, intervalMs);
}

module.exports = {
  performFullSync,
  scheduleFullSync
};
