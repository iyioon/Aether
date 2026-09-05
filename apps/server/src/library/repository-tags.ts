import type { AetherDatabase } from "../db/database.js";
import { stableId } from "./ids.js";
import { mapTagRow } from "./repository-mappers.js";
import type {
  AssetTagRow,
  BatchTagUpdateInput,
  BatchTagUpdateResult,
  NormalizedTag,
  TagRecord,
  TagRow
} from "./repository-types.js";

const MAX_TAGS_PER_ASSET = 50;
const MAX_TAG_LENGTH = 48;

export function getAssetTags(
  db: AetherDatabase,
  assetId: string
): TagRecord[] {
  const rows = db
    .prepare(
      `SELECT t.id, t.normalized_name, t.display_name, t.usage_count
       FROM tags t
       JOIN asset_tags at ON at.tag_id = t.id
       WHERE at.asset_id = ?
       ORDER BY t.display_name COLLATE NOCASE ASC`
    )
    .all(assetId) as TagRow[];

  return rows.map(mapTagRow);
}

export function setAssetTags(
  db: AetherDatabase,
  assetId: string,
  tagNames: string[],
  now = new Date().toISOString()
): TagRecord[] | null {
  const asset = db
    .prepare("SELECT id FROM assets WHERE id = ?")
    .get(assetId) as { id: string } | undefined;

  if (!asset) {
    return null;
  }

  const tags = normalizeTagInputs(tagNames);

  const transaction = db.transaction(() => {
    replaceAssetTags(db, assetId, tags, now);
    refreshTagUsageCounts(db);
    db.prepare("DELETE FROM tags WHERE usage_count = 0").run();
  });

  transaction();

  return getAssetTags(db, assetId);
}

export function updateAssetTagsBatch(
  db: AetherDatabase,
  input: BatchTagUpdateInput
): BatchTagUpdateResult | null {
  const assetIds = uniqueAssetIds(input.assetIds);

  if (!allAssetsExist(db, assetIds)) {
    return null;
  }

  const now = input.now ?? new Date().toISOString();
  const tags = normalizeTagInputs(input.tags);

  if (input.mode === "add" && tags.length === 0) {
    throw new InvalidTagError("At least one tag is required.");
  }

  const transaction = db.transaction(() => {
    for (const assetId of assetIds) {
      const nextTags =
        input.mode === "replace"
          ? tags
          : mergeNormalizedTags(getNormalizedAssetTags(db, assetId), tags);

      if (nextTags.length > MAX_TAGS_PER_ASSET) {
        throw new InvalidTagError(`Use ${MAX_TAGS_PER_ASSET} tags or fewer.`);
      }

      replaceAssetTags(db, assetId, nextTags, now);
    }

    refreshTagUsageCounts(db);
    db.prepare("DELETE FROM tags WHERE usage_count = 0").run();
  });

  transaction();

  return {
    tags: tags
      .map((tag) => getTagById(db, tag.id))
      .filter((tag): tag is TagRecord => Boolean(tag)),
    updated: assetIds.length
  };
}

export function suggestTags(
  db: AetherDatabase,
  options: { query: string; limit: number }
): TagRecord[] {
  const query = normalizeTagSearch(options.query);

  if (!query) {
    const rows = db
      .prepare(
        `SELECT id, normalized_name, display_name, usage_count
         FROM tags
         ORDER BY usage_count DESC, display_name COLLATE NOCASE ASC
         LIMIT @limit`
      )
      .all({ limit: options.limit }) as TagRow[];

    return rows.map(mapTagRow);
  }

  const rows = db
    .prepare(
      `SELECT id, normalized_name, display_name, usage_count
       FROM tags
       WHERE normalized_name LIKE @query ESCAPE '\\'
       ORDER BY usage_count DESC, display_name COLLATE NOCASE ASC
       LIMIT @limit`
    )
    .all({ query: `${escapeLike(query)}%`, limit: options.limit }) as TagRow[];

  return rows.map(mapTagRow);
}

export function getTagsByAssetId(
  db: AetherDatabase,
  assetIds: string[]
): Map<string, TagRecord[]> {
  const uniqueIds = uniqueAssetIds(assetIds);
  const tagsByAssetId = new Map<string, TagRecord[]>();

  if (uniqueIds.length === 0) {
    return tagsByAssetId;
  }

  const placeholders = uniqueIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT
         at.asset_id,
         t.id,
         t.normalized_name,
         t.display_name,
         t.usage_count
       FROM asset_tags at
       JOIN tags t ON t.id = at.tag_id
       WHERE at.asset_id IN (${placeholders})
       ORDER BY t.display_name COLLATE NOCASE ASC`
    )
    .all(...uniqueIds) as AssetTagRow[];

  for (const row of rows) {
    const tags = tagsByAssetId.get(row.asset_id) ?? [];
    tags.push(mapTagRow(row));
    tagsByAssetId.set(row.asset_id, tags);
  }

  return tagsByAssetId;
}

export function normalizeTagSearch(query: string): string {
  return query.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase(
    "en-US"
  );
}

function normalizeTagInputs(tagNames: string[]): NormalizedTag[] {
  if (tagNames.length > MAX_TAGS_PER_ASSET) {
    throw new InvalidTagError(`Use ${MAX_TAGS_PER_ASSET} tags or fewer.`);
  }

  const tags = new Map<string, NormalizedTag>();

  for (const tagName of tagNames) {
    const tag = normalizeTagInput(tagName);

    if (!tag) {
      continue;
    }

    if (!tags.has(tag.normalizedName)) {
      tags.set(tag.normalizedName, tag);
    }
  }

  return [...tags.values()];
}

function replaceAssetTags(
  db: AetherDatabase,
  assetId: string,
  tags: NormalizedTag[],
  now: string
): void {
  const upsertTag = db.prepare(`
    INSERT INTO tags (id, normalized_name, display_name, usage_count, created_at)
    VALUES (@id, @normalizedName, @displayName, 0, @createdAt)
    ON CONFLICT(normalized_name) DO UPDATE SET
      display_name = excluded.display_name
  `);
  const linkTag = db.prepare(`
    INSERT OR IGNORE INTO asset_tags (asset_id, tag_id, created_at)
    VALUES (@assetId, @tagId, @createdAt)
  `);

  db.prepare("DELETE FROM asset_tags WHERE asset_id = ?").run(assetId);

  for (const tag of tags) {
    upsertTag.run({
      id: tag.id,
      normalizedName: tag.normalizedName,
      displayName: tag.displayName,
      createdAt: now
    });
    linkTag.run({
      assetId,
      tagId: tag.id,
      createdAt: now
    });
  }
}

function getNormalizedAssetTags(
  db: AetherDatabase,
  assetId: string
): NormalizedTag[] {
  const rows = db
    .prepare(
      `SELECT t.id, t.normalized_name, t.display_name
       FROM tags t
       JOIN asset_tags at ON at.tag_id = t.id
       WHERE at.asset_id = ?
       ORDER BY t.display_name COLLATE NOCASE ASC`
    )
    .all(assetId) as Array<{
    id: string;
    normalized_name: string;
    display_name: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    normalizedName: row.normalized_name,
    displayName: row.display_name
  }));
}

function mergeNormalizedTags(
  existingTags: NormalizedTag[],
  addedTags: NormalizedTag[]
): NormalizedTag[] {
  const tags = new Map<string, NormalizedTag>();

  for (const tag of existingTags) {
    tags.set(tag.normalizedName, tag);
  }

  for (const tag of addedTags) {
    if (!tags.has(tag.normalizedName)) {
      tags.set(tag.normalizedName, tag);
    }
  }

  return [...tags.values()];
}

function getTagById(db: AetherDatabase, tagId: string): TagRecord | null {
  const row = db
    .prepare(
      `SELECT id, normalized_name, display_name, usage_count
       FROM tags
       WHERE id = ?`
    )
    .get(tagId) as TagRow | undefined;

  return row ? mapTagRow(row) : null;
}

function normalizeTagInput(input: string): NormalizedTag | null {
  const displayName = input.normalize("NFKC").trim().replace(/\s+/g, " ");

  if (!displayName) {
    return null;
  }

  if (displayName.length > MAX_TAG_LENGTH) {
    throw new InvalidTagError(`Tags must be ${MAX_TAG_LENGTH} characters or fewer.`);
  }

  const normalizedName = displayName.toLocaleLowerCase("en-US");

  return {
    id: stableId("tag", normalizedName),
    normalizedName,
    displayName
  };
}

function refreshTagUsageCounts(db: AetherDatabase): void {
  db.prepare(`
    UPDATE tags
    SET usage_count = (
      SELECT COUNT(*)
      FROM asset_tags
      WHERE asset_tags.tag_id = tags.id
    )
  `).run();
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&");
}

function uniqueAssetIds(assetIds: string[]): string[] {
  return [...new Set(assetIds)];
}

function allAssetsExist(db: AetherDatabase, assetIds: string[]): boolean {
  const findAsset = db.prepare("SELECT id FROM assets WHERE id = ?");

  return assetIds.every((assetId) => Boolean(findAsset.get(assetId)));
}

export class InvalidTagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTagError";
  }
}
