const { getItemDetails, makeRequest } = require('./api');

/**
 * Search for episode on target server by name and provider IDs
 */
async function findEpisode(targetServer, targetUserId, episodeName, providers) {
  console.log(`[MATCHER] Searching for Episode "${episodeName}" on ${targetServer.name}`);
  console.log('[MATCHER] Source episode provider IDs:', providers);

  // Search by episode name
  const searchUrl = `${targetServer.url}/Items?Recursive=true&IncludeItemTypes=Episode&SearchTerm=${encodeURIComponent(episodeName)}&api_key=${targetServer.apiKey}`;

  try {
    const result = await makeRequest(searchUrl);
    if (!result.Items || result.Items.length === 0) {
      console.error('[MATCHER] No episodes found with that name');
      return null;
    }

    console.log(`[MATCHER] Found ${result.Items.length} episode(s) with name "${episodeName}"`);

    // Filter by provider IDs for exact match
    for (let i = 0; i < result.Items.length; i++) {
      const item = result.Items[i];

      // Fetch full item details to get provider IDs
      const fullItem = await getItemDetails(targetServer, targetUserId, item.Id);
      if (!fullItem) {
        console.log(`[MATCHER] Result ${i + 1}: ${item.SeriesName} - ${item.Name} (could not fetch details)`);
        continue;
      }

      const itemProviders = fullItem.ProviderIds || {};
      console.log(`[MATCHER] Result ${i + 1}: ${fullItem.SeriesName} - ${fullItem.Name}`);
      console.log(`[MATCHER]   Target provider IDs:`, itemProviders);

      // Check if any provider ID matches (case-insensitive)
      for (const [providerKey, providerId] of Object.entries(providers)) {
        const providerName = providerKey.replace('Provider_', '');

        // Find matching provider key in target (case-insensitive)
        const matchingKey = Object.keys(itemProviders).find(
          key => key.toLowerCase() === providerName.toLowerCase()
        );

        if (matchingKey && itemProviders[matchingKey] === providerId) {
          console.log(`[MATCHER] ✓ Matched using ${matchingKey} ID: ${providerId}`);
          console.log(`[MATCHER] Found episode: ${fullItem.SeriesName} - ${fullItem.Name} (${fullItem.Id})`);
          return fullItem;
        }
      }
    }

    console.error('[MATCHER] No exact match found using provider IDs');
    return null;

  } catch (error) {
    console.error('[MATCHER] Error searching for episode:', error.message);
    return null;
  }
}

/**
 * Search for movie on target server by name and provider IDs
 */
async function findMovie(targetServer, targetUserId, movieName, providers) {
  console.log(`[MATCHER] Searching for Movie "${movieName}" on ${targetServer.name}`);
  console.log('[MATCHER] Source movie provider IDs:', providers);

  // Search by movie name
  const searchUrl = `${targetServer.url}/Items?Recursive=true&IncludeItemTypes=Movie&SearchTerm=${encodeURIComponent(movieName)}&api_key=${targetServer.apiKey}`;

  try {
    const result = await makeRequest(searchUrl);
    if (!result.Items || result.Items.length === 0) {
      console.error('[MATCHER] No movies found with that name');
      return null;
    }

    console.log(`[MATCHER] Found ${result.Items.length} movie(s) with name "${movieName}"`);

    // Filter by provider IDs for exact match
    for (let i = 0; i < result.Items.length; i++) {
      const item = result.Items[i];

      // Fetch full item details to get provider IDs
      const fullItem = await getItemDetails(targetServer, targetUserId, item.Id);
      if (!fullItem) {
        console.log(`[MATCHER] Result ${i + 1}: ${item.Name} (could not fetch details)`);
        continue;
      }

      const itemProviders = fullItem.ProviderIds || {};
      console.log(`[MATCHER] Result ${i + 1}: ${fullItem.Name}`);
      console.log(`[MATCHER]   Target provider IDs:`, itemProviders);

      // Check if any provider ID matches (case-insensitive)
      for (const [providerKey, providerId] of Object.entries(providers)) {
        const providerName = providerKey.replace('Provider_', '');

        // Find matching provider key in target (case-insensitive)
        const matchingKey = Object.keys(itemProviders).find(
          key => key.toLowerCase() === providerName.toLowerCase()
        );

        if (matchingKey && itemProviders[matchingKey] === providerId) {
          console.log(`[MATCHER] ✓ Matched using ${matchingKey} ID: ${providerId}`);
          console.log(`[MATCHER] Found movie: ${fullItem.Name} (${fullItem.Id})`);
          return fullItem;
        }
      }
    }

    console.error('[MATCHER] No exact match found using provider IDs');
    return null;

  } catch (error) {
    console.error('[MATCHER] Error searching for movie:', error.message);
    return null;
  }
}

module.exports = {
  findEpisode,
  findMovie
};
