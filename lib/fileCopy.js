const fs = require('fs');
const path = require('path');
const { makeRequest } = require('./api');

/**
 * Trigger a Jellyfin library refresh on a server
 */
async function triggerLibraryRefresh(server) {
  const url = `${server.url}/Library/Refresh?api_key=${server.apiKey}`;
  try {
    await makeRequest(url, { method: 'POST' });
    console.log(`[COPY] Library refresh triggered on ${server.name}`);
  } catch (error) {
    console.warn(`[COPY] Library refresh failed on ${server.name}: ${error.message}`);
  }
}

/**
 * Fetch the physical file path for an item from the Jellyfin API
 */
async function getItemPath(masterServer, itemId) {
  const url = `${masterServer.url}/Items/${itemId}?api_key=${masterServer.apiKey}`;
  try {
    const item = await makeRequest(url);
    return item.Path || null;
  } catch (error) {
    console.error(`[COPY] Failed to fetch item path from API for ${itemId}: ${error.message}`);
    return null;
  }
}

/**
 * Wait for a file to exist, retrying up to `retries` times
 */
async function waitForFile(sourcePath, retries, sleepMs) {
  for (let i = 0; i < retries; i++) {
    if (fs.existsSync(sourcePath)) return;
    console.log(`[COPY] Retry ${i + 1}/${retries}: waiting for source file: ${sourcePath}`);
    await new Promise(r => setTimeout(r, sleepMs));
  }
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source file missing after ${retries} retries: ${sourcePath}`);
  }
}

/**
 * Handle file copy triggered by an ItemAdded webhook from the master server.
 * Runs in the background (fire-and-forget).
 */
function handleFileCopy(webhookData, fileCopyConfig, masterServer, targetServers) {
  const itemId = webhookData.ItemId;
  const itemName = webhookData.Name || itemId;
  const delayMs = (fileCopyConfig.postCopyDelaySeconds || 0) * 1000;
  const retries = fileCopyConfig.retries || 5;
  const retrySleepMs = fileCopyConfig.retrySleepMs || 2000;
  const sourceRoot = (fileCopyConfig.sourceRoot || '').replace(/\/+$/, '');

  console.log(`[COPY] Item added: ${itemName}`);

  // Run in background — mirrors the shell script's background subshell (&)
  (async () => {
    try {
      if (delayMs > 0) {
        console.log(`[COPY] Waiting ${fileCopyConfig.postCopyDelaySeconds}s before copying...`);
        await new Promise(r => setTimeout(r, delayMs));
      }

      // Resolve source path — prefer webhook field, fall back to API lookup
      let sourcePath = webhookData.Path || null;
      if (!sourcePath) {
        console.log(`[COPY] Path not in webhook, looking up via API for item ${itemId}...`);
        sourcePath = await getItemPath(masterServer, itemId);
      }

      if (!sourcePath) {
        console.error(`[COPY] Could not determine source path for item ${itemId} — skipping`);
        return;
      }

      console.log(`[COPY] Source: ${sourcePath}`);

      // Build relative path by stripping sourceRoot prefix
      let relPath;
      if (sourceRoot && sourcePath.startsWith(sourceRoot + '/')) {
        relPath = sourcePath.slice(sourceRoot.length + 1);
      } else {
        relPath = path.basename(sourcePath);
        if (sourceRoot) {
          console.warn(`[COPY] Source path does not start with sourceRoot "${sourceRoot}", using filename only`);
        }
      }

      const destPath = path.join(fileCopyConfig.destRoot, relPath);
      console.log(`[COPY] Dest:   ${destPath}`);

      await waitForFile(sourcePath, retries, retrySleepMs);

      await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
      await fs.promises.copyFile(sourcePath, destPath);

      console.log(`[COPY] Copy completed: ${sourcePath} -> ${destPath}`);

      // Refresh library on subscriber servers only (master is already up to date)
      for (const server of targetServers) {
        await triggerLibraryRefresh(server);
      }
    } catch (error) {
      console.error(`[COPY] Copy failed: ${error.message}`);
    }
  })();
}

module.exports = { handleFileCopy };
