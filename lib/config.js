const fs = require('fs');
const path = require('path');

/**
 * Load and validate configuration
 */
function loadConfig(configPath) {
  try {
    const configData = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData);

    // Set defaults
    const port = config.port || 9500;
    const masterServer = config.masterServer || null;
    const fullResyncIntervalHours = config.fullResyncIntervalHours || 24;
    const fileRetentionHours = config.fileRetentionHours || 24;
    const cleanupIntervalHours = config.cleanupIntervalHours || 24;
    const cleanupEnabled = config.cleanupEnabled !== undefined ? config.cleanupEnabled : true;
    const syncUsers = config.syncUsers || [];
    const subscribers = config.subscribers || [];
    const fileCopy = config.fileCopy || null;

    return {
      port,
      masterServer,
      fullResyncIntervalHours,
      fileRetentionHours,
      cleanupIntervalHours,
      cleanupEnabled,
      syncUsers,
      subscribers,
      fileCopy
    };
  } catch (error) {
    console.error('Error loading config.json:', error.message);
    console.error('Using defaults');
    return {
      port: 9500,
      masterServer: null,
      fullResyncIntervalHours: 24,
      fileRetentionHours: 24,
      cleanupIntervalHours: 24,
      cleanupEnabled: true,
      syncUsers: [],
      subscribers: [],
      fileCopy: null
    };
  }
}

/**
 * Setup directory structure
 */
function setupDirectories(dataDir) {
  const dirs = {
    dataDir,
    processedDir: path.join(dataDir, 'processed'),
    errorDir: path.join(dataDir, 'error'),
    unsupportedDir: path.join(dataDir, 'unsupported'),
    offlineDir: path.join(dataDir, 'offline')
  };

  Object.values(dirs).forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  return dirs;
}

/**
 * Check if a user should be synced based on syncUsers config
 */
function shouldSyncUser(username, syncUsers) {
  // If syncUsers is empty or not set, sync all users
  if (!syncUsers || syncUsers.length === 0) {
    return true;
  }
  // Otherwise, only sync users in the list (case-insensitive)
  return syncUsers.some(u => u.toLowerCase() === username.toLowerCase());
}

/**
 * Get all servers except the specified one
 */
function getOtherServers(serverName, subscribers) {
  return subscribers.filter(s => s.name.toLowerCase() !== serverName.toLowerCase());
}

/**
 * Resolve the canonical (cross-server) username from a source username on a given server.
 *
 * - No userMap on source → return sourceUsername unchanged
 * - sourceUsername is a key in the map → return sourceUsername (it IS the canonical name)
 * - sourceUsername is a value in the map → return the corresponding key (reverse lookup)
 * - sourceUsername not in map at all → return null (all-or-nothing: user is not mapped)
 */
function resolveCanonicalUsername(sourceUsername, sourceServer) {
  const userMap = sourceServer.userMap;
  if (!userMap) return sourceUsername;
  if (Object.prototype.hasOwnProperty.call(userMap, sourceUsername)) return sourceUsername;
  const entry = Object.entries(userMap).find(([, v]) => v.toLowerCase() === sourceUsername.toLowerCase());
  if (entry) return entry[0];
  return null;
}

/**
 * Resolve the username to use on a target server for a given canonical username.
 *
 * - No userMap on target → return canonical unchanged
 * - canonical is a key in target's map → return the mapped value
 * - target has a map but canonical is not in it → return null (all-or-nothing)
 */
function resolveTargetUsername(canonicalUsername, targetServer) {
  const userMap = targetServer.userMap;
  if (!userMap) return canonicalUsername;
  if (Object.prototype.hasOwnProperty.call(userMap, canonicalUsername)) return userMap[canonicalUsername];
  return null;
}

/**
 * For same-server sync: given the source username on a server, return the partner username.
 *
 * - sourceUsername is a key → partner is the value
 * - sourceUsername is a value → partner is the key (two-way)
 * - not in map → return null
 */
function resolveSameServerPartner(sourceUsername, server) {
  const userMap = server.userMap;
  if (!userMap) return null;
  if (Object.prototype.hasOwnProperty.call(userMap, sourceUsername)) return userMap[sourceUsername];
  const entry = Object.entries(userMap).find(([, v]) => v.toLowerCase() === sourceUsername.toLowerCase());
  if (entry) return entry[0];
  return null;
}

module.exports = {
  loadConfig,
  setupDirectories,
  shouldSyncUser,
  getOtherServers,
  resolveCanonicalUsername,
  resolveTargetUsername,
  resolveSameServerPartner
};
