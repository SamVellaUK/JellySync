const http = require('http');
const fs = require('fs');
const path = require('path');
const { processWebhook } = require('./sync');

/**
 * Create HTTP server for receiving webhooks
 */
function createWebhookServer(port, dataDir) {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      let body = '';

      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', () => {
        try {
          // Parse the webhook data
          const webhookData = JSON.parse(body);

          // Create filename with timestamp
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const filename = `webhook_${timestamp}.json`;
          const filepath = path.join(dataDir, filename);

          // Write complete unfiltered webhook data to file
          fs.writeFileSync(filepath, JSON.stringify(webhookData, null, 2));

          console.log(`[WEBHOOK] Received and saved to: ${filename}`);
          console.log(`[WEBHOOK] Event: ${webhookData.NotificationType || 'Unknown'}`);

          // Send success response
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'success', file: filename }));
        } catch (error) {
          console.error('[WEBHOOK] Error processing webhook:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: error.message }));
        }
      });
    } else if (req.method === 'GET') {
      // Health check endpoint
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('JellySync is running');
    } else {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method not allowed');
    }
  });

  return server;
}

/**
 * Watch directory for new webhook files and process them
 */
function watchWebhooks(config, dirs) {
  console.log('[WEBHOOK] Watching for webhooks...');

  // Track files being processed to avoid race conditions
  const processingFiles = new Set();

  fs.watch(dirs.dataDir, { persistent: true }, async (eventType, filename) => {
    if (!filename || !filename.endsWith('.json') || filename === 'processed') {
      return;
    }

    const filepath = path.join(dirs.dataDir, filename);

    // Check if already in any of the destination folders
    const processedPath = path.join(dirs.processedDir, filename);
    const errorPath = path.join(dirs.errorDir, filename);
    const unsupportedPath = path.join(dirs.unsupportedDir, filename);
    const offlinePath = path.join(dirs.offlineDir, filename);

    // Check if already processing or already moved
    if (processingFiles.has(filename) ||
        fs.existsSync(processedPath) ||
        fs.existsSync(errorPath) ||
        fs.existsSync(unsupportedPath) ||
        fs.existsSync(offlinePath)) {
      return;
    }

    // Mark as processing
    processingFiles.add(filename);

    // Wait a bit to ensure file is fully written
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      // Check if file still exists (might have been moved already)
      if (!fs.existsSync(filepath)) {
        processingFiles.delete(filename);
        return;
      }

      // Read and process webhook
      const data = fs.readFileSync(filepath, 'utf8');
      const webhookData = JSON.parse(data);

      const result = await processWebhook(webhookData, config);

      // Move file based on result status
      if (fs.existsSync(filepath)) {
        let destPath;
        let destFolder;

        switch (result.status) {
          case 'success':
            destPath = processedPath;
            destFolder = 'processed';
            break;
          case 'unsupported':
            destPath = unsupportedPath;
            destFolder = 'unsupported';
            break;
          case 'offline':
            destPath = offlinePath;
            destFolder = 'offline';
            console.log(`[WEBHOOK] One or more subscribers offline: ${result.errors.join(', ')}`);
            break;
          case 'error':
          case 'partial':
            destPath = errorPath;
            destFolder = 'error';
            console.log(`[WEBHOOK] Sync errors: ${result.errors.join(', ')}`);
            break;
          default:
            destPath = errorPath;
            destFolder = 'error';
            console.log(`[WEBHOOK] Unknown status: ${result.status}`);
        }

        fs.renameSync(filepath, destPath);
        console.log(`[WEBHOOK] Moved ${filename} to ${destFolder}/ folder`);
      }

    } catch (error) {
      console.error(`[WEBHOOK] Error processing ${filename}:`, error.message);

      // Move to error folder if processing failed
      if (fs.existsSync(filepath)) {
        const errorPath = path.join(dirs.errorDir, filename);
        fs.renameSync(filepath, errorPath);
        console.log(`[WEBHOOK] Moved ${filename} to error/ folder (processing exception)`);
      }
    } finally {
      // Remove from processing set
      processingFiles.delete(filename);
    }
  });
}

module.exports = {
  createWebhookServer,
  watchWebhooks
};
