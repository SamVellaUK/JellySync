# JellySync

JellySync automatically synchronizes watch status and playback progress between multiple Jellyfin servers. Stop watching on one server and seamlessly continue where you left off on another.

## What It Does

- Syncs playback position when you stop watching content
- Copies newly added media files from master server to a mirror destination
- Initial full sync on startup from master server to all other servers
- Periodic complete resync at configurable intervals
- Works with Movies and TV Episodes
- Supports user mapping for different usernames across servers and same-server cross-account sync
- Runs in a single lightweight Docker container
- No database required

> **Recommended topology:** one master server and one child server with matching usernames. Multi-server setups and complex user mapping topologies are supported but have not been extensively tested — take care when combining both.

## How It Works

1. When you stop watching content on any Jellyfin server, it sends a webhook to JellySync
2. JellySync finds the same content on your other servers (matching by IMDB/TVDB IDs)
3. Your playback position is updated on all other servers
4. Resume watching from where you left off on any server

## Prerequisites

- Docker and Docker Compose installed
- One or more Jellyfin servers (v10.8+)
- Jellyfin Webhook Plugin installed on servers that will send updates
- API keys for all Jellyfin servers

## Quick Start Installation

### 1. Download and Initial Setup

```bash
curl -O https://raw.githubusercontent.com/SamVellaUK/JellySync/main/docker-compose.hub.yml

# First run creates the config template
docker-compose -f docker-compose.hub.yml up -d
```

On first run, the container will create a `./jellysync/` directory with `config.json` and `data/` folder, then exit with instructions.

### 2. Configure Your Servers

Edit the generated config file:

```bash
nano jellysync/config.json
```

```json
{
  "port": 9500,
  "masterServer": "master",
  "fullResyncIntervalHours": 24,
  "syncUsers": ["Alice"],
  "subscribers": [
    {
      "name": "master",
      "url": "http://MASTER_IP:8096",
      "apiKey": "YOUR_API_KEY_HERE",
      "syncEvents": ["PlaybackStop", "UserDataSaved"]
    },
    {
      "name": "child",
      "url": "http://CHILD_IP:8096",
      "apiKey": "YOUR_API_KEY_HERE",
      "syncEvents": ["PlaybackStop", "UserDataSaved"]
    }
  ],
  "fileCopy": {
    "enabled": false,
    "sourceRoot": "/media",
    "postCopyDelaySeconds": 0,
    "retries": 5,
    "retrySleepMs": 2000
  }
}
```

**Configuration Notes:**
- `port` - Port for webhook receiver (default: 9500)
- `masterServer` - (Optional) Name of master server for full sync and file copy. If set, performs initial sync on startup and periodic resyncs
- `fullResyncIntervalHours` - (Optional) Hours between full resyncs (default: 24)
- `syncUsers` - (Optional) Array of usernames to sync. Leave empty `[]` to sync all users. Example: `["User1", "User2"]`
- `name` - Must match your server name in Jellyfin Dashboard → General
- `url` - Full URL including port and base path (if using reverse proxy)
- `apiKey` - Generate in Jellyfin: Dashboard → API Keys → Add
- `syncEvents` - Array of event types this server should send. Supported values: `PlaybackStop`, `UserDataSaved`, `ItemAdded`. Add `ItemAdded` on the master only when using file copy.
- `fileCopy` - (Optional) File copy settings — see [File Copy](#file-copy) section below

### 3. Restart JellySync

After editing your config, restart the container:

```bash
docker-compose -f docker-compose.hub.yml up -d
```

JellySync will now start and begin syncing!

### 4. Install Jellyfin Webhook Plugin

On each Jellyfin server that should send updates:

1. Go to Dashboard → Plugins → Catalog
2. Install "Webhook" plugin
3. Restart Jellyfin

### 5. Configure Webhook Plugin

On each Jellyfin server that should send updates:

1. Go to Dashboard → Plugins → Webhook
2. Click "Add Generic Destination"
3. Configure:
   - **Webhook Name**: `JellySync`
   - **Webhook URL**: `http://JELLYSYNC_IP:9500/webhook`
   - **Notification Type**: Select `PlaybackStop`, `UserDataSaved`
   - **User Filter**: Select users to sync
   - **Item Type**: Select `Episode`, `Movie`
4. Save

**Important:** Use the same webhook URL for all Jellyfin servers. JellySync identifies them by server name.

**If using File Copy:** On the master server only, add a second Generic Destination for `ItemAdded` events — see [File Copy](#file-copy) for the required template fields.

## Full Sync Feature

JellySync supports full synchronization from a master server to all other servers. This feature:

- **Initial Sync on Startup:** When JellySync starts, it performs a complete sync of all watch history from the master server to other servers
- **Periodic Resync:** Automatically performs full resyncs at configurable intervals (default: every 24 hours)
- **Smart Syncing:** Only updates items if the master server has a newer playback date, preventing overwriting of newer data

### How Full Sync Works

1. JellySync connects to the master server and retrieves all users
2. For each user, it gets all media libraries (movies and TV shows)
3. For each library, it retrieves all watched and in-progress items
4. Each item is matched on target servers using IMDB/TVDB/TMDB IDs
5. Playback positions are synced if the master server has newer data

### Configuring Full Sync

Set the `masterServer` field in `config.json` to the name of your primary server:

```json
{
  "masterServer": "Media",
  "fullResyncIntervalHours": 24,
  "subscribers": [...]
}
```

**Note:** If `masterServer` is not set or is null, full sync is disabled and JellySync operates in webhook-only mode.

## User Filtering

You can limit synchronization to specific users using the `syncUsers` configuration option. This applies to both webhook-triggered syncs and full resyncs.

### Sync All Users (Default)

Leave `syncUsers` empty to sync all users:

```json
{
  "syncUsers": []
}
```

### Sync Specific Users

Specify an array of usernames to sync only those users:

```json
{
  "syncUsers": ["Family", "Alexa"]
}
```

**Notes:**
- Username matching is case-insensitive
- Usernames must match exactly (except for case) across all servers
- If a webhook is received for a user not in the list, it will be moved to the `unsupported/` folder
- During full sync, users not in the list are skipped and logged

**Use Cases:**
- **Family Sharing:** Only sync specific family members' watch history, not guest accounts
- **Performance:** Reduce sync time and API calls by focusing on active users
- **Privacy:** Keep certain users' watch history separate between servers

## User Mapping

By default JellySync assumes usernames are identical on every server. If your usernames differ, or if you want to keep two accounts on the same server in sync, use the `userMap` option.

### Rules

- **All-or-nothing:** if `userMap` is defined on a subscriber, *every* user that syncs to or from that server must be explicitly listed. Any user not in the map is skipped (with a log message). There is no fallthrough to same-name behaviour.
- **Two-way:** mappings are automatically bidirectional. Defining `"Alice": "alice_remote"` means Alice→alice_remote when syncing *to* that server, and alice_remote→Alice when a webhook arrives *from* that server. You do not need to define the reverse.

### Cross-server username mismatch

If the user is called "Alice" on the master and "alice" on the child:

```json
"subscribers": [
  {
    "name": "master",
    "url": "http://MASTER_IP:8096",
    "apiKey": "...",
    "syncEvents": ["PlaybackStop", "UserDataSaved"]
  },
  {
    "name": "child",
    "url": "http://CHILD_IP:8096",
    "apiKey": "...",
    "syncEvents": ["PlaybackStop", "UserDataSaved"],
    "userMap": {
      "Alice": "alice"
    }
  }
]
```

`syncUsers` should list the canonical (master-side) username: `"syncUsers": ["Alice"]`.

### Same-server cross-account sync

To keep two accounts on the master server in sync with each other (e.g. a living room and a bedroom profile), add `userMap` to the **master subscriber itself**. This is only supported on the master server.

```json
"subscribers": [
  {
    "name": "master",
    "url": "http://MASTER_IP:8096",
    "apiKey": "...",
    "syncEvents": ["PlaybackStop", "UserDataSaved"],
    "userMap": {
      "LivingRoom": "Bedroom"
    }
  },
  {
    "name": "child",
    "url": "http://CHILD_IP:8096",
    "apiKey": "...",
    "syncEvents": ["PlaybackStop", "UserDataSaved"]
  }
]
```

When LivingRoom watches something, JellySync syncs to Bedroom on the master and to LivingRoom on the child. When Bedroom watches, it syncs to LivingRoom on the master and to LivingRoom on the child (LivingRoom is the canonical name, the key in the map). API-based writes do not fire Jellyfin webhooks, so there is no sync loop.

> **Note:** `syncUsers` should list both accounts if you want to filter: `"syncUsers": ["LivingRoom", "Bedroom"]`. Both will be matched correctly because of the two-way reverse lookup.

### Same-server mapping + shared users on child

If the master has a same-server mapping (`LivingRoom ↔ Bedroom`) **and** the child server also has both LivingRoom and Bedroom accounts, be aware of this limitation:

JellySync can only sync to **one** target username per server per event. Without a `userMap` on the child, all events sync to the canonical username (LivingRoom). Bedroom on the child will never be updated via the master's same-server mapping.

If you want child's Bedroom to be the sync target instead, add a `userMap` to the child:

```json
{
  "name": "child",
  "userMap": { "LivingRoom": "Bedroom" }
}
```

But then child's LivingRoom account won't receive updates. There is currently no way to fan a single event out to multiple users on the same target server. The simplest approach in this scenario is to ensure the child only has one account that should track the master's watch state.

### Multi-server topologies with user mapping

User mapping with more than two servers has not been thoroughly tested. If you need it, the mapping is applied per-subscriber independently, so in principle each server can have its own `userMap`. Proceed with caution and verify behaviour in your specific setup.

## Sync Topologies

### Recommended: Master + Child (Bidirectional)

The recommended and most tested setup. Both servers send webhooks and receive updates. The master server drives full syncs on startup and at regular intervals.

```json
{
  "masterServer": "master",
  "subscribers": [
    { "name": "master", "syncEvents": ["PlaybackStop", "UserDataSaved"], "..." : "..." },
    { "name": "child",  "syncEvents": ["PlaybackStop", "UserDataSaved"], "..." : "..." }
  ]
}
```

Configure webhooks on both servers pointing to the same JellySync URL.

### One-Way (Master → Child)

Only the master sends webhooks. The child receives updates but never triggers syncs. Useful for a read-only backup or archive server.

**Configuration:** Only configure webhooks on the master. Omit `syncEvents` from the child subscriber.

### Multiple Servers

More than two servers are supported — add additional subscribers to the array. However, user mapping with multiple servers has not been thoroughly tested. If all usernames are identical across every server, this works without any extra configuration. If usernames differ, treat multi-server + user mapping as experimental.

## Verifying Installation

```bash
# Check JellySync is running
docker ps | grep jellysync

# View logs
docker-compose logs -f jellysync

# Test webhook endpoint
curl http://localhost:9500
```

## Usage

Once configured, JellySync works automatically:

1. Watch content on any Jellyfin server
2. Stop playback
3. JellySync syncs your position to other servers (typically within seconds)
4. Resume on any server from where you left off

## Monitoring

Check sync status:

```bash
# View real-time logs
docker logs -f jellysync

# Check processed webhooks
ls -la ./jellysync/data/processed/

# Check for errors
ls -la ./jellysync/data/error/
ls -la ./jellysync/data/offline/
```

**Folders:**
- `jellysync/data/processed/` - Successfully synced events
- `jellysync/data/error/` - Failed syncs (user/content not found)
- `jellysync/data/offline/` - Target server unreachable (can be retried)
- `jellysync/data/unsupported/` - Events not configured for sync

## File Copy

JellySync can automatically copy newly added media files from the master Jellyfin server to each configured mirror destination, then trigger a library refresh on each server once its copy completes.

### How It Works

1. The master Jellyfin server fires an `ItemAdded` webhook to JellySync
2. JellySync resolves the file path — from the webhook if present, otherwise by querying the Jellyfin API using the `ItemId`
3. For each subscriber server that has a `destRoot` configured, the file is copied to that destination, preserving the folder structure relative to `sourceRoot`
4. A library refresh is triggered on each server immediately after its own copy completes

### Configuration

Add a `fileCopy` block to `config.json` and set `destRoot` on each subscriber that should receive copied files:

```json
"fileCopy": {
  "enabled": true,
  "sourceRoot": "/media",
  "postCopyDelaySeconds": 0,
  "retries": 5,
  "retrySleepMs": 2000
},
"subscribers": [
  {
    "name": "master",
    "url": "http://MASTER_IP:8096",
    "apiKey": "YOUR_API_KEY_HERE",
    "syncEvents": ["ItemAdded", "PlaybackStop", "UserDataSaved"]
  },
  {
    "name": "replica1",
    "url": "http://REPLICA_1_IP:8096",
    "apiKey": "YOUR_API_KEY_HERE",
    "destRoot": "/mirror1"
  },
  {
    "name": "replica2",
    "url": "http://REPLICA_2_IP:8096",
    "apiKey": "YOUR_API_KEY_HERE",
    "destRoot": "/mirror2"
  }
]
```

**`fileCopy` fields:**
- `enabled` - Set to `true` to activate file copy
- `sourceRoot` - The root path stripped to produce the relative path. E.g. with `sourceRoot: "/media"`, a file at `/media/movies/Foo (2023)/Foo.mkv` is copied to `{destRoot}/movies/Foo (2023)/Foo.mkv`
- `postCopyDelaySeconds` - Seconds to wait before copying (useful if the file needs time to finish writing)
- `retries` - Number of times to retry if the source file is not yet available
- `retrySleepMs` - Milliseconds between retries

**`destRoot` (per subscriber):**
- Add `destRoot` to any subscriber that should receive copied files
- Subscribers without `destRoot` are skipped for file copy but still participate in playback/watched syncs
- Each `destRoot` must be bind-mounted into the JellySync container

**Note:** `masterServer` must be set in `config.json` for file copy to work. Only `ItemAdded` events from the master server trigger a copy.

### Jellyfin Webhook Template

On the master Jellyfin server, add a second Generic Destination in the Webhook plugin configured for `ItemAdded` events. The minimum required fields are:

```json
{
  "NotificationType": "{{NotificationType}}",
  "ServerName": "{{ServerName}}",
  "Name": "{{Name}}",
  "ItemId": "{{ItemId}}",
  "ItemType": "{{ItemType}}"
}
```

JellySync uses the `ItemId` to look up the file path from the Jellyfin API automatically — no need to include the path in the template. Optionally you can include `"Path": "{{ItemPhysicalPath}}"` and JellySync will use it directly, skipping the API lookup.

### Docker Volumes

File copy requires bind-mounts for the source media and for each mirror destination in your Docker Compose file:

1. **Source media** — JellySync reads the file directly from disk, so the same media path that the master Jellyfin server uses must also be mounted into the JellySync container. Use the same host path and container path as your Jellyfin configuration so that the resolved file path is valid inside JellySync.

2. **Mirror destinations** — Each `destRoot` used in your subscriber config must be mounted into the container.

```yaml
volumes:
  - "/media-store/Media:/media:ro"   # source: same mount as master Jellyfin (read-only)
  - "/path/to/mirror1:/mirror1"      # destination for replica1
  - "/path/to/mirror2:/mirror2"      # destination for replica2
```

**Important:** The container path for the source mount must match the path Jellyfin reports in the `ItemPhysicalPath` field. If Jellyfin has `/media-store/Media` mounted as `/media`, then JellySync must also mount it as `/media`, and `sourceRoot` in config should be `/media`.

## Troubleshooting

### Playback position not syncing

1. Check JellySync logs: `docker logs jellysync`
2. Verify webhook files are created: `ls ./jellysync/data/`
3. Check which folder webhook ended up in (`processed/`, `error/`, `offline/`)
4. Ensure content exists on both servers with matching IMDB/TVDB IDs

### Files in error/ folder

- **User not found:** Create matching username on target server
- **Item not found:** Ensure content exists on target server with matching metadata
- **API errors:** Verify API key is correct and has permissions

### Files in offline/ folder

- Target server is unreachable
- Check network connectivity: `curl http://TARGET_SERVER_IP:8096/`
- Files can be retried: `mv ./jellysync/data/offline/*.json ./jellysync/data/`

## Updating JellySync

```bash
docker-compose -f docker-compose.hub.yml pull
docker-compose -f docker-compose.hub.yml up -d
```

## Alternative: Build from Source

```bash
git clone https://github.com/SamVellaUK/JellySync.git
cd JellySync

# First run creates config template
docker-compose up -d

# Edit the generated config
nano config.json

# Restart with your config
docker-compose up -d
```

## Support

For issues and questions, check the logs first:
```bash
docker logs -f jellysync
```

## License

MIT
