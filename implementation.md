# Jellyfin Multi-Server Sync System

This system synchronizes watch status and playback progress between multiple Jellyfin instances using webhooks and the Jellyfin API.

## Overview

JellySync is a single-container application that synchronizes watch status between multiple Jellyfin servers. It runs two processes:
1. **Webhook Receiver** - HTTP server that receives webhook events from Jellyfin instances and saves them to JSON files
2. **Sync Processor** - Watches for new webhook files and syncs the watch status to other Jellyfin instances

## Architecture

```
Jellyfin Server 1       Jellyfin Server 2       Jellyfin Server N
        |                      |                      |
        | webhook (optional)   | webhook (optional)   | webhook (optional)
        v                      v                      v
                        JellySync Container
                        (Single Docker Container)
                                |
                    +-----------+-----------+
                    |                       |
            Webhook Receiver        Sync Processor
          (HTTP on port 9500)     (File Watcher)
                    |                       |
                    | saves to files        | watches directory
                    v                       v
                        /data/webhook-*.json
                                |
                                | processes & syncs
                                v
                Jellyfin API (UserData endpoint) on target servers
```

**Flexible Sync Topologies:**
- **Bidirectional (N-way)**: All servers send webhooks, all servers receive updates
- **One-to-Many (Master/Slave)**: One server sends webhooks, multiple servers receive updates
- **Many-to-One (Aggregation)**: Multiple servers send webhooks, one server receives updates
- **Custom**: Define any combination of webhook sources and sync targets

## Prerequisites

- One or more Jellyfin instances running
- Jellyfin Webhook Plugin installed on instances that will send webhooks
- Docker and Docker Compose
- API keys for all Jellyfin instances (both webhook sources and sync targets)

## Installation

### Quick Start (Using Pre-built Docker Images)

The easiest way to install - no building required:

1. **Download the docker-compose file and config template**
   ```bash
   mkdir jellysync && cd jellysync
   curl -O https://raw.githubusercontent.com/SamVellaUK/JellySync/main/docker-compose.hub.yml
   curl -O https://raw.githubusercontent.com/SamVellaUK/JellySync/main/config.json.template
   ```

2. **Create configuration file**
   ```bash
   cp config.json.template config.json
   nano config.json  # Edit with your server details
   ```

3. **Start the services**
   ```bash
   docker-compose -f docker-compose.hub.yml up -d
   ```

4. **Configure Jellyfin webhooks** (see below for detailed instructions)

### Alternative: Build from Source

If you prefer to build the images yourself:

1. **Clone the repository**
   ```bash
   git clone https://github.com/SamVellaUK/JellySync.git
   cd JellySync
   ```

2. **Create configuration file**
   ```bash
   cp config.json.template config.json
   nano config.json  # Edit with your server details
   ```

3. **Start the services (builds automatically)**
   ```bash
   docker-compose up -d
   ```

4. **Configure Jellyfin webhooks** (see below for detailed instructions)

### 1. Install Jellyfin Webhook Plugin

On both Jellyfin instances:
1. Go to Dashboard → Plugins → Catalog
2. Install "Webhook" plugin
3. Restart Jellyfin

### 2. Configure Webhook Plugin

On each Jellyfin instance **that should send webhooks** (can be all servers or just some):

1. Go to Dashboard → Plugins → Webhook
2. Click "Add Generic Destination"
3. Configure:
   - **Webhook Name**: `Sync Webhook`
   - **Webhook URL**: `http://YOUR_WEBHOOK_RECEIVER_IP:PORT/webhook` (use the port from config.json)
   - **Notification Type**: Select `PlaybackStop`
   - **User Filter**: Select users to sync (e.g., your username)
   - **Item Type**: Select `Episode`, `Movie`, etc.
4. Save

**Important Notes:**
- Use the same webhook receiver URL for all Jellyfin instances (it differentiates them by `ServerName`)
- Replace `PORT` with the value from your `config.json` (default is 9500)
- You don't need to configure webhooks on all servers - only on those that should trigger syncs
- For one-way sync (master → slaves), only configure webhooks on the master server
- For bidirectional sync, configure webhooks on all servers that participate

### 3. Project Structure

```
jellysync/
├── index.js                 # Combined webhook receiver and sync processor
├── config.json.template     # Configuration file template
├── config.json              # Configuration file (created by user, not tracked in git)
├── package.json             # Node.js dependencies
├── Dockerfile               # Docker image definition
├── docker-compose.yml       # Docker Compose configuration (builds from source)
├── docker-compose.hub.yml   # Docker Compose configuration (uses pre-built images)
├── data/                    # Webhook files directory
│   ├── processed/           # Successfully processed webhook files
│   ├── error/               # Failed PlaybackStop events (item not found, user not found, etc.)
│   ├── unsupported/         # Unsupported event types (not PlaybackStop)
│   ├── offline/             # Events where target subscriber was offline/unreachable
│   └── webhook-*.json       # Incoming webhook files
└── README.md                # This file
```

### 4. Configuration File

Create `config.json` from the template:

```bash
cp config.json.template config.json
```

Then edit `config.json` with your server details:

```json
{
  "port": 9500,
  "subscribers": [
    {
      "name": "server1",
      "url": "http://SERVER_1_IP:8096",
      "apiKey": "YOUR_API_KEY_HERE",
      "syncEvents": ["PlaybackStop"]
    },
    {
      "name": "server2",
      "url": "http://SERVER_2_IP:8096",
      "apiKey": "YOUR_API_KEY_HERE",
      "syncEvents": ["PlaybackStop"]
    },
    {
      "name": "server3",
      "url": "http://SERVER_3_IP:8096",
      "apiKey": "YOUR_API_KEY_HERE",
      "syncEvents": ["PlaybackStop"]
    }
  ]
}
```

**Configuration Fields:**
- `port` - Port for webhook receiver to listen on (optional, defaults to 9500)
- `subscribers[]` - Array of all Jellyfin servers (both webhook sources and sync targets)
- `subscribers[].name` - Friendly name for the server (must match the server name in Jellyfin Dashboard → General)
- `subscribers[].url` - Full URL including base path (e.g., `/jellyfin` if using reverse proxy)
- `subscribers[].apiKey` - API key (Dashboard → API Keys → Add) - required for all subscribers
- `subscribers[].syncEvents` - Array of webhook event types to sync from this server (optional, defaults to `["PlaybackStop"]`)

**Supported Sync Events:**
- `PlaybackStop` - Syncs playback position when user stops watching

**How It Works:**
- When a webhook is received from a server, it syncs to **all other subscribers** in the config
- You don't need to configure webhooks on all servers - only on those that should trigger syncs
- All subscribers in the config will receive updates (as long as they have valid API keys)

**Note:** The username is automatically extracted from the webhook data (`NotificationUsername`), so no user credentials are needed in the configuration.

### 5. Sync Topology Examples

Different use cases require different sync configurations:

#### Example 1: Bidirectional Sync (3 servers)
All servers send webhooks and receive playback position updates.

**config.json:**
```json
{
  "subscribers": [
    {
      "name": "home",
      "url": "http://192.168.1.10:8096",
      "apiKey": "...",
      "syncEvents": ["PlaybackStop"]
    },
    {
      "name": "remote",
      "url": "http://remote.example.com:8096",
      "apiKey": "...",
      "syncEvents": ["PlaybackStop"]
    },
    {
      "name": "backup",
      "url": "http://192.168.1.20:8096",
      "apiKey": "...",
      "syncEvents": ["PlaybackStop"]
    }
  ]
}
```

**Webhook Configuration:** Configure webhooks on all 3 servers

#### Example 2: Master → Slaves (One-way sync)
Only master server sends webhooks. Slaves receive updates but don't send them back.

**config.json:**
```json
{
  "subscribers": [
    {
      "name": "master",
      "url": "http://192.168.1.10:8096",
      "apiKey": "...",
      "syncEvents": ["PlaybackStop"]
    },
    {
      "name": "slave1",
      "url": "http://192.168.1.20:8096",
      "apiKey": "..."
    },
    {
      "name": "slave2",
      "url": "http://192.168.1.30:8096",
      "apiKey": "..."
    }
  ]
}
```

**Webhook Configuration:** Only configure webhook on "master" server

#### Example 3: Read-only Archive Server
Main server syncs playback position, archive server only receives (no webhook configured).

**config.json:**
```json
{
  "subscribers": [
    {
      "name": "main",
      "url": "http://192.168.1.10:8096",
      "apiKey": "...",
      "syncEvents": ["PlaybackStop"]
    },
    {
      "name": "archive",
      "url": "http://192.168.1.20:8096",
      "apiKey": "..."
    }
  ]
}
```

**Webhook Configuration:** Only configure webhook on "main" server → Archive receives all updates but never sends

#### Example 4: Custom Topology
Mix and match based on your needs by choosing which servers send webhooks.

### 6. Package.json

Create `package.json`:

```json
{
  "name": "jellyfin-webhooks",
  "version": "1.0.0",
  "description": "Jellyfin webhook receiver and sync processor",
  "main": "webhook-receiver.js",
  "scripts": {
    "start": "node webhook-receiver.js"
  },
  "dependencies": {}
}
```

### 6. Start the Services

The project includes a `docker-compose.yml` file, so you can start both services with:

```bash
docker-compose up -d
```

This will:
- Build both Docker images (webhook receiver and sync processor)
- Create a Docker network named `media`
- Start both containers with auto-restart enabled
- Mount the `./data` directory for webhook files
- Mount your `config.json` as read-only

**Notes:**
- If you change the port in `config.json`, update the port mapping in `docker-compose.yml` to match (e.g., `"8080:8080"` if you set `"port": 8080`)
- The `data/` directory will be created automatically
- Both containers will restart automatically unless explicitly stopped

### 7. Verify Service

Check that the container is running:

```bash
# View container status
docker-compose ps

# View logs (shows both webhook receiver and sync processor)
docker-compose logs -f jellysync

# Test webhook receiver is responding
curl http://localhost:9500
```

## Implementation Code

### webhook-receiver.js

Complete implementation of the webhook receiver:

```javascript
const http = require('http');
const fs = require('fs');
const path = require('path');

// Load configuration
const configPath = path.join(__dirname, 'config.json');
let config;

try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
  console.error('Error loading config.json:', error.message);
  console.error('Using default port 9500');
  config = { port: 9500 };
}

const PORT = config.port || 9500;
const DATA_DIR = path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

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

        // Fields to keep
        const allowedFields = [
          'ServerId', 'ServerName', 'NotificationType', 'Timestamp', 'UtcTimestamp',
          'Name', 'ItemId', 'ItemType', 'RunTimeTicks', 'SeriesName', 'SeriesId',
          'SeasonId', 'SeasonNumber000', 'EpisodeNumber000', 'Provider_tvdb',
          'Provider_imdb', 'Provider_tvrage', 'PlaybackPositionTicks',
          'PlaybackPosition', 'MediaSourceId', 'UserId', 'NotificationUsername',
          'LastActivityDate', 'LastPlaybackCheckIn', 'RemoteEndPoint'
        ];

        // Filter to only allowed fields
        const filteredData = {};
        allowedFields.forEach(field => {
          if (webhookData.hasOwnProperty(field)) {
            filteredData[field] = webhookData[field];
          }
        });

        // Create filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `webhook_${timestamp}.json`;
        const filepath = path.join(DATA_DIR, filename);

        // Write to file
        fs.writeFileSync(filepath, JSON.stringify(filteredData, null, 2));

        console.log(`Webhook received and saved to: ${filename}`);
        console.log(`Event: ${filteredData.NotificationType || 'Unknown'}`);

        // Send success response
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', file: filename }));
      } catch (error) {
        console.error('Error processing webhook:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: error.message }));
      }
    });
  } else if (req.method === 'GET') {
    // Health check endpoint
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Jellyfin Webhook Receiver is running');
  } else {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Webhook receiver listening on port ${PORT}`);
  console.log(`Saving webhooks to: ${DATA_DIR}`);
});
```

### sync-processor.js

Complete implementation of the sync processor (this is quite long):

```javascript
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Load configuration
const configPath = path.join(__dirname, 'config.json');
let userConfig;

try {
  userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
  console.error('Error loading config.json:', error.message);
  process.exit(1);
}

const CONFIG = {
  subscribers: userConfig.subscribers,
  dataDir: path.join(__dirname, 'data'),
  processedDir: path.join(__dirname, 'data', 'processed'),
  errorDir: path.join(__dirname, 'data', 'error'),
  unsupportedDir: path.join(__dirname, 'data', 'unsupported'),
  offlineDir: path.join(__dirname, 'data', 'offline')
};

// Ensure all directories exist
[CONFIG.processedDir, CONFIG.errorDir, CONFIG.unsupportedDir, CONFIG.offlineDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// HTTP request helper
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

// Find all other subscribers (exclude the source server)
function getOtherServers(serverName) {
  return CONFIG.subscribers.filter(s => s.name.toLowerCase() !== serverName.toLowerCase());
}

// Get full item details including provider IDs
async function getItemDetails(server, userId, itemId) {
  const url = `${server.url}/Users/${userId}/Items/${itemId}?api_key=${server.apiKey}`;

  try {
    const item = await makeRequest(url);
    return item;
  } catch (error) {
    console.error(`Error getting item details for ${itemId}:`, error.message);
    return null;
  }
}

// Search for episode on target server by name and provider IDs
async function findEpisode(targetServer, targetUserId, episodeName, providers) {
  console.log(`Searching for Episode "${episodeName}" on ${targetServer.name}`);
  console.log('Source episode provider IDs:', providers);

  // Search by episode name
  const searchUrl = `${targetServer.url}/Items?Recursive=true&IncludeItemTypes=Episode&SearchTerm=${encodeURIComponent(episodeName)}&api_key=${targetServer.apiKey}`;

  try {
    const result = await makeRequest(searchUrl);
    if (!result.Items || result.Items.length === 0) {
      console.error('No episodes found with that name');
      return null;
    }

    console.log(`Found ${result.Items.length} episode(s) with name "${episodeName}"`);

    // Filter by provider IDs for exact match
    for (let i = 0; i < result.Items.length; i++) {
      const item = result.Items[i];

      // Fetch full item details to get provider IDs
      const fullItem = await getItemDetails(targetServer, targetUserId, item.Id);
      if (!fullItem) {
        console.log(`Result ${i + 1}: ${item.SeriesName} - ${item.Name} (could not fetch details)`);
        continue;
      }

      const itemProviders = fullItem.ProviderIds || {};
      console.log(`Result ${i + 1}: ${fullItem.SeriesName} - ${fullItem.Name}`);
      console.log(`  Target provider IDs:`, itemProviders);

      // Check if any provider ID matches (case-insensitive)
      for (const [providerKey, providerId] of Object.entries(providers)) {
        const providerName = providerKey.replace('Provider_', '');

        // Find matching provider key in target (case-insensitive)
        const matchingKey = Object.keys(itemProviders).find(
          key => key.toLowerCase() === providerName.toLowerCase()
        );

        if (matchingKey && itemProviders[matchingKey] === providerId) {
          console.log(`✓ Matched using ${matchingKey} ID: ${providerId}`);
          console.log(`Found episode: ${fullItem.SeriesName} - ${fullItem.Name} (${fullItem.Id})`);
          return fullItem;
        }
      }
    }

    console.error('No exact match found using provider IDs');
    return null;

  } catch (error) {
    console.error('Error searching for episode:', error.message);
    return null;
  }
}

// Search for movie on target server by name and provider IDs
async function findMovie(targetServer, targetUserId, movieName, providers) {
  console.log(`Searching for Movie "${movieName}" on ${targetServer.name}`);
  console.log('Source movie provider IDs:', providers);

  // Search by movie name
  const searchUrl = `${targetServer.url}/Items?Recursive=true&IncludeItemTypes=Movie&SearchTerm=${encodeURIComponent(movieName)}&api_key=${targetServer.apiKey}`;

  try {
    const result = await makeRequest(searchUrl);
    if (!result.Items || result.Items.length === 0) {
      console.error('No movies found with that name');
      return null;
    }

    console.log(`Found ${result.Items.length} movie(s) with name "${movieName}"`);

    // Filter by provider IDs for exact match
    for (let i = 0; i < result.Items.length; i++) {
      const item = result.Items[i];

      // Fetch full item details to get provider IDs
      const fullItem = await getItemDetails(targetServer, targetUserId, item.Id);
      if (!fullItem) {
        console.log(`Result ${i + 1}: ${item.Name} (could not fetch details)`);
        continue;
      }

      const itemProviders = fullItem.ProviderIds || {};
      console.log(`Result ${i + 1}: ${fullItem.Name}`);
      console.log(`  Target provider IDs:`, itemProviders);

      // Check if any provider ID matches (case-insensitive)
      for (const [providerKey, providerId] of Object.entries(providers)) {
        const providerName = providerKey.replace('Provider_', '');

        // Find matching provider key in target (case-insensitive)
        const matchingKey = Object.keys(itemProviders).find(
          key => key.toLowerCase() === providerName.toLowerCase()
        );

        if (matchingKey && itemProviders[matchingKey] === providerId) {
          console.log(`✓ Matched using ${matchingKey} ID: ${providerId}`);
          console.log(`Found movie: ${fullItem.Name} (${fullItem.Id})`);
          return fullItem;
        }
      }
    }

    console.error('No exact match found using provider IDs');
    return null;

  } catch (error) {
    console.error('Error searching for movie:', error.message);
    return null;
  }
}

// Update playback position on target server (for stopped playback)
async function updatePlaybackPosition(server, userId, itemId, positionTicks, lastPlayedDate) {
  const url = `${server.url}/Users/${userId}/Items/${itemId}/UserData?api_key=${server.apiKey}`;

  const body = {
    PlaybackPositionTicks: positionTicks,
    LastPlayedDate: lastPlayedDate || new Date().toISOString()
  };

  console.log(`Calling API: POST ${url}`);
  console.log(`Body:`, JSON.stringify(body, null, 2));

  try {
    const response = await makeRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body
    });
    console.log(`✓ Updated playback position to ${positionTicks} ticks`);
    console.log(`API Response:`, response);
  } catch (error) {
    console.error('✗ Error updating playback position:', error.message);
  }
}

// Get or create matching user on target server
async function getUserByName(server, username) {
  const url = `${server.url}/Users?api_key=${server.apiKey}`;

  try {
    const users = await makeRequest(url);
    const user = users.find(u => u.Name === username);
    if (user) {
      console.log(`Found user ${username} with ID ${user.Id}`);
      return user.Id;
    }
    console.warn(`User ${username} not found on ${server.name}`);
    return null;
  } catch (error) {
    console.error('Error getting users:', error.message);
    return null;
  }
}

// Process a webhook event
async function processWebhook(webhookData) {
  const { NotificationType, ServerName, NotificationUsername, ItemType } = webhookData;

  console.log(`\n=== Processing ${NotificationType} ===`);
  console.log(`Item: ${webhookData.Name || webhookData.SeriesName}`);
  console.log(`User: ${NotificationUsername}`);
  console.log(`Server: ${ServerName}`);

  // Find source and target subscribers
  const sourceServer = CONFIG.subscribers.find(s => s.name.toLowerCase() === ServerName.toLowerCase());
  const targetServers = getOtherServers(ServerName);

  if (!sourceServer) {
    console.error(`Could not find source server: ${ServerName}`);
    return { status: 'error', reason: 'source_not_found' };
  }

  // Check if this server is configured to sync this event type
  const syncEvents = sourceServer.syncEvents || ['PlaybackStop'];
  if (!syncEvents.includes(NotificationType)) {
    console.log(`Event type ${NotificationType} not in syncEvents for ${ServerName}`);
    return { status: 'unsupported', reason: 'event_not_configured' };
  }

  // Check if this is a supported event type
  if (NotificationType !== 'PlaybackStop') {
    console.log(`Event type ${NotificationType} is not supported (only PlaybackStop is supported)`);
    return { status: 'unsupported', reason: 'unsupported_event_type' };
  }

  if (targetServers.length === 0) {
    console.error(`No target subscribers found (all subscribers must be different from ${ServerName})`);
    return { status: 'error', reason: 'no_targets' };
  }

  console.log(`Target servers: ${targetServers.map(s => s.name).join(', ')}`);

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

  // Sync to each target server
  for (const targetServer of targetServers) {
    console.log(`\n--- Syncing to ${targetServer.name} ---`);

    try {
      // Get user on target server
      const targetUserId = await getUserByName(targetServer, NotificationUsername);
      if (!targetUserId) {
        console.error(`Could not find user ${NotificationUsername} on ${targetServer.name}, skipping`);
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
        console.error(`Unsupported item type: ${ItemType}`);
        errorCount++;
        errors.push(`${targetServer.name}: Unsupported item type ${ItemType}`);
        continue;
      }

      if (!targetItem) {
        console.error(`Could not find matching item on ${targetServer.name}, skipping`);
        errorCount++;
        errors.push(`${targetServer.name}: Item not found`);
        continue;
      }

      console.log(`✓ Confirmed match: ${targetItem.Name} (${targetItem.Id})`);

      // Sync playback position
      if (NotificationType === 'PlaybackStop') {
        await updatePlaybackPosition(
          targetServer,
          targetUserId,
          targetItem.Id,
          webhookData.PlaybackPositionTicks || 0,
          webhookData.LastPlayedDate || webhookData.UtcTimestamp
        );
      }

      console.log(`✓ Sync to ${targetServer.name} completed successfully!`);
      successCount++;

    } catch (error) {
      // Check if error is network/offline related
      if (error.message.includes('ECONNREFUSED') ||
          error.message.includes('ETIMEDOUT') ||
          error.message.includes('ENOTFOUND') ||
          error.message.includes('EHOSTUNREACH')) {
        console.error(`✗ ${targetServer.name} is offline or unreachable: ${error.message}`);
        offlineCount++;
        errors.push(`${targetServer.name}: Offline/unreachable`);
      } else {
        console.error(`✗ Error syncing to ${targetServer.name}: ${error.message}`);
        errorCount++;
        errors.push(`${targetServer.name}: ${error.message}`);
      }
    }
  }

  console.log(`\n=== Sync Summary ===`);
  console.log(`Success: ${successCount}, Errors: ${errorCount}, Offline: ${offlineCount}`);

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

// Track files being processed to avoid race conditions
const processingFiles = new Set();

// Watch for new webhook files
function watchWebhooks() {
  console.log('Watching for webhooks...');

  fs.watch(CONFIG.dataDir, { persistent: true }, async (eventType, filename) => {
    if (!filename || !filename.endsWith('.json') || filename === 'processed') {
      return;
    }

    const filepath = path.join(CONFIG.dataDir, filename);

    // Check if already in any of the destination folders
    const processedPath = path.join(CONFIG.processedDir, filename);
    const errorPath = path.join(CONFIG.errorDir, filename);
    const unsupportedPath = path.join(CONFIG.unsupportedDir, filename);
    const offlinePath = path.join(CONFIG.offlineDir, filename);

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

      const result = await processWebhook(webhookData);

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
            console.log(`One or more subscribers offline: ${result.errors.join(', ')}`);
            break;
          case 'error':
          case 'partial':
            destPath = errorPath;
            destFolder = 'error';
            console.log(`Sync errors: ${result.errors.join(', ')}`);
            break;
          default:
            destPath = errorPath;
            destFolder = 'error';
            console.log(`Unknown status: ${result.status}`);
        }

        fs.renameSync(filepath, destPath);
        console.log(`Moved ${filename} to ${destFolder}/ folder`);
      }

    } catch (error) {
      console.error(`Error processing ${filename}:`, error.message);

      // Move to error folder if processing failed
      if (fs.existsSync(filepath)) {
        const errorPath = path.join(CONFIG.errorDir, filename);
        fs.renameSync(filepath, errorPath);
        console.log(`Moved ${filename} to error/ folder (processing exception)`);
      }
    } finally {
      // Remove from processing set
      processingFiles.delete(filename);
    }
  });
}

// Start
async function start() {
  console.log('Jellyfin Sync Processor Starting...');
  console.log(`Configured subscribers: ${CONFIG.subscribers.map(s => s.name).join(', ')}`);

  watchWebhooks();
  console.log('Ready to sync!');
}

start();
```

## Component Details

### Webhook Receiver (webhook-receiver.js)

HTTP server that receives webhook POST requests from Jellyfin.

**Endpoint:** `POST /webhook`

**Process:**
1. Receives webhook POST request
2. Filters webhook data to include only allowed fields
3. Saves filtered data to `data/webhook-{timestamp}.json`
4. Returns 200 OK

**Allowed Fields:**
- `ServerId`, `ServerName` - Server identification
- `NotificationType` - Event type (PlaybackStop, ItemMarkedPlayed, etc.)
- `Timestamp`, `UtcTimestamp` - Event timestamps
- `Name`, `ItemId`, `ItemType` - Item identification
- `RunTimeTicks` - Total duration
- `SeriesName`, `SeriesId`, `SeasonId`, `SeasonNumber000`, `EpisodeNumber000` - Episode metadata
- `Provider_tvdb`, `Provider_imdb`, `Provider_tvrage` - External IDs
- `PlaybackPositionTicks`, `PlaybackPosition` - Playback progress
- `MediaSourceId` - Media source
- `UserId`, `NotificationUsername` - User identification
- `LastActivityDate`, `LastPlaybackCheckIn` - Activity timestamps
- `RemoteEndPoint` - Client IP

### Sync Processor (sync-processor.js)

Watches for new webhook files and syncs watch status to the other Jellyfin instance.

**Main Process:**

1. **Watch Directory** - Monitors `data/` for new `webhook-*.json` files
2. **Validate Event** - Checks if event type is supported (PlaybackStop)
3. **Filter Events** - Only processes events in `syncEvents` config
4. **Find Target Subscribers** - Determines which subscribers to sync to (not the source server)
5. **Match Item** - Finds matching item on each target subscriber
6. **Sync Status** - Updates watch status on target subscribers
7. **Handle Results** - Moves file to appropriate folder based on outcome:
   - `processed/` - All subscribers synced successfully
   - `error/` - Failed to sync (user not found, item not found, etc.)
   - `unsupported/` - Event type not supported or not configured
   - `offline/` - One or more subscribers unreachable

**Error Handling:**

The sync processor categorizes failures into different folders:

- **processed/** - Successful syncs to all target subscribers
- **error/** - Sync failures due to:
  - User not found on target subscriber
  - Item not found on target subscriber (missing provider IDs or no match)
  - Unsupported item type (not Episode or Movie)
  - API errors (invalid API key, permission issues, etc.)
- **unsupported/** - Events that cannot be processed:
  - Event type not in `syncEvents` config
  - Event type not supported by system (only PlaybackStop is supported)
- **offline/** - Network/connectivity issues:
  - Subscriber unreachable (ECONNREFUSED)
  - Network timeout (ETIMEDOUT)
  - DNS resolution failure (ENOTFOUND)
  - Host unreachable (EHOSTUNREACH)

**Retry Strategy:**

Files in the `offline/` folder can be automatically retried by moving them back to `data/`:
```bash
mv /path/to/data/offline/*.json /path/to/data/
```

Files in the `error/` folder should be investigated before retrying, as they likely indicate configuration issues or missing content.

## Jellyfin API Reference

All API calls use API key authentication via query parameter.

### Search for Items

**Endpoint:** `GET /Items`

**Query Parameters:**
- `Recursive=true` - Search all libraries
- `IncludeItemTypes=Episode` - Filter by item type
- `SearchTerm=The+Chosen+One%21` - Search query (URL encoded)
- `api_key=YOUR_API_KEY` - API key for authentication

**Example URL:**
```
http://SERVER_IP:8096/Items?Recursive=true&IncludeItemTypes=Episode&SearchTerm=The%20Chosen%20One!&api_key=YOUR_API_KEY
```

**Response:**
```json
{
  "Items": [
    {
      "Name": "The Chosen One!",
      "Id": "item-id-123",
      "Type": "Episode",
      "SeriesName": "Avatar: The Last Airbender"
    }
  ],
  "TotalRecordCount": 1
}
```

**Note:** Search results do NOT include ProviderIds - must fetch full item details separately.

### Get Item Details

**Endpoint:** `GET /Users/{userId}/Items/{itemId}`

**Query Parameters:**
- `api_key=YOUR_API_KEY` - API key for authentication

**Example URL:**
```
http://SERVER_IP:8096/Users/user-id/Items/item-id?api_key=YOUR_API_KEY
```

**Response:**
```json
{
  "Name": "The Chosen One!",
  "Id": "item-id-123",
  "Type": "Episode",
  "ProviderIds": {
    "Tvdb": "123456",
    "Imdb": "tt1234567"
  },
  "SeriesName": "Avatar: The Last Airbender",
  "SeasonNumber": 1,
  "IndexNumber": 5
}
```

**Usage:** Called for each search result to get provider IDs for matching.

### Update User Data (Playback Position & Watch Status)

**Endpoint:** `POST /Users/{userId}/Items/{itemId}/UserData`

**Query Parameters:**
- `api_key=YOUR_API_KEY` - API key for authentication

**Headers:**
```
Content-Type: application/json
```

**Request Body (PlaybackStop):**
```json
{
  "PlaybackPositionTicks": 19876565,
  "LastPlayedDate": "2025-11-07T12:34:56.789Z"
}
```

**Response:** Empty (204 No Content on success)

**Usage:** Single endpoint for updating all user data (playback position, watched status, play count).

## Complex Logic Explained

### Item Matching Algorithm

The sync processor needs to find the same episode/movie on the target server. This is complex because items have different IDs on different servers.

**Process:**

1. **Extract Metadata** from webhook:
   - Item name (e.g., "The Chosen One!")
   - Provider IDs (TVDB, IMDB, etc.)
   - Item type (Episode, Movie, etc.)

2. **Search by Name** on target server:
   - Use `/Items` endpoint with `SearchTerm` parameter
   - Filter by `IncludeItemTypes` to match item type
   - Returns list of potential matches

3. **Fetch Full Details** for each search result:
   - Search results don't include provider IDs
   - Must call `/Users/{userId}/Items/{itemId}` for each result
   - This returns full item details including `ProviderIds`

4. **Match by Provider IDs** (case-insensitive):
   - Compare webhook provider IDs with item provider IDs
   - Webhook has format: `Provider_tvdb`, `Provider_imdb`
   - Item details have format: `Tvdb`, `Imdb` (no "Provider_" prefix)
   - Match using case-insensitive comparison:
     ```javascript
     // Extract provider name from webhook key
     const providerName = webhookKey.replace('Provider_', ''); // "tvdb"

     // Find matching key in item (case-insensitive)
     const matchingKey = Object.keys(itemProviders).find(
       key => key.toLowerCase() === providerName.toLowerCase()
     );

     // Compare values
     if (matchingKey && itemProviders[matchingKey] === providerId) {
       // Match found!
     }
     ```

5. **Return Matched Item** or null if no match found

**Why This Approach:**
- Simple name search first (fast, reduces API calls)
- Provider ID matching ensures exact match (same episode/movie)
- Case-insensitive comparison handles API inconsistencies
- Handles scenarios where multiple items have similar names

### Event Processing

The sync processor currently handles one event type:

**PlaybackStop:**
- User stopped watching before completion
- Sync playback position to target server
- Allows resuming from same position on other server
- Sets `PlaybackPositionTicks` and `LastPlayedDate`

### File Processing and Cleanup

**File Lifecycle:**

1. **Creation** - Webhook receiver creates `webhook-{timestamp}.json`
2. **Detection** - Sync processor detects new file (via fs.watch)
3. **Processing** - File is read and processed
4. **Archival** - Moved to `data/processed/` directory
5. **Persistence** - Kept for debugging/history

**Why This Approach:**
- Decouples webhook reception from processing
- Survives restarts (files persist)
- Easy to debug (inspect webhook files)
- Can reprocess files (move from processed back to data)
- No database needed

### Multi-Server Sync

The system can sync to multiple servers simultaneously.

**How It Works:**

1. Jellyfin instances (configured with webhooks) send events to receiver
2. Webhook includes `ServerName` to identify source server
3. Sync processor finds all target servers (where name != source)
4. Syncs to all target servers in parallel (not back to source)

**Loop Prevention:**
- When a server receives a sync update, it may trigger a webhook
- That webhook is processed and syncs to all OTHER servers
- This creates eventual consistency across all servers
- Files are moved to `processed/` immediately after processing to prevent re-processing

**Example Flow (3 servers with bidirectional sync):**
1. User watches episode on Server A
2. Server A sends webhook → saved to file
3. Sync processor reads file, syncs to Server B AND Server C
4. Both servers update (each triggers webhook) → saved to files
5. Sync processor processes Server B's webhook → syncs to A and C
6. Sync processor processes Server C's webhook → syncs to A and B
7. All servers end up with consistent state

## Troubleshooting

### Check JellySync Container

```bash
# View logs (includes both webhook receiver and sync processor output)
docker logs -f jellysync

# Test webhook endpoint
curl -X POST http://YOUR_WEBHOOK_RECEIVER_IP:9500/webhook \
  -H "Content-Type: application/json" \
  -d '{"test":"data"}'

# Check webhook files
ls -la /path/to/jellysync/data/

# Check processed files
ls -la /path/to/jellysync/data/processed/

# Check error files
ls -la /path/to/jellysync/data/error/

# Check unsupported events
ls -la /path/to/jellysync/data/unsupported/

# Check offline failures
ls -la /path/to/jellysync/data/offline/
```

### Common Issues

**Webhook not received:**
- Check Jellyfin webhook plugin configuration
- Verify URL is correct: `http://YOUR_WEBHOOK_RECEIVER_IP:9500/webhook`
- Check JellySync container is running: `docker ps | grep jellysync`
- Check network connectivity from Jellyfin to JellySync
- View logs for webhook receiver errors: `docker logs jellysync | grep WEBHOOK`

**Files in error/ folder:**
- **User not found** - User doesn't exist on target subscriber with same username
  - Create matching user on target subscriber
  - Or check `NotificationUsername` in webhook file
- **Item not found** - Content doesn't exist on target subscriber or provider IDs don't match
  - Verify item exists on target subscriber
  - Check provider IDs match: `cat /path/to/data/error/webhook-*.json | grep Provider`
  - Review sync processor logs for matching details
- **Unsupported item type** - Item is not Episode or Movie
  - System only supports Episodes and Movies currently
- **API errors** - Invalid API key or permission issues
  - Verify API key is correct in config.json
  - Check API key has necessary permissions

**Files in offline/ folder:**
- Subscriber unreachable or network issues
- Check if subscriber is running: `curl http://SUBSCRIBER_IP:8096/`
- Check network connectivity from sync processor to subscriber
- Verify subscriber URL in config.json is correct
- These files can be retried once subscriber is back online (see Maintenance section)

**Files in unsupported/ folder:**
- Event type is not PlaybackStop
- Either webhook plugin is configured to send other events, or event type is not in `syncEvents` config
- Review event type: `cat /path/to/data/unsupported/webhook-*.json | grep NotificationType`
- If event should be processed, add it to `syncEvents` in config.json (note: only PlaybackStop is currently supported)

**Playback position not syncing:**
- Check which folder the webhook file ended up in (processed, error, offline, unsupported)
- Review sync processor logs for detailed error messages
- Verify all subscribers are reachable and configured correctly

## Testing

### Test Webhook Reception

1. Play a video on one Jellyfin instance
2. Stop playback
3. Check webhook file created: `ls /path/to/jellyfin-webhooks/data/`
4. View webhook contents: `cat /path/to/jellyfin-webhooks/data/webhook-*.json`

### Test Sync Processing

1. Watch sync processor logs: `docker logs -f jellyfin-sync-processor`
2. Webhook file should be detected
3. Item matching should succeed
4. API calls should complete
5. File should move to `processed/` directory
6. Check target server for synced playback position

### Manual API Testing

Use Postman or curl to test API endpoints:

```bash
# Update UserData (Playback Position)
curl -X POST "http://SERVER_IP:8096/Users/{userId}/Items/{itemId}/UserData?api_key=YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"PlaybackPositionTicks":19876565,"LastPlayedDate":"2025-11-07T12:00:00Z"}'
```

## Monitoring

### Log Files

**Webhook Receiver:**
- Shows incoming webhook requests
- Shows filtered webhook data
- Shows file save operations

**Sync Processor:**
- Shows file detection
- Shows item matching process
- Shows API calls and responses
- Shows sync completion

### Health Checks

```bash
# Check container running
docker ps | grep jellysync

# Check JellySync responding
curl http://YOUR_WEBHOOK_RECEIVER_IP:9500/

# Check webhook files being created
watch -n 1 'ls -lh /path/to/jellysync/data/'
```

## Maintenance

### Clear Processed Files

```bash
# Remove old processed files (successful syncs)
rm /path/to/jellyfin-webhooks/data/processed/webhook-*.json

# Remove old error files (after investigation)
rm /path/to/jellyfin-webhooks/data/error/webhook-*.json

# Remove old unsupported events
rm /path/to/jellyfin-webhooks/data/unsupported/webhook-*.json

# Remove old offline files (after retry)
rm /path/to/jellyfin-webhooks/data/offline/webhook-*.json
```

### Retry Failed Syncs

**Retry offline subscribers** (after subscriber is back online):
```bash
# Retry all offline events
mv /path/to/jellyfin-webhooks/data/offline/*.json \
   /path/to/jellyfin-webhooks/data/

# Or retry specific file
mv /path/to/jellyfin-webhooks/data/offline/webhook-2025-11-07T10-30-00-000Z.json \
   /path/to/jellyfin-webhooks/data/
```

**Retry error events** (after fixing the underlying issue):
```bash
# Example: After adding missing user or content
mv /path/to/jellyfin-webhooks/data/error/webhook-2025-11-07T10-30-00-000Z.json \
   /path/to/jellyfin-webhooks/data/
```

**Important:** The sync processor watches the `data/` directory and will automatically process files when they're moved back.

### Bulk Retry Operations

```bash
# Retry all failed events from last hour
find /path/to/jellyfin-webhooks/data/offline/ -name "*.json" -mmin -60 -exec mv {} /path/to/jellyfin-webhooks/data/ \;

# Retry all offline events older than 1 day (subscriber was down)
find /path/to/jellyfin-webhooks/data/offline/ -name "*.json" -mtime +1 -exec mv {} /path/to/jellyfin-webhooks/data/ \;
```

### Monitor Error Rates

```bash
# Count files in each folder
echo "Processed: $(ls /path/to/jellyfin-webhooks/data/processed/ | wc -l)"
echo "Errors: $(ls /path/to/jellyfin-webhooks/data/error/ | wc -l)"
echo "Offline: $(ls /path/to/jellyfin-webhooks/data/offline/ | wc -l)"
echo "Unsupported: $(ls /path/to/jellyfin-webhooks/data/unsupported/ | wc -l)"

# Check for recent errors
ls -lt /path/to/jellyfin-webhooks/data/error/ | head -10

# View specific error file
cat /path/to/jellyfin-webhooks/data/error/webhook-2025-11-07T10-30-00-000Z.json
```

### Update Configuration

```bash
# Edit config
nano /path/to/jellysync/config.json

# Restart JellySync
docker-compose restart jellysync
```

## Architecture Decision

### Single Container Design

JellySync uses a single container running both the webhook receiver and sync processor in one Node.js process.

**Benefits:**
- ✅ Simpler deployment (one container instead of two)
- ✅ Less resource overhead
- ✅ Fewer moving parts
- ✅ Easier to install with `docker pull`

**How it works:**
- Single `index.js` file starts both components
- HTTP server and file watcher run in the same process
- Logs are prefixed with `[WEBHOOK]` or `[SYNC]` for clarity

## Future Improvements

- **Database Storage** - Store sync history in database instead of files
- **Retry Logic** - Automatically retry failed syncs
- **Web UI** - Dashboard for monitoring sync status
- **Multiple Users** - Support syncing multiple users simultaneously
- **Conflict Resolution** - Handle conflicts when both servers have different watch states
- **Real-time Sync** - Use WebSocket for real-time updates instead of file watching
- **Selective Sync** - Configure which libraries/items to sync
- **Single Container Option** - Combine both components into one container for simpler deployments

## License

MIT

## Support

For issues and questions, check the logs first, then review this documentation.
