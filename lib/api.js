const http = require('http');
const https = require('https');

/**
 * Make an HTTP/HTTPS request
 */
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;

    // Merge headers
    const headers = {
      'Accept': 'application/json',
      ...options.headers
    };

    const requestOptions = {
      ...options,
      headers,
      maxRedirects: 0 // Don't follow redirects
    };

    const req = protocol.request(url, requestOptions, (res) => {
      // Handle redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        reject(new Error(`HTTP ${res.statusCode}: Redirect detected. Check API key and URL.`));
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch (e) {
            resolve(data);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }

    req.end();
  });
}

/**
 * Make an authenticated request to a Jellyfin server
 */
function serverRequest(server, path, options = {}) {
  const url = `${server.url}${path}`;
  return makeRequest(url, {
    ...options,
    headers: {
      'Authorization': `MediaBrowser Token="${server.apiKey}"`,
      ...options.headers
    }
  });
}

/**
 * Get item details from Jellyfin
 */
async function getItemDetails(server, userId, itemId) {
  try {
    return await serverRequest(server, `/Users/${userId}/Items/${itemId}`);
  } catch (error) {
    console.error(`[API] Error getting item details for ${itemId}:`, error.message);
    return null;
  }
}

/**
 * Get user by name from server
 */
async function getUserByName(server, username) {
  try {
    const users = await serverRequest(server, '/Users');
    const user = users.find(u => u.Name === username);
    if (user) {
      console.log(`[API] Found user ${username} with ID ${user.Id}`);
      return user.Id;
    }
    console.warn(`[API] User ${username} not found on ${server.name}`);
    return null;
  } catch (error) {
    console.error('[API] Error getting users:', error.message);
    return null;
  }
}

/**
 * Get all users from a server
 */
async function getAllUsers(server) {
  try {
    const users = await serverRequest(server, '/Users');
    console.log(`[API] Found ${users.length} users on ${server.name}`);
    return users;
  } catch (error) {
    console.error(`[API] Error getting users from ${server.name}:`, error.message);
    return [];
  }
}

/**
 * Get all libraries for a user
 */
async function getUserLibraries(server, userId) {
  try {
    const response = await serverRequest(server, `/Users/${userId}/Views`);
    const libraries = response.Items || [];
    // Filter to only movies and tvshows libraries
    const mediaLibraries = libraries.filter(lib => {
      const collectionType = lib.CollectionType;
      return collectionType === 'movies' || collectionType === 'tvshows';
    });
    console.log(`[API] Found ${mediaLibraries.length} media libraries for user`);
    return mediaLibraries;
  } catch (error) {
    console.error(`[API] Error getting libraries:`, error.message);
    return [];
  }
}

/**
 * Get all watched/in-progress items for a user in a library
 */
async function getWatchedItems(server, userId, libraryId, libraryType) {
  const items = [];

  try {
    if (libraryType === 'movies') {
      // Get watched movies
      const watchedResponse = await serverRequest(server, `/Users/${userId}/Items?ParentId=${libraryId}&Filters=IsPlayed&IncludeItemTypes=Movie&Recursive=True&Fields=ProviderIds,UserDataLastPlayedDate,UserDataPlaybackPositionTicks`);
      items.push(...(watchedResponse.Items || []));

      // Get in-progress movies
      const inProgressResponse = await serverRequest(server, `/Users/${userId}/Items?ParentId=${libraryId}&Filters=IsResumable&IncludeItemTypes=Movie&Recursive=True&Fields=ProviderIds,UserDataLastPlayedDate,UserDataPlaybackPositionTicks`);
      items.push(...(inProgressResponse.Items || []));

    } else if (libraryType === 'tvshows') {
      // Get all shows
      const showsResponse = await serverRequest(server, `/Users/${userId}/Items?ParentId=${libraryId}&IncludeItemTypes=Series&Recursive=True&Fields=ProviderIds`);
      const shows = showsResponse.Items || [];

      // For each show, get watched/in-progress episodes
      for (const show of shows) {
        const episodesResponse = await serverRequest(server, `/Shows/${show.Id}/Episodes?userId=${userId}&Fields=ProviderIds,UserDataLastPlayedDate,UserDataPlaybackPositionTicks`);
        const episodes = episodesResponse.Items || [];

        // Filter to only watched or in-progress episodes
        const watchedEpisodes = episodes.filter(ep => {
          const userData = ep.UserData;
          return userData && (userData.Played || (userData.PlaybackPositionTicks && userData.PlaybackPositionTicks > 600000000));
        });

        items.push(...watchedEpisodes);
      }
    }

    console.log(`[API] Found ${items.length} watched/in-progress items in library`);
    return items;

  } catch (error) {
    console.error(`[API] Error getting watched items:`, error.message);
    return [];
  }
}

/**
 * Update playback position on target server
 */
async function updatePlaybackPosition(server, userId, itemId, positionTicks, lastPlayedDate, runTimeTicks, sourcePlayed) {
  const path = `/Users/${userId}/Items/${itemId}/UserData`;

  // Check if source item was already marked as played
  // If so, trust that over calculating percentage
  let isFullyWatched = sourcePlayed || false;
  let playedPercentage = 0;
  let resetPosition = false;

  if (!isFullyWatched && runTimeTicks && runTimeTicks > 0) {
    playedPercentage = (positionTicks / runTimeTicks) * 100;

    // Mark as fully watched if played over 90%
    if (playedPercentage >= 90) {
      isFullyWatched = true;
      console.log(`[API] Item played ${playedPercentage.toFixed(1)}% - marking as fully watched (>= 90%)`);
    } else if (playedPercentage < 5) {
      // Reset position if less than 5% (user rewound/restarted)
      resetPosition = true;
      console.log(`[API] Item played ${playedPercentage.toFixed(1)}% - resetting position (< 5%)`);
    } else {
      console.log(`[API] Item played ${playedPercentage.toFixed(1)}%`);
    }
  } else if (isFullyWatched) {
    console.log(`[API] Source item marked as played - syncing as fully watched`);
  }

  const body = {
    PlaybackPositionTicks: (isFullyWatched || resetPosition) ? 0 : positionTicks,
    Played: isFullyWatched,
    PlayCount: isFullyWatched ? 1 : 0,
    LastPlayedDate: lastPlayedDate || new Date().toISOString()
  };

  console.log(`[API] Calling: POST ${server.url}${path}`);
  console.log(`[API] Body:`, JSON.stringify(body, null, 2));

  try {
    const response = await serverRequest(server, path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });

    if (isFullyWatched) {
      console.log(`[API] ✓ Marked as fully watched`);
    } else if (resetPosition) {
      console.log(`[API] ✓ Reset playback position to 0`);
    } else {
      console.log(`[API] ✓ Updated playback position to ${positionTicks} ticks`);
    }
    console.log(`[API] Response:`, response);
  } catch (error) {
    console.error('[API] ✗ Error updating playback position:', error.message);
    throw error;
  }
}

/**
 * Update played status on target server
 */
async function updatePlayedStatus(server, userId, itemId, played, lastPlayedDate) {
  const path = `/Users/${userId}/Items/${itemId}/UserData`;

  const body = {
    Played: played,
    PlayCount: played ? 1 : 0,
    PlaybackPositionTicks: 0,
    LastPlayedDate: lastPlayedDate || new Date().toISOString()
  };

  console.log(`[API] Calling: POST ${server.url}${path}`);
  console.log(`[API] Body:`, JSON.stringify(body, null, 2));

  try {
    const response = await serverRequest(server, path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });

    console.log(`[API] ✓ Marked as ${played ? 'played' : 'unplayed'}`);
    console.log(`[API] Response:`, response);
  } catch (error) {
    console.error('[API] ✗ Error updating played status:', error.message);
    throw error;
  }
}

/**
 * Update favorite status on target server
 */
async function updateFavoriteStatus(server, userId, itemId, favorite) {
  const path = `/Users/${userId}/Items/${itemId}/UserData`;

  const body = {
    IsFavorite: favorite
  };

  console.log(`[API] Calling: POST ${server.url}${path}`);
  console.log(`[API] Body:`, JSON.stringify(body, null, 2));

  try {
    const response = await serverRequest(server, path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });

    console.log(`[API] ✓ ${favorite ? 'Added to' : 'Removed from'} favorites`);
    console.log(`[API] Response:`, response);
  } catch (error) {
    console.error('[API] ✗ Error updating favorite status:', error.message);
    throw error;
  }
}

module.exports = {
  makeRequest,
  getItemDetails,
  getUserByName,
  getAllUsers,
  getUserLibraries,
  getWatchedItems,
  updatePlaybackPosition,
  updatePlayedStatus,
  updateFavoriteStatus
};
