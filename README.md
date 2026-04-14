# JellySync

JellySync automatically synchronizes watch status and playback progress between multiple Jellyfin servers. Stop watching on one server and seamlessly continue where you left off on another.

## What It Does

- Syncs playback position when you stop watching content
- Copies newly added media files from master server to a mirror destination
- Initial full sync on startup from master server to all other servers
- Periodic complete resync at configurable intervals
- Works with Movies and TV Episodes
- Supports multiple server topologies (bidirectional, one-way, custom)
- Optional user mapping between servers (different usernames, or two accounts on the same server)
- Runs in a single lightweight Docker container
- No database required

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
  "masterServer": "server1",
  "fullResyncIntervalHours": 24,
  "syncUsers": ["Alexa"],
  "subscribers": [
    {
      "name": "server1",
      "url": "http://SERVER_1_IP:8096",
      "apiKey": "YOUR_API_KEY_HERE",
      "syncEvents": ["PlaybackStop", "UserDataSaved"]
    },
    {
      "name": "server2",
      "url": "http://SERVER_2_IP:8096",
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
- `syncEvents` - Include this field only for servers that should send webhooks
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

By default, JellySync looks up users on target servers by the same username that triggered the event. User mapping lets you override this — either because usernames differ across servers, or because you want to sync between two different accounts on the same server.

### Cross-Server Username Mapping

If a user is called `Sam` on the master but `SamRemote` on a child server, add a `userMap` to that subscriber:

```json
{
  "name": "child-server",
  "url": "http://CHILD_IP:8096",
  "apiKey": "YOUR_API_KEY_HERE",
  "userMap": {
    "Sam": "SamRemote",
    "Family": "Family"
  }
}
```

**Important:** When `userMap` is defined on a subscriber, **every user** that should sync to that server must be listed. Any user not present in the map is skipped for that server. This means even users whose names are the same on both servers need an explicit entry (e.g. `"Family": "Family"`).

### Same-Server Account Mapping (e.g. Living Room ↔ Bedroom)

If you have two accounts on the same server and want them to share watch progress — for example a family-safe profile and an unrestricted profile — add `userMap` to the master subscriber itself:

```json
{
  "name": "Media",
  "url": "http://MASTER_IP:8096",
  "apiKey": "YOUR_API_KEY_HERE",
  "syncEvents": ["PlaybackStop", "UserDataSaved"],
  "userMap": {
    "LivingRoom": "Bedroom",
    "Bedroom": "LivingRoom"
  }
}
```

When `LivingRoom` stops playback, JellySync will also update `Bedroom`'s progress on the same server, and vice versa. This works safely because JellySync updates playback state via the Jellyfin API — those writes do not trigger new webhooks, so there is no risk of circular or cascading events.

## Sync Topologies

### Bidirectional (All Servers)

All servers send webhooks and receive updates. Configure webhooks on all servers.

**Use case:** Home server, remote server, and backup server all stay in sync

### One-Way (Master → Slaves)

Only master server sends webhooks. Slave servers receive updates but don't send them back. Use with `masterServer` configuration for initial and periodic full syncs.

**Use case:** Main server with read-only backup/archive servers

**Configuration:** Only configure webhooks on the master server. In `config.json`, only include `syncEvents` for the master and set `masterServer` to the master's name.

### Custom

Mix and match based on your needs by choosing which servers send webhooks.

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

- **User not found:** Create matching username on target server, or configure `userMap` on that subscriber if usernames differ
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
