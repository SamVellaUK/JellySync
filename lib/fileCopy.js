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
function handleFileCopy(webhookData, fileCopyConfig, targetServers) {
  const sourcePath = webhookData.Path;
  if (!sourcePath) {
    console.warn('[COPY] ItemAdded webhook missing Path field - cannot copy. Ensure the Jellyfin webhook template includes "Path": "{{ItemPhysicalPath}}"');
    return;
  }

  // Build relative path by stripping sourceRoot prefix
  let relPath;
  const sourceRoot = (fileCopyConfig.sourceRoot || '').replace(/\/+$/, '');
  if (sourceRoot && sourcePath.startsWith(sourceRoot + '/')) {
    relPath = sourcePath.slice(sourceRoot.length + 1);
  } else {
    relPath = path.basename(sourcePath);
    if (sourceRoot) {
      console.warn(`[COPY] Source path does not start with sourceRoot "${sourceRoot}", using filename only`);
    }
  }

  const destPath = path.join(fileCopyConfig.destRoot, relPath);
  const delayMs = (fileCopyConfig.postCopyDelaySeconds || 0) * 1000;
  const retries = fileCopyConfig.retries || 5;
  const retrySleepMs = fileCopyConfig.retrySleepMs || 2000;

  console.log(`[COPY] Item added: ${webhookData.Name || path.basename(sourcePath)}`);
  console.log(`[COPY] Source: ${sourcePath}`);
  console.log(`[COPY] Dest:   ${destPath}`);

  // Run in background — mirrors the shell script's background subshell (&)
  (async () => {
    try {
      if (delayMs > 0) {
        console.log(`[COPY] Waiting ${fileCopyConfig.postCopyDelaySeconds}s before copying...`);
        await new Promise(r => setTimeout(r, delayMs));
      }

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
