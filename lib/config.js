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

    return {
      port,
      masterServer,
      fullResyncIntervalHours,
      fileRetentionHours,
      cleanupIntervalHours,
      cleanupEnabled,
      syncUsers,
      subscribers
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
      subscribers: []
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

module.exports = {
  loadConfig,
  setupDirectories,
  shouldSyncUser,
  getOtherServers
};
