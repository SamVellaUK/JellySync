const fs = require('fs');
const path = require('path');

/**
 * Prune files older than specified retention period from a directory
 * @param {string} directory - Directory path to prune
 * @param {number} retentionHours - Maximum age of files in hours
 * @returns {Object} - Statistics about pruned files
 */
function pruneDirectory(directory, retentionHours) {
  const now = Date.now();
  const maxAge = retentionHours * 60 * 60 * 1000; // Convert hours to milliseconds

  let pruned = 0;
  let kept = 0;
  let errors = 0;

  try {
    if (!fs.existsSync(directory)) {
      console.log(`[FileManager] Directory does not exist: ${directory}`);
      return { pruned: 0, kept: 0, errors: 0 };
    }

    const files = fs.readdirSync(directory);

    for (const file of files) {
      const filepath = path.join(directory, file);

      try {
        const stats = fs.statSync(filepath);

        // Skip directories
        if (stats.isDirectory()) {
          continue;
        }

        const fileAge = now - stats.mtime.getTime();

        if (fileAge > maxAge) {
          fs.unlinkSync(filepath);
          pruned++;
        } else {
          kept++;
        }
      } catch (err) {
        console.error(`[FileManager] Error processing file ${filepath}:`, err.message);
        errors++;
      }
    }
  } catch (err) {
    console.error(`[FileManager] Error reading directory ${directory}:`, err.message);
    errors++;
  }

  return { pruned, kept, errors };
}

/**
 * Prune old files from all data directories
 * @param {Object} dirs - Object containing directory paths
 * @param {number} retentionHours - Maximum age of files in hours (default: 24)
 */
function pruneOldFiles(dirs, retentionHours = 24) {
  console.log(`[FileManager] Starting file pruning (retention: ${retentionHours} hours)...`);

  const startTime = Date.now();
  const results = {
    total: { pruned: 0, kept: 0, errors: 0 }
  };

  // Prune all subdirectories
  const directoriesToPrune = [
    { name: 'processed', path: dirs.processedDir },
    { name: 'unsupported', path: dirs.unsupportedDir },
    { name: 'error', path: dirs.errorDir },
    { name: 'offline', path: dirs.offlineDir }
  ];

  for (const dir of directoriesToPrune) {
    const result = pruneDirectory(dir.path, retentionHours);
    results[dir.name] = result;
    results.total.pruned += result.pruned;
    results.total.kept += result.kept;
    results.total.errors += result.errors;

    if (result.pruned > 0 || result.errors > 0) {
      console.log(`[FileManager] ${dir.name}: pruned ${result.pruned}, kept ${result.kept}, errors ${result.errors}`);
    }
  }

  const duration = Date.now() - startTime;
  console.log(`[FileManager] Pruning complete in ${duration}ms - Total: pruned ${results.total.pruned}, kept ${results.total.kept}, errors ${results.total.errors}`);

  return results;
}

/**
 * Schedule periodic file pruning
 * @param {Object} config - Configuration object
 * @param {Object} dirs - Object containing directory paths
 */
function schedulePruning(config, dirs) {
  if (!config.cleanupEnabled) {
    console.log('[FileManager] File cleanup is disabled in configuration');
    return;
  }

  const retentionHours = config.fileRetentionHours || 24;
  const intervalHours = config.cleanupIntervalHours || 24;
  const intervalMs = intervalHours * 60 * 60 * 1000;

  console.log(`[FileManager] Scheduling file pruning every ${intervalHours} hours (retention: ${retentionHours} hours)`);

  // Run initial pruning immediately
  pruneOldFiles(dirs, retentionHours);

  // Schedule periodic pruning
  setInterval(() => {
    pruneOldFiles(dirs, retentionHours);
  }, intervalMs);
}

module.exports = {
  pruneDirectory,
  pruneOldFiles,
  schedulePruning
};
