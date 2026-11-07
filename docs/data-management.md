# Data Management

Aether keeps the database, generated cache, private settings and upload staging
in its data directory, `./aether-data` by default. File-operation staging and
Trash remain on their media volumes.

This directory contains:

- the SQLite database and its temporary files
- thumbnails, browser-compatible image copies, video posters, preview clips,
  presentation renditions and animation atlases
- Aether-created backups
- `private.env`, including media-root paths and sign-in secrets
- a marker used to prevent maintenance commands from targeting the wrong folder
- a runtime lock while the server is active
- `tmp`, containing private per-process temporary work for native tools
- private upload staging and durable operation/recovery records

Existing source media stays in the folders listed in `AETHER_MEDIA_ROOTS`.
Indexing does not copy it into the data directory, and Aether's reset commands
do not delete it.

Presentation settings live in the database and are included in normal backups.
Restore accepts earlier supported schemas and upgrades them when the server
opens the restored database. Generated presentation files are optional cache;
they regenerate when absent. Keep the database when preserving saved highlights,
per-aspect framing, speed and loop preferences.
Returning to an older application version requires restoring a compatible backup;
do not point it at the upgraded database. A full rebuild discards these edits along
with other per-asset metadata. Selective resets are available in Settings and
advance revisions to reject stale editor saves.

## File Operations And Trash

Source media normally stays in its configured root. Explicit moves, renames and
Trash operations change those locations; presentation processors and scanners
remain read-only. Device uploads are temporarily staged under `uploads` in the
data directory. Cross-drive publication uses owned `.aether-staging` storage on
the destination volume. Trash bytes stay under `.aether-trash` on their media
root, with a default retention of 30 days.

Operation receipts and ownership metadata live in SQLite. Accepted server work
continues after a browser disconnect. Startup inspects unresolved boundaries;
it never deletes an unverified last copy or adopts an unknown reserved directory.
Journal commits use full synchronization, including macOS device-cache flushes,
before filesystem changes proceed.
Review Needs attention in Activity before retrying. Keep roots and all recorded
copies available during recovery. Do not recursively delete reserved storage or
remove its records to unblock the application.

An interrupted same-volume move can finish at startup or through **Check again**
when the retained original matches the journal and only its filesystem metadata
changed during rename. This includes **Move to Trash** operations left pending
by an earlier version. Keep the drive connected and Aether's managed folders
untouched; these operations do not require manually moving files or rebuilding
the library.

`data:status` reports unresolved operations, retained upload stages and Trash.
Rebuild, wipe and database restore refuse those blockers. Finish or cancel
transfers, and restore or explicitly purge Trash, before destructive maintenance.
A disconnected drive does not make its retained files safe to forget.

Database backups exclude source files, pending original copies and Trash bytes.
Back up the media volumes separately. Backup takes a writer fence at a recoverable
boundary and refuses unresolved transfers. Retained Trash descriptors and digests
are checked; a backup does not create a second copy of their bytes. Restoring a
backup with Trash requires the matching media payloads and root identities.
Historical file operations and upload sessions are not executed after restore;
a complete scan is required before writes are enabled again.

### Permanently Lost Media Volumes

If a media volume is permanently lost, stop Aether before acknowledging its
records. Check the blockers with `data:status`, then list their root, Trash and
operation IDs:

```bash
npm run data:recover -- --list
```

The list contains up to 100 records. If it returns `nextCursor`, continue with
`npm run data:recover -- --list --after NEXT_CURSOR`.

Select only records whose media cannot be recovered:

```bash
npm run data:recover -- --root-id ROOT_ID --trash-id TRASH_ID --confirm-lost-media
```

Repeat `--trash-id` or `--operation-id` to select up to 100 records from that
root. The command records the acknowledgement and releases only the selected
metadata blockers. It does not recover or delete media files. It refuses a
volume that is still available, uploads, transfers involving another root, and
records whose ownership cannot be verified. For an Empty Trash job, name its
operation ID and matching retained Trash IDs. Only pending items on the lost
root are acknowledged. Finish or cancel uploads and claimed operations on other
roots first. Acknowledgement cancels untouched queued work, including remaining
Empty Trash items on available roots, so the required scan can run. Their files,
Trash records and completed results remain; start a new action after the scan.
Unspecified Trash records remain. Resolve access errors or reconnect recoverable
drives instead.

Run `data:status` again and remove the permanently lost root from configuration.
Start Aether and complete a scan before enabling further file operations.
Unselected records continue to block destructive maintenance.

## Check The Data Directory

Run:

```bash
npm run data:status
```

The command reports the resolved path, validates the marker, and shows the
managed files it found, including temporary work and preserved restore state.
Use it before a rebuild, wipe, or manual move.

## Generated Files And Retention

A successful complete scan removes confirmed missing assets and their generated
files. It also retires derivatives whose recorded source version is obsolete.
Startup removes unfinished cache work, unreferenced files and retired
presentation keys before accepting requests. Active generation work is preserved
during normal scans; replacements publish only after checking the source again.

Native-tool temporary files use a private process directory under `tmp`, removed
on normal exit. Startup removes abandoned scopes only when their same-host
process is confirmed stopped, or their creation time proves they came from a
previous instance of the current PID after a restart. Live scopes, including an
online backup, and foreign-host scopes are preserved. Rebuild and wipe clear all
managed temporary
work while the server is stopped. Offline maintenance also refuses an active
backup; a backup started during maintenance stops before reading the database.
Foreign-host temporary scopes require checking that host before removing them.
Scopes whose PID belongs to another live process are retained conservatively,
even when that PID may have been reused.

The latest 20 finished scan jobs are kept. Expired sessions and stale sign-in
throttle records are pruned at startup and hourly. Comparison history remains
with the database because current rankings, Undo and safe request retries depend
on it; a ranking reset or confirmed removal of the related media clears it.

## Back Up The Database

```bash
npm run backup
```

The backup is written under `aether-data/backups`. It includes the database but
not `private.env`. Add `--include-cache` to include generated media such as
thumbnails, video previews, presentation renditions and animation atlases:

```bash
npm run backup -- --include-cache
```

Internal backups are assembled in a private process scope under `tmp` and
published only after their database and manifest are complete. Interrupted work
is cleaned with abandoned temporary scopes. External backup outputs remain
operator-managed.

Use `--keep` to retain only the newest Aether backup folders:

```bash
npm run backup -- --keep 14
```

Backups are otherwise retained until you remove them. Cache-inclusive backups
omit unfinished processor outputs and decoder scratch directories. They never
include the separate `tmp` directory.

An explicit external output directory is also supported:

```bash
npm run backup -- --output /path/to/aether-backups
```

An external backup is outside Aether's one-directory wipe. Remove it separately
when you no longer need it.

## Restore A Backup

Stop Aether, then point the restore command at one timestamped backup folder:

```bash
npm run data:restore -- --from ./aether-data/backups/aether-YYYYMMDD-HHMMSSsssZ --confirm-restore
```

The command verifies the backup manifest, file checksums, SQLite integrity, and
database references before replacing the current database. It holds the same
exclusive maintenance lock as rebuild and wipe, keeps the previous database
until the restored copy passes validation, and rolls back if the swap fails.
Every restore removes saved sessions and sign-in throttling from the backup, so
all devices must sign in again and old cookies cannot become active later.

If the backup includes generated cache files, they are restored. Otherwise the
old cache is cleared so it cannot be mistaken for data belonging to the restored
database. Source media and `private.env` are never replaced.

If the process stops during a restore swap, startup refuses to open the database
while previous recovery copies remain; it will not create an empty database over
that state. `data:status` reports `interruptedRestore: true`. Keep the preserved
files until you can inspect them or restore a verified backup. A successful
verified restore removes superseded recovery files. An explicit rebuild also
discards them along with the database. Abandoned staging copies with no preserved
previous state are removed at startup.

## Docker Commands

Use the compiled maintenance commands inside the running container:

```bash
docker compose exec aether node apps/server/dist/cli/data.js status
docker compose exec aether node apps/server/dist/cli/backup.js
```

Stop the service before a rebuild, then use a one-off container with the same
data mount:

```bash
export AETHER_UID="$(id -u)"
export AETHER_GID="$(id -g)"
docker compose stop
docker compose run --rm --no-deps --entrypoint node aether \
  apps/server/dist/cli/data.js rebuild --confirm-rebuild
docker compose start
```

Use the same stopped, one-off container pattern for a restore:

```bash
docker compose run --rm --no-deps --entrypoint node aether \
  apps/server/dist/cli/data.js restore \
  --from /data/backups/aether-YYYYMMDD-HHMMSSsssZ --confirm-restore
```

For a complete Docker wipe, run `docker compose down`, delete only the marked
`./aether-data` directory, and create a new protected `private.env` as described
in [Installation](installation.md). The separate `./media` mount is not part of
the wipe.

## Rebuild The Library

Use a rebuild when you want a new index and cache but want to keep the current
private settings:

```bash
# Stop Aether first.
npm run data:rebuild -- --confirm-rebuild
```

This removes the database, cache, temporary work, restore recovery copies and
Aether-created backups. It keeps
`private.env` and the data-directory marker, then creates empty managed folders.
The next start and scan build a new index from the source folders.

Scores, tags, favorites, comparison history, and sessions are part of the
database. They are lost unless you keep a backup.

## Wipe Everything Aether Manages

```bash
# Stop Aether first.
npm run data:wipe -- --confirm-wipe
```

This removes the entire data directory, including the database, cache, internal
backups, private settings, and secrets. You may instead delete the marked data
directory manually while Aether is stopped.

The command validates both the target and its marker. It refuses broad or unsafe
paths such as a filesystem root, home directory, project root, media root, or a
symlinked target. The same checks apply after resolving parent-directory aliases.

## Runtime Lock

`runtime.lock` prevents maintenance work while Aether is using the data
directory. Aether normally removes it on shutdown and automatically clears a
verifiably stale same-host lock. Acquiring a new lock also removes abandoned
heartbeat temporary files before its timer starts. Normal shutdown waits for
active processing, including work whose browser disconnected, before removing
the lock. After an abrupt container
stop reuses the same PID, the lock may require 60 seconds without a heartbeat
before recovery; this avoids taking a fresh lock from another process namespace.
If a command still reports a
lock, stop every Aether process or container and check `docker compose ps`. Remove
`aether-data/runtime.lock` manually only after you have confirmed that no Aether
server is running. A lock from another host is kept deliberately because this
machine cannot prove that the other server has stopped.

## What A Wipe Does Not Remove

A server wipe cannot clear data stored elsewhere. Check these places separately:

- browser history, browser cache, local and session storage, and saved downloads
- reverse-proxy, container, terminal, and operating-system logs
- external backups and old copies of the repository
- filesystem snapshots, device backups, and storage-controller remnants
- previews sent to an optional tag suggestion endpoint

Deleting source media followed by a successful scan removes its live database
record and Aether-managed derivatives. It is still not a promise of forensic
erasure from browsers, backups, logs, snapshots, or storage hardware.

## Moving The Data Directory

1. Stop Aether.
2. Move the complete marked directory as one unit.
3. Set `AETHER_DATA_DIR` in `.env.local` or the shell to the new path.
4. Run `npm run data:status`.
5. Start Aether and confirm the library before deleting any extra copy.

Do not split the database, cache, or backups across separate paths if you want a
single-directory reset.
