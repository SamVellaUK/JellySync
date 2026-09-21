const { getUserByName, updatePlaybackPosition, updatePlayedStatus, updateFavoriteStatus } = require('./api');
const { findEpisode, findMovie } = require('./matcher');
const { shouldSyncUser, getOtherServers, resolveCanonicalUsername, resolveTargetUsername, resolveSameServerPartner } = require('./config');
const { handleFileCopy } = require('./fileCopy');

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

  // Find source server
  const sourceServer = config.subscribers.find(s => s.name.toLowerCase() === ServerName.toLowerCase());

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

  // Handle ItemAdded — file copy from master to mirror, then refresh subscribers
  if (NotificationType === 'ItemAdded') {
    if (!config.fileCopy) {
      console.warn('[SYNC] ItemAdded received but no fileCopy block in config — skipping file copy');
      return { status: 'unsupported', reason: 'file_copy_not_configured' };
    }
    if (!config.fileCopy.enabled) {
      console.warn('[SYNC] ItemAdded received but fileCopy is disabled in config — skipping file copy');
      return { status: 'unsupported', reason: 'file_copy_not_enabled' };
    }
    if (!config.masterServer || ServerName.toLowerCase() !== config.masterServer.toLowerCase()) {
      console.log(`[SYNC] ItemAdded from non-master server "${ServerName}" — ignoring`);
      return { status: 'unsupported', reason: 'item_added_not_from_master' };
    }
    const targetServers = getOtherServers(ServerName, config.subscribers);
    handleFileCopy(webhookData, config.fileCopy, sourceServer, targetServers);
    return { status: 'success' };
  }

  // Resolve canonical username (handles mapped names — e.g. "samuel" on server2 → canonical "Sam")
  const canonicalUsername = resolveCanonicalUsername(NotificationUsername, sourceServer);
  if (canonicalUsername === null) {
    console.log(`[SYNC] User ${NotificationUsername} is not in ${ServerName}'s userMap, skipping`);
    return { status: 'unsupported', reason: 'user_not_in_source_map' };
  }

  // Check if user should be synced (against canonical name)
  if (!shouldSyncUser(canonicalUsername, config.syncUsers)) {
    console.log(`[SYNC] User ${canonicalUsername} not in syncUsers list, skipping`);
    return { status: 'unsupported', reason: 'user_not_in_sync_list' };
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

  // Build target list: all other servers, plus source server itself if it has a same-server mapping for this user
  const otherServers = getOtherServers(ServerName, config.subscribers);
  const hasSelfMapping = resolveSameServerPartner(NotificationUsername, sourceServer) !== null;
  const targetServers = hasSelfMapping ? [...otherServers, sourceServer] : otherServers;

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

  // Resolve which user(s) to update on each target server
  const syncTargets = [];
  for (const targetServer of targetServers) {
    if (targetServer.name.toLowerCase() === sourceServer.name.toLowerCase()) {
      // Same-server: sync to the partner account
      const partner = resolveSameServerPartner(NotificationUsername, sourceServer);
      if (partner !== null) syncTargets.push({ targetServer, targetUsername: partner });
      continue;
    }

    // Cross-server: map canonical name through this target's userMap
    const mapped = resolveTargetUsername(canonicalUsername, targetServer);
    if (mapped === null) {
      console.log(`[SYNC] User ${canonicalUsername} not in userMap for ${targetServer.name}, skipping`);
      continue;
    }
    syncTargets.push({ targetServer, targetUsername: mapped });

    // A userMap on the target can pair two accounts on that server (e.g. Family <-> Steve on the master).
    // Update the canonical account too, but only if it exists there: in a cross-server name mismatch
    // (canonical "Alice" -> "alice_remote") it doesn't, and that isn't an error.
    if (targetServer.userMap && mapped.toLowerCase() !== canonicalUsername.toLowerCase()) {
      syncTargets.push({ targetServer, targetUsername: canonicalUsername, optional: true });
    }
  }

  // Sync to each target user
  for (const { targetServer, targetUsername, optional } of syncTargets) {
    console.log(`\n[SYNC] --- Syncing to ${targetServer.name} (${targetUsername}) ---`);
    if (targetUsername !== NotificationUsername) {
      console.log(`[SYNC] User mapping: ${NotificationUsername} → ${targetUsername}`);
    }

    try {
      // Get user on target server
      const targetUserId = await getUserByName(targetServer, targetUsername);
      if (!targetUserId && optional) {
        console.log(`[SYNC] User ${targetUsername} does not exist on ${targetServer.name}, skipping`);
        continue;
      }
      if (!targetUserId) {
        console.error(`[SYNC] Could not find user ${targetUsername} on ${targetServer.name}, skipping`);
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
