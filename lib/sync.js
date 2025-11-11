const { getUserByName, updatePlaybackPosition, updatePlayedStatus, updateFavoriteStatus } = require('./api');
const { findEpisode, findMovie } = require('./matcher');
const { shouldSyncUser, getOtherServers } = require('./config');

/**
 * Process a webhook event and sync to other servers
 */
async function processWebhook(webhookData, config) {
  const { NotificationType, ServerName, NotificationUsername, ItemType, SaveReason } = webhookData;

  console.log(`\n[SYNC] === Processing ${NotificationType} ===`);
  console.log(`[SYNC] Item: ${webhookData.Name || webhookData.SeriesName}`);
  console.log(`[SYNC] User: ${NotificationUsername}`);
  console.log(`[SYNC] Server: ${ServerName}`);
  if (SaveReason) {
    console.log(`[SYNC] SaveReason: ${SaveReason}`);
  }

  // Check if user should be synced
  if (!shouldSyncUser(NotificationUsername, config.syncUsers)) {
    console.log(`[SYNC] User ${NotificationUsername} not in syncUsers list, skipping`);
    return { status: 'unsupported', reason: 'user_not_in_sync_list' };
  }

  // Find source and target subscribers
  const sourceServer = config.subscribers.find(s => s.name.toLowerCase() === ServerName.toLowerCase());
  const targetServers = getOtherServers(ServerName, config.subscribers);

  if (!sourceServer) {
    console.error(`[SYNC] Could not find source server: ${ServerName}`);
    return { status: 'error', reason: 'source_not_found' };
  }

  // Check if this server is configured to sync this event type
  const syncEvents = sourceServer.syncEvents || ['PlaybackStop'];
  if (!syncEvents.includes(NotificationType)) {
    console.log(`[SYNC] Event type ${NotificationType} not in syncEvents for ${ServerName}`);
    return { status: 'unsupported', reason: 'event_not_configured' };
  }

  // Check if this is a supported event type
  const supportedEventTypes = ['PlaybackStop', 'UserDataSaved'];
  if (!supportedEventTypes.includes(NotificationType)) {
    console.log(`[SYNC] Event type ${NotificationType} is not supported`);
    return { status: 'unsupported', reason: 'unsupported_event_type' };
  }

  // For UserDataSaved events, check if it's a supported SaveReason
  if (NotificationType === 'UserDataSaved') {
    const supportedSaveReasons = ['TogglePlayed', 'UpdateUserRating'];
    if (!supportedSaveReasons.includes(SaveReason)) {
      console.log(`[SYNC] SaveReason ${SaveReason} is not supported for UserDataSaved events`);
      return { status: 'unsupported', reason: 'unsupported_save_reason' };
    }
  }

  if (targetServers.length === 0) {
    console.error(`[SYNC] No target subscribers found (all subscribers must be different from ${ServerName})`);
    return { status: 'error', reason: 'no_targets' };
  }

  console.log(`[SYNC] Target servers: ${targetServers.map(s => s.name).join(', ')}`);

  // Extract provider IDs
  const providers = {};
  Object.keys(webhookData).forEach(key => {
    if (key.startsWith('Provider_')) {
      providers[key] = webhookData[key];
    }
  });

  // Track sync results
  let successCount = 0;
  let offlineCount = 0;
  let errorCount = 0;
  const errors = [];

  // Sync to each target server
  for (const targetServer of targetServers) {
    console.log(`\n[SYNC] --- Syncing to ${targetServer.name} ---`);

    try {
      // Get user on target server
      const targetUserId = await getUserByName(targetServer, NotificationUsername);
      if (!targetUserId) {
        console.error(`[SYNC] Could not find user ${NotificationUsername} on ${targetServer.name}, skipping`);
        errorCount++;
        errors.push(`${targetServer.name}: User not found`);
        continue;
      }

      // Find matching item on target server
      let targetItem = null;

      if (ItemType === 'Episode') {
        const episodeName = webhookData.Name;
        targetItem = await findEpisode(targetServer, targetUserId, episodeName, providers);
      } else if (ItemType === 'Movie') {
        const movieName = webhookData.Name;
        targetItem = await findMovie(targetServer, targetUserId, movieName, providers);
      } else {
        console.error(`[SYNC] Unsupported item type: ${ItemType}`);
        errorCount++;
        errors.push(`${targetServer.name}: Unsupported item type ${ItemType}`);
        continue;
      }

      if (!targetItem) {
        console.error(`[SYNC] Could not find matching item on ${targetServer.name}, skipping`);
        errorCount++;
        errors.push(`${targetServer.name}: Item not found`);
        continue;
      }

      console.log(`[SYNC] ✓ Confirmed match: ${targetItem.Name} (${targetItem.Id})`);

      // Sync based on event type
      if (NotificationType === 'PlaybackStop') {
        await updatePlaybackPosition(
          targetServer,
          targetUserId,
          targetItem.Id,
          webhookData.PlaybackPositionTicks || 0,
          webhookData.LastPlayedDate || webhookData.UtcTimestamp,
          webhookData.RunTimeTicks || 0,
          webhookData.Played || false  // Pass the Played status
        );
      } else if (NotificationType === 'UserDataSaved' && SaveReason === 'TogglePlayed') {
        // Update played/unplayed status
        await updatePlayedStatus(
          targetServer,
          targetUserId,
          targetItem.Id,
          webhookData.Played,
          webhookData.LastPlayedDate || webhookData.UtcTimestamp
        );
      } else if (NotificationType === 'UserDataSaved' && SaveReason === 'UpdateUserRating') {
        // Update favorite status
        await updateFavoriteStatus(
          targetServer,
          targetUserId,
          targetItem.Id,
          webhookData.Favorite
        );
      }

      console.log(`[SYNC] ✓ Sync to ${targetServer.name} completed successfully!`);
      successCount++;

    } catch (error) {
      // Check if error is network/offline related
      if (error.message.includes('ECONNREFUSED') ||
          error.message.includes('ETIMEDOUT') ||
          error.message.includes('ENOTFOUND') ||
          error.message.includes('EHOSTUNREACH')) {
        console.error(`[SYNC] ✗ ${targetServer.name} is offline or unreachable: ${error.message}`);
        offlineCount++;
        errors.push(`${targetServer.name}: Offline/unreachable`);
      } else {
        console.error(`[SYNC] ✗ Error syncing to ${targetServer.name}: ${error.message}`);
        errorCount++;
        errors.push(`${targetServer.name}: ${error.message}`);
      }
    }
  }

  console.log(`\n[SYNC] === Sync Summary ===`);
  console.log(`[SYNC] Success: ${successCount}, Errors: ${errorCount}, Offline: ${offlineCount}`);

  // Determine overall status
  if (successCount > 0 && errorCount === 0 && offlineCount === 0) {
    return { status: 'success' };
  } else if (offlineCount > 0 && errorCount === 0) {
    return { status: 'offline', errors };
  } else if (errorCount > 0) {
    return { status: 'error', errors };
  } else {
    return { status: 'partial', errors };
  }
}

module.exports = {
  processWebhook
};
