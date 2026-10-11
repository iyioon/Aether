import type { AssetListOptions, FolderRecord } from "./repository-types.js";
import { normalizeTagSearch } from "./repository-tags.js";
import { assetSearchQuery } from "./search-text.js";

export const FINAL_SCORE_SQL =
  "CASE WHEN ar.asset_id IS NOT NULL THEN MAX(0, ar.comparison_score + ar.manual_adjustment) ELSE COALESCE(aa.manual_score, 0) END";

export const ASSET_SELECT_COLUMNS = `
  a.id,
  a.folder_id,
  a.name,
  a.extension,
  a.media_type,
  a.mime_type,
  a.size_bytes,
  a.mtime_ms,
  a.width,
  a.height,
  a.duration_ms,
  a.codec,
  a.status,
  a.error,
  ${FINAL_SCORE_SQL} AS final_score,
  ar.skill AS ranking_skill,
  ar.comparison_score AS ranking_comparison_score,
  ar.manual_adjustment AS ranking_manual_adjustment,
  ar.comparison_count AS ranking_comparison_count,
  COALESCE(aa.favorite, 0) AS favorite`;

export const ASSET_SOURCE_SELECT_COLUMNS = `
  a.root_id,
  roots.real_path AS root_real_path,
  a.relative_path,
  ${ASSET_SELECT_COLUMNS}`;

export type AssetFilterOptions = Pick<
  AssetListOptions,
  "folderId" | "recursive" | "scoreFilter" | "search" | "tags" | "type"
>;

export interface AssetFilterQuery {
  parameters: Record<string, string | number>;
  whereClause: string;
}

export function buildAssetFilterQuery(
  folder: FolderRecord,
  options: AssetFilterOptions
): AssetFilterQuery {
  const parameters: Record<string, string | number> = {
    rootId: folder.rootId,
    folderId: options.folderId
  };
  const filters = ["a.root_id = @rootId"];

  if (options.recursive) {
    if (folder.relativePath !== "") {
      parameters.relativePath = folder.relativePath;
      parameters.relativePrefix = `${folder.relativePath}/%`;
      filters.push(
        "(a.relative_path = @relativePath OR a.relative_path LIKE @relativePrefix)"
      );
    }
  } else {
    filters.push("a.folder_id = @folderId");
  }

  if (options.type !== "all") {
    parameters.mediaType = options.type;
    filters.push("a.media_type = @mediaType");
  }

  const searchQuery = assetSearchQuery(options.search ?? "");
  if (searchQuery) {
    parameters.searchQuery = searchQuery;
    filters.push(
      "a.id IN (SELECT asset_id FROM asset_search WHERE asset_search MATCH @searchQuery)"
    );
  }

  const normalizedTags = [
    ...new Set((options.tags ?? []).map(normalizeTagSearch).filter(Boolean))
  ];
  normalizedTags.forEach((tagFilter, index) => {
    const parameterName = `tagFilter${index}`;
    parameters[parameterName] = tagFilter;
    filters.push(
      `EXISTS (
         SELECT 1
         FROM asset_tags at
         JOIN tags t ON t.id = at.tag_id
         WHERE at.asset_id = a.id AND t.normalized_name = @${parameterName}
       )`
    );
  });

  switch (options.scoreFilter ?? "all") {
    case "favorites":
      filters.push("COALESCE(aa.favorite, 0) = 1");
      break;
    case "ranked":
      filters.push(`${FINAL_SCORE_SQL} > 0`);
      break;
    case "unranked":
      filters.push(`${FINAL_SCORE_SQL} = 0`);
      break;
    case "all":
      break;
  }

  return {
    parameters,
    whereClause: filters.join(" AND ")
  };
}
