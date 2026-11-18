import type { AetherDatabase } from "../db/database.js";
import {
  defaultPresentationValues,
  canonicalPresentationValues,
  mediaPresentation,
  presentationRenditionKeys,
  normalizedAspectFraming,
  type MediaPresentation,
  type PresentationValues
} from "./presentation.js";

interface PresentationRow {
  asset_id: string;
  aspect_framing: string;
  feed_framing: string;
  highlights: string;
  main_highlight_id: string | null;
  revision: number;
  highlight_start_ms: number | null;
  highlight_end_ms: number | null;
  fit: PresentationValues["fit"];
  focal_x: number;
  focal_y: number;
  zoom: number;
  playback_rate: number;
  loop_mode: PresentationValues["loopMode"];
}

const SAVED_FRAMING_EDITS = `EXISTS (
  SELECT 1 FROM json_each(highlights)
  WHERE json_extract(value, '$.fit') != 'auto'
    OR json_extract(value, '$.focalX') != 0.5
    OR json_extract(value, '$.focalY') != 0.5
    OR json_extract(value, '$.zoom') != 1
    OR COALESCE(json_extract(value, '$.aspectFraming'), '{}') != '{}'
    OR COALESCE(json_extract(value, '$.feedFraming'), '{}') != '{}'
)`;
const FRAMING_EDITS = `fit != 'auto' OR focal_x != 0.5 OR focal_y != 0.5 OR zoom != 1 OR aspect_framing != '{}' OR feed_framing != '{}' OR ${SAVED_FRAMING_EDITS}`;

export class PresentationConflictError extends Error {
  constructor() {
    super("The presentation was changed by another request.");
    this.name = "PresentationConflictError";
  }
}

export function getPresentationsByAssetId(
  db: AetherDatabase,
  assets: Array<{ id: string; mtimeMs: number; sizeBytes: number }>
): Map<string, MediaPresentation> {
  const result = new Map<string, MediaPresentation>();
  for (let offset = 0; offset < assets.length; offset += 400) {
    const batch = assets.slice(offset, offset + 400);
    const placeholders = batch.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT * FROM asset_presentations WHERE asset_id IN (${placeholders})`
      )
      .all(...batch.map((asset) => asset.id)) as PresentationRow[];
    const byId = new Map(rows.map((row) => [row.asset_id, row]));
    for (const asset of batch) {
      const row = byId.get(asset.id);
      result.set(
        asset.id,
        mediaPresentation(
          asset,
          row ? rowValues(row) : undefined,
          row?.revision
        )
      );
    }
  }
  return result;
}

export function saveAssetPresentation(
  db: AetherDatabase,
  input: {
    assetId: string;
    expectedRevision: number;
    values: PresentationValues;
    sourceMtimeMs: number;
    sourceSizeBytes: number;
    updatedAt: string;
  }
): boolean {
  return db.transaction(() => {
    const source = db
      .prepare(
        "SELECT mtime_ms, size_bytes FROM assets WHERE id = ? AND lifecycle = 'active'"
      )
      .get(input.assetId) as
      { mtime_ms: number; size_bytes: number } | undefined;
    if (!source) return false;
    if (
      source.mtime_ms !== input.sourceMtimeMs ||
      source.size_bytes !== input.sourceSizeBytes
    ) {
      throw new PresentationConflictError();
    }
    const current = db
      .prepare("SELECT * FROM asset_presentations WHERE asset_id = ?")
      .get(input.assetId) as PresentationRow | undefined;
    if ((current?.revision ?? 0) !== input.expectedRevision) {
      throw new PresentationConflictError();
    }
    const values = canonicalPresentationValues(
      input.values,
      current ? rowValues(current) : undefined
    );
    const keys = presentationRenditionKeys(
      {
        id: input.assetId,
        mtimeMs: source.mtime_ms,
        sizeBytes: source.size_bytes
      },
      values
    );
    const obsolete = obsoletePresentationDerivativeFiles(
      db,
      input.assetId,
      keys
    );
    const removeDerivative = db.prepare(
      "DELETE FROM derivatives WHERE asset_id = ? AND path = ?"
    );
    for (const derivative of obsolete)
      removeDerivative.run(input.assetId, derivative.path);
    db.prepare(
      `INSERT INTO asset_presentations
      (asset_id, revision, highlight_start_ms, highlight_end_ms, fit, focal_x, focal_y, zoom, playback_rate, loop_mode, updated_at, aspect_framing, feed_framing, highlights, main_highlight_id)
      VALUES (@assetId, @revision, @startMs, @endMs, @fit, @focalX, @focalY, @zoom, @playbackRate, @loopMode, @updatedAt, @aspectFraming, @feedFraming, @highlights, @mainHighlightId)
      ON CONFLICT(asset_id) DO UPDATE SET
        revision = excluded.revision,
        highlight_start_ms = excluded.highlight_start_ms,
        highlight_end_ms = excluded.highlight_end_ms,
        fit = excluded.fit, focal_x = excluded.focal_x, focal_y = excluded.focal_y,
        zoom = excluded.zoom, playback_rate = excluded.playback_rate,
        loop_mode = excluded.loop_mode, updated_at = excluded.updated_at,
        aspect_framing = excluded.aspect_framing, feed_framing = excluded.feed_framing,
        highlights = excluded.highlights, main_highlight_id = excluded.main_highlight_id`
    ).run({
      assetId: input.assetId,
      revision: input.expectedRevision + 1,
      startMs: values.highlight?.startMs ?? null,
      endMs: values.highlight?.endMs ?? null,
      fit: values.fit,
      focalX: values.focalX,
      focalY: values.focalY,
      zoom: values.zoom,
      aspectFraming: JSON.stringify(
        normalizedAspectFraming(values.aspectFraming)
      ),
      feedFraming: JSON.stringify(values.feedFraming ?? {}),
      highlights: JSON.stringify(values.highlights ?? []),
      mainHighlightId: values.mainHighlightId ?? null,
      playbackRate: values.playbackRate,
      loopMode: values.loopMode,
      updatedAt: input.updatedAt
    });
    return true;
  })();
}

export function countPresentationEdits(db: AetherDatabase): {
  playback: number;
  framing: number;
} {
  const row = db
    .prepare(
      `SELECT
    COALESCE(SUM(highlight_start_ms IS NOT NULL OR playback_rate != 1 OR loop_mode != 'repeat' OR json_array_length(highlights) > 0), 0) AS playback,
    COALESCE(SUM(${FRAMING_EDITS}), 0) AS framing
    FROM asset_presentations`
    )
    .get() as { playback: number; framing: number };
  return row;
}

export function resetPresentationEdits(
  db: AetherDatabase,
  options: { playback?: boolean; framing?: boolean },
  updatedAt: string
): void {
  const defaults = defaultPresentationValues();
  const assignments: string[] = [];
  const changed: string[] = [];
  if (options.playback) {
    assignments.push(
      "highlight_start_ms = NULL",
      "highlight_end_ms = NULL",
      "highlights = '[]'",
      "main_highlight_id = NULL",
      `playback_rate = ${defaults.playbackRate}`,
      "loop_mode = 'repeat'"
    );
    changed.push(
      "highlight_start_ms IS NOT NULL OR playback_rate != 1 OR loop_mode != 'repeat' OR json_array_length(highlights) > 0"
    );
  }
  if (options.framing) {
    assignments.push(
      "fit = 'auto'",
      "focal_x = 0.5",
      "focal_y = 0.5",
      "zoom = 1",
      "aspect_framing = '{}'",
      "feed_framing = '{}'"
    );
    if (!options.playback)
      assignments.push(`highlights = (SELECT json_group_array(json_set(value,
        '$.fit', 'auto', '$.focalX', 0.5, '$.focalY', 0.5, '$.zoom', 1,
        '$.aspectFraming', json('{}'), '$.feedFraming', json('{}')))
        FROM json_each(highlights))`);
    changed.push(FRAMING_EDITS);
  }
  if (assignments.length === 0) return;
  db.prepare(
    `UPDATE asset_presentations SET ${assignments.join(", ")}, revision = revision + 1, updated_at = ?
    WHERE ${changed.map((condition) => `(${condition})`).join(" OR ")}`
  ).run(updatedAt);
}

function rowValues(row: PresentationRow): PresentationValues {
  return {
    highlight:
      row.highlight_start_ms === null || row.highlight_end_ms === null
        ? null
        : { startMs: row.highlight_start_ms, endMs: row.highlight_end_ms },
    aspectFraming: JSON.parse(
      row.aspect_framing
    ) as PresentationValues["aspectFraming"],
    feedFraming: JSON.parse(
      row.feed_framing
    ) as PresentationValues["feedFraming"],
    highlights: JSON.parse(row.highlights) as PresentationValues["highlights"],
    mainHighlightId: row.main_highlight_id,
    fit: row.fit,
    focalX: row.focal_x,
    focalY: row.focal_y,
    zoom: row.zoom,
    playbackRate: row.playback_rate,
    loopMode: row.loop_mode
  };
}

/** Clears edits when an indexed identity is reused for different source bytes. */
export function createPresentationSourceReconciler(db: AetherDatabase) {
  const reset = db.prepare(`INSERT INTO asset_presentations
    (asset_id, revision, highlight_start_ms, highlight_end_ms, fit, focal_x, focal_y, zoom, playback_rate, loop_mode, updated_at, aspect_framing, feed_framing)
    SELECT a.id, 1, NULL, NULL, 'auto', 0.5, 0.5, 1, 1, 'repeat', @updatedAt, '{}', '{}'
    FROM assets a WHERE a.id = @assetId
      AND NOT (a.content_sha256 IS NOT NULL AND a.content_sha256 = @contentSha256)
      AND (a.content_sha256 IS NOT @contentSha256 OR a.size_bytes != @sizeBytes OR a.mtime_ms != @mtimeMs)
    ON CONFLICT(asset_id) DO UPDATE SET
      highlight_start_ms = NULL, highlight_end_ms = NULL, fit = 'auto',
      focal_x = 0.5, focal_y = 0.5, zoom = 1, playback_rate = 1,
      loop_mode = 'repeat', aspect_framing = '{}', feed_framing = '{}', highlights = '[]', main_highlight_id = NULL, revision = asset_presentations.revision + 1, updated_at = @updatedAt`);
  return (input: {
    assetId: string;
    contentSha256: string;
    sizeBytes: number;
    mtimeMs: number;
    updatedAt: string;
  }): void => {
    reset.run(input);
  };
}

export function presentationPlaybackDerivativeFiles(
  db: AetherDatabase
): Array<{ assetId: string; path: string }> {
  return db
    .prepare(
      `SELECT d.asset_id AS assetId, d.path FROM derivatives d
    JOIN asset_presentations p ON p.asset_id = d.asset_id
    WHERE (p.highlight_start_ms IS NOT NULL OR p.playback_rate != 1 OR p.loop_mode != 'repeat' OR json_array_length(p.highlights) > 0)
      AND (d.kind LIKE 'presentation:highlight-%' OR d.kind LIKE 'presentation:bounce-%')`
    )
    .all() as Array<{ assetId: string; path: string }>;
}

export function removePlaybackPresentationDerivativeRecords(
  db: AetherDatabase
): void {
  db.prepare(
    `DELETE FROM derivatives
    WHERE asset_id IN (SELECT asset_id FROM asset_presentations
      WHERE highlight_start_ms IS NOT NULL OR playback_rate != 1 OR loop_mode != 'repeat' OR json_array_length(highlights) > 0)
    AND (kind LIKE 'presentation:highlight-%' OR kind LIKE 'presentation:bounce-%')`
  ).run();
}

export function obsoletePresentationDerivativeFiles(
  db: AetherDatabase,
  assetId: string,
  keys:
    MediaPresentation["renditionKeys"] | MediaPresentation["renditionKeys"][]
): Array<{ assetId: string; path: string }> {
  const retained = Array.isArray(keys) ? keys : [keys];
  return (
    db
      .prepare(
        `SELECT asset_id AS assetId, path, kind FROM derivatives WHERE asset_id = ? AND (
    kind LIKE 'presentation:highlight-%' OR kind LIKE 'presentation:bounce-%')`
      )
      .all(assetId) as Array<{ assetId: string; path: string; kind: string }>
  )
    .filter(
      (entry) =>
        !retained.some(
          (key) =>
            entry.kind.split(":")[2] ===
            (entry.kind.startsWith("presentation:bounce-")
              ? key.bounce
              : key.highlight)
        )
    )
    .map(({ assetId, path }) => ({ assetId, path }));
}
