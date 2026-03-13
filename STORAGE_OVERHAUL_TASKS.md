# User Data Storage Overhaul Tasks

## Goals
- Keep imported user files (PDF/local video) available across reloads.
- Preserve source/unit/review data with migrations and versioning.
- Improve reliability, performance, and recovery from partial writes.

## Phase 1 — Storage foundation
1. Introduce a storage version header in persisted app state (`schemaVersion`, `updatedAt`).
2. Add a migration registry (`v1 -> v2 -> ...`) and run it in `hydratePersistedState`.
3. Move from one giant `localStorage` blob to a repository interface (`storage.load()`, `storage.save()`).
4. Implement write throttling/debouncing for high-frequency UI updates (timer, notes).

## Phase 2 — Binary asset persistence
1. Add IndexedDB store for file blobs (`assets` table keyed by `assetId`).
2. Save uploaded PDF/local video bytes into IndexedDB on import.
3. Store `assetId` in source records instead of transient `blob:` URLs.
4. Resolve viewer origin at runtime by creating object URLs from IndexedDB blobs.
5. Revoke object URLs when viewer unmounts or source is deleted.

## Phase 3 — Data model hardening
1. Split persisted entities by domain: `sources`, `hierarchy`, `units`, `reviews`, `revisions`, `settings`.
2. Add stable foreign-key checks on load (drop or repair dangling references).
3. Add source metadata checksum fields (for imported files) and integrity status.
4. Add review append-only log mode and derived aggregates.

## Phase 4 — UX and reliability
1. Add "Storage health" panel in Settings:
   - schema version
   - counts per entity
   - total DB size estimate
   - migration status
2. Add explicit export/import backup:
   - JSON-only backup (metadata)
   - full backup (metadata + binary assets)
3. Add recovery flow for missing assets:
   - prompt to relink file
   - allow replacing stale asset while preserving source/unit IDs

## Phase 5 — Testing and observability
1. Add migration unit tests with fixtures for old schema versions.
2. Add storage integration tests (save/load/restore with IndexedDB).
3. Add corruption simulation tests (truncated payloads, missing stores).
4. Add lightweight telemetry logs to diagnose storage failures.

## Immediate bug backlog items
1. Add a one-click "relink source file" action on viewer errors when a stored asset is missing.
2. Add a visible import progress indicator while writing large assets to IndexedDB.
3. Add background cleanup for orphaned assets not referenced by any source.
