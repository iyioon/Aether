import type {
  AssetListOptions,
  AssetSortCriterion,
  AssetSortField,
  FolderRecord
} from "./repository-types.js";
import { normalizeTagSearch } from "./repository-tags.js";
import { assetSearchQuery } from "./search-text.js";

export const FINAL_SCORE_SQL =
  "CASE WHEN ar.asset_id IS NOT NULL THEN MAX(0, ar.comparison_score + ar.manual_adjustment) ELSE COALESCE(aa.manual_score, 0) END";

export const ASSET_SELECT_COLUMNS = `
  a.id,
  a.source_revision,
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
  | "folderId"
  | "recursive"
  | "scoreFilter"
  | "search"
  | "tags"
  | "tagMatch"
  | "tagStatus"
  | "type"
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
  const filters = ["a.root_id = @rootId", "a.lifecycle = 'active'"];

  if (options.recursive) {
    if (folder.relativePath !== "") {
      parameters.relativePath = folder.relativePath;
      parameters.relativePrefix = `${folder.relativePath}/`;
      filters.push(
        "(a.relative_path = @relativePath OR substr(a.relative_path, 1, length(@relativePrefix)) = @relativePrefix)"
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
  const tagFilters = normalizedTags.map((tagFilter, index) => {
    const parameterName = `tagFilter${index}`;
    parameters[parameterName] = tagFilter;
    return `EXISTS (
         SELECT 1
         FROM asset_tags at
         JOIN tags t ON t.id = at.tag_id
         WHERE at.asset_id = a.id AND t.normalized_name = @${parameterName}
       )`;
  });
  if (tagFilters.length) {
    filters.push(
      `(${tagFilters.join(options.tagMatch === "any" ? " OR " : " AND ")})`
    );
  }
  if (options.tagStatus === "tagged") {
    filters.push(
      "EXISTS (SELECT 1 FROM asset_tags at WHERE at.asset_id = a.id)"
    );
  } else if (options.tagStatus === "untagged") {
    filters.push(
      "NOT EXISTS (SELECT 1 FROM asset_tags at WHERE at.asset_id = a.id)"
    );
  }

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

// Hex encoding keeps the separator distinct even for existing tags containing
// control characters, while preserving the normalized UTF-8 byte ordering.
const TAG_SEQUENCE_SQL = `(SELECT group_concat(hex(t.normalized_name), char(0) ORDER BY t.normalized_name)
  FROM asset_tags at JOIN tags t ON t.id = at.tag_id WHERE at.asset_id = a.id)`;

const SORT_FIELD_SQL: Record<AssetSortField, string> = {
  date: "a.mtime_ms",
  filename: "a.name COLLATE NOCASE",
  score: FINAL_SCORE_SQL,
  favorite: "COALESCE(aa.favorite, 0)",
  tags: TAG_SEQUENCE_SQL,
  size: "a.size_bytes",
  duration: "a.duration_ms",
  type: "a.media_type"
};

export function defaultAssetSortDirection(
  field: AssetListOptions["sort"]
): "desc" | "asc" {
  return field === "filename" || field === "tags" || field === "type"
    ? "asc"
    : "desc";
}

export function buildAssetOrderClause(
  options: Pick<AssetListOptions, "sort" | "sortDirection" | "sortCriteria">
): string {
  if (options.sortCriteria !== undefined) {
    if (
      options.sort === "random" ||
      options.sortCriteria.length < 1 ||
      options.sortCriteria.length > 5 ||
      new Set(options.sortCriteria.map((criterion) => criterion.field)).size !==
        options.sortCriteria.length
    ) {
      throw new RangeError("Invalid asset sort criteria");
    }
    return [
      ...options.sortCriteria.flatMap(orderTermsForCriterion),
      "a.id ASC"
    ].join(", ");
  }

  const direction =
    options.sortDirection ?? defaultAssetSortDirection(options.sort);
  const sqlDirection = direction === "asc" ? "ASC" : "DESC";
  switch (options.sort) {
    case "filename":
      return `a.name COLLATE NOCASE ${sqlDirection}, a.mtime_ms DESC, a.id ASC`;
    case "score":
      return `${FINAL_SCORE_SQL} = 0 ASC, ${FINAL_SCORE_SQL} ${sqlDirection}, COALESCE(aa.favorite, 0) DESC, a.mtime_ms DESC, a.id ASC`;
    case "random":
      return "aether_seeded_rank(a.id, @randomSeed) ASC, a.id ASC";
    case "date":
      return `a.mtime_ms ${sqlDirection}, a.name COLLATE NOCASE ASC, a.id ASC`;
    default:
      return [
        ...orderTermsForCriterion({ field: options.sort, direction }),
        "a.id ASC"
      ].join(", ");
  }
}

function orderTermsForCriterion(criterion: AssetSortCriterion): string[] {
  if (
    !Object.hasOwn(SORT_FIELD_SQL, criterion.field) ||
    (criterion.direction !== "asc" && criterion.direction !== "desc")
  ) {
    throw new RangeError("Invalid asset sort criterion");
  }
  const direction = criterion.direction === "asc" ? "ASC" : "DESC";
  const expression = SORT_FIELD_SQL[criterion.field];
  if (criterion.field === "score") {
    return [`${FINAL_SCORE_SQL} = 0 ASC`, `${expression} ${direction}`];
  }
  return [
    `${expression} ${direction}${criterion.field === "tags" || criterion.field === "duration" ? " NULLS LAST" : ""}`
  ];
}
