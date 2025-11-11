const path = require('path');
const { loadConfig, setupDirectories } = require('./lib/config');
const { createWebhookServer, watchWebhooks } = require('./lib/webhookReceiver');
const { performFullSync, scheduleFullSync } = require('./lib/fullSync');

// ============================================================================
// MAIN APPLICATION
// ============================================================================

async function start() {
  console.log('='.repeat(60));
  console.log('JellySync - Jellyfin Multi-Server Sync');
  console.log('='.repeat(60));

  // Load configuration
  const configPath = path.join(__dirname, 'config.json');
  const config = loadConfig(configPath);

  // Setup directories
  const dataDir = path.join(__dirname, 'data');
  const dirs = setupDirectories(dataDir);

  // Create and start webhook receiver
  const server = createWebhookServer(config.port, dirs.dataDir);
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`[WEBHOOK] Receiver listening on port ${config.port}`);
    console.log(`[WEBHOOK] Saving webhooks to: ${dirs.dataDir}`);
  });

  // Start webhook processor
  console.log(`[SYNC] Configured subscribers: ${config.subscribers.map(s => s.name).join(', ')}`);
  watchWebhooks(config, dirs);
  console.log('[SYNC] Ready to sync!');

  console.log('='.repeat(60));
  console.log('System ready - listening for webhooks and processing syncs');
  console.log('='.repeat(60));

  // Perform initial full sync if master server is configured
  if (config.masterServer) {
    console.log('\n[FULL-SYNC] Performing initial sync on startup...');
    await performFullSync(config);

    // Schedule periodic full syncs
    scheduleFullSync(config);
  } else {
    console.log('\n[FULL-SYNC] No master server configured - full sync disabled');
  }
}

// Start the application
start().catch(error => {
  console.error('Fatal error starting JellySync:', error);
  process.exit(1);
});
