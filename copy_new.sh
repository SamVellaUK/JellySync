#!/bin/sh
# Copies only the single media file Radarr/Sonarr just finished with.
# test save

# -------- CONFIG --------
LOG_FILE="/scripts/copy_just_imported.log"  # Log file destination
DEST_ROOT="/mirror"         # inside the container (bind-mount to your remote share)
KEEP_STRUCTURE="true"       # "true" keeps relative folders; "false" flattens
RETRIES=5
SLEEP_SECS=2
POST_IMPORT_DELAY=60        # seconds to wait before copying, giving Radarr/Sonarr+local Jellyfin time to finish

# -------- JELLYFIN CONFIG --------
JELLYFIN_MEDIA_URL="http://192.168.1.133:8096/jellyfin"      # Base URL with path
JELLYFIN_MEDIA_API_KEY="038165bc7266406bb3a13e3deac007ac"

JELLYFIN_BAZZITE_URL="http://192.168.1.99:8096"      # Base URL without path
JELLYFIN_BAZZITE_API_KEY="8720cd08822f497abbe74a2a9062e046"
# ---------------------------------

# ------ END CONFIG ------

# Ensure log directory exists
LOG_DIR="$(dirname "$LOG_FILE")"
mkdir -p "$LOG_DIR" 2>/dev/null || {
  echo "[$(date '+%F %T')] ERROR: Cannot create log directory: $LOG_DIR" >&2
  exit 1
}

log() { echo "[$(date '+%F %T')] $*" >> "$LOG_FILE"; }

# Figure out which app and pick the right vars
SOURCE=""
REL=""
APP=""
EVENT=""

if [ -n "$radarr_eventtype" ]; then
  APP="Radarr"
  EVENT="$radarr_eventtype"
  if [ "$EVENT" = "Test" ]; then
    SOURCE="/movies/test-movies.txt"
    REL="Test Movie/test-movies.txt"
  else
    SOURCE="$radarr_moviefile_path"
    # Build a relative path that includes the movie folder:
    # e.g. "True Romance (1993)/True Romance (1993).mkv"
    MOVIE_NAME="$(basename "$radarr_movie_path")"
    REL="$MOVIE_NAME/$radarr_moviefile_relativepath"
  fi
elif [ -n "$sonarr_eventtype" ]; then
  APP="Sonarr"
  EVENT="$sonarr_eventtype"
  if [ "$EVENT" = "Test" ]; then
    SOURCE="/tv-shows/test-tv.txt"
    REL="Test Series/test-tv.txt"
  else
    SOURCE="$sonarr_episodefile_path"
    REL="$sonarr_episodefile_relativepath"
    # Build a relative path that includes the series folder:
    # e.g. "Star Trek/Season 01/Star Trek - S01E01.mkv"
    SERIES_NAME="$(basename "$sonarr_series_path")"
    REL="$SERIES_NAME/$sonarr_episodefile_relativepath"
  fi
fi

if [ -z "$APP" ] || [ -z "$SOURCE" ]; then
  log "Not invoked by Radarr/Sonarr or missing file path — ignoring."
  exit 0
fi

case "$EVENT" in
  Download|Upgrade|Rename|Test) : ;;
  *) log "$APP event '$EVENT' not handled. Exiting."; exit 0 ;;
esac

# Log test event
if [ "$EVENT" = "Test" ]; then
  log "[$APP] Test event received - will copy test file through full workflow"
fi

# Quick initial check - log warning if source doesn't exist yet
if ! [ -f "$SOURCE" ]; then
  log "WARNING: Source file not immediately available (will retry after delay): $SOURCE"
fi

# Build dest path
if [ "$KEEP_STRUCTURE" = "true" ] && [ -n "$REL" ]; then
  DEST="$DEST_ROOT/$REL"
else
  # just drop filename into DEST_ROOT
  BASENAME="$(basename "$SOURCE")"
  DEST="$DEST_ROOT/$BASENAME"
fi

(
  # Wait for local import and Jellyfin scan to complete before copying
  log "[$APP] Waiting ${POST_IMPORT_DELAY}s for local import to complete before copying..."
  sleep "$POST_IMPORT_DELAY"

  # Wait for source file to exist
  i=0
  while [ $i -lt $RETRIES ]; do
    if [ -f "$SOURCE" ]; then
      break
    fi
    log "Retry $((i+1))/$RETRIES: Waiting for source file: $SOURCE"
    i=$((i+1))
    sleep "$SLEEP_SECS"
  done

  if ! [ -f "$SOURCE" ]; then
    log "ERROR: Source file missing after $RETRIES retries: $SOURCE"
    exit 3
  fi

  # Ensure dest dir exists
  DEST_DIR="$(dirname "$DEST")"
  if ! mkdir -p "$DEST_DIR" 2>&1 | tee -a "$LOG_FILE"; then
    log "ERROR: Failed to create destination directory: $DEST_DIR"
    exit 4
  fi

  if cp -f -- "$SOURCE" "$DEST" 2>&1 | tee -a "$LOG_FILE"; then
    log "[$APP] Background copy completed: $SOURCE -> $DEST"

    # Trigger Jellyfin Media server refresh
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$JELLYFIN_MEDIA_URL/Library/Refresh?api_key=$JELLYFIN_MEDIA_API_KEY" 2>&1)
    if [ "$HTTP_CODE" = "204" ] || [ "$HTTP_CODE" = "200" ]; then
      log "Jellyfin Media refresh triggered successfully (HTTP $HTTP_CODE)"
    else
      log "WARNING: Jellyfin Media refresh failed (HTTP $HTTP_CODE, URL: $JELLYFIN_MEDIA_URL)"
    fi

    # Trigger Jellyfin Bazzite server refresh
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$JELLYFIN_BAZZITE_URL/Library/Refresh?api_key=$JELLYFIN_BAZZITE_API_KEY" 2>&1)
    if [ "$HTTP_CODE" = "204" ] || [ "$HTTP_CODE" = "200" ]; then
      log "Jellyfin Bazzite refresh triggered successfully (HTTP $HTTP_CODE)"
    else
      log "WARNING: Jellyfin Bazzite refresh failed (HTTP $HTTP_CODE, URL: $JELLYFIN_BAZZITE_URL)"
    fi
  else
    log "[$APP] ERROR: Background copy FAILED: $SOURCE -> $DEST"
    exit 5
  fi
) &
