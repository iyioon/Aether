import { z } from "zod";

const TagListQuery = z.preprocess(
  normalizeArrayQueryValue,
  z.array(z.string().max(64)).max(20)
);

export const AssetListQuery = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(250).default(80),
  seed: z.coerce.number().int().min(0).max(4_294_967_295).default(0),
  sort: z
    .enum(["date", "filename", "score", "random", "newest", "oldest"])
    .default("date"),
  order: z.enum(["desc", "asc"]).optional(),
  type: z.enum(["all", "image", "video"]).default("all"),
  search: z.string().max(128).default(""),
  tag: TagListQuery,
  score: z.enum(["all", "favorites", "ranked", "unranked"]).default("all"),
  recursive: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value !== "false")
});

export const AssetParams = z.object({
  assetId: z.string().min(1).max(256)
});

export const FolderParams = z.object({
  folderId: z.string().min(1).max(256)
});

export const ComparisonEventParams = z.object({
  eventId: z.uuid()
});

export const ComparisonPairQuery = AssetListQuery.pick({
  type: true,
  search: true,
  tag: true,
  score: true,
  recursive: true
}).extend({
  exclude: z.preprocess(
    normalizeArrayQueryValue,
    z.array(z.string().min(1).max(256)).max(2)
  )
});

const ComparisonPairContext = z.object({
  folderId: z.string().min(1).max(256),
  type: z.enum(["all", "image", "video"]).default("all"),
  recursive: z.boolean().default(true),
  search: z.string().max(128).default(""),
  tags: z.array(z.string().max(64)).max(20).default([]),
  score: z.enum(["all", "favorites", "ranked", "unranked"]).default("all")
});

const OrderedComparisonPair = z
  .tuple([z.string().min(1).max(256), z.string().min(1).max(256)])
  .refine(([left, right]) => left !== right);

export const ComparisonResumeBody = ComparisonPairContext.omit({
  folderId: true
}).extend({
  pairAssetIds: OrderedComparisonPair.nullable(),
  previousDecision: z
    .object({ eventId: z.uuid(), pairAssetIds: OrderedComparisonPair })
    .nullable()
});

export const ComparisonUndoBody = z
  .object({
    mutationId: z.uuid().optional(),
    comparisonGeneration: z.uuid().optional()
  })
  .refine(
    (body) => !body.mutationId || body.comparisonGeneration !== undefined
  );

function normalizeArrayQueryValue(value: unknown): unknown[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value.map((entry: unknown) => entry) : [value];
}

export const ComparisonDecisionBody = z
  .object({
    leftAssetId: z.string().min(1).max(256),
    rightAssetId: z.string().min(1).max(256),
    winnerAssetId: z.string().min(1).max(256),
    mutationId: z.uuid().optional(),
    comparisonGeneration: z.uuid().optional(),
    pairContext: ComparisonPairContext.optional()
  })
  .refine((data) => data.leftAssetId !== data.rightAssetId)
  .refine((data) => !data.mutationId || data.comparisonGeneration !== undefined)
  .refine((data) =>
    [data.leftAssetId, data.rightAssetId].includes(data.winnerAssetId)
  );

export const ThumbnailQuery = z.object({
  size: z.coerce.number().int().min(96).max(1600).default(640)
});

export const VideoPreviewQuery = z.object({
  size: z.coerce
    .number()
    .int()
    .min(160)
    .max(720)
    .default(480)
    .transform((value) => (value % 2 === 0 ? value : value - 1)),
  duration: z.coerce.number().int().min(1).max(8).default(4)
});

export const ScoreBody = z
  .object({
    score: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    favorite: z.boolean().optional()
  })
  .refine((data) => data.score !== undefined || data.favorite !== undefined);

export const TagsBody = z.object({
  tags: z.array(z.string()).max(50)
});

const BatchAssetIds = z.array(z.string().min(1).max(256)).min(1).max(500);

export const BatchScoreBody = z
  .object({
    assetIds: BatchAssetIds,
    score: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    favorite: z.boolean().optional()
  })
  .refine((data) => data.score !== undefined || data.favorite !== undefined);

export const LibraryDataResetBody = z
  .object({
    confirmation: z.literal("RESET"),
    scores: z.boolean().default(false),
    favorites: z.boolean().default(false),
    tags: z.boolean().default(false),
    comparisons: z.boolean().default(false)
  })
  .refine(
    (data) => data.scores || data.favorites || data.tags || data.comparisons
  );

export const ScanResultResponse = z.object({
  outcome: z.enum(["completed", "incomplete"]),
  incompleteReason: z.literal("source_changed_or_unavailable").nullable(),
  warnings: z.array(z.literal("derivative_cache_cleanup_failed")),
  roots: z.number().int().min(0),
  folders: z.number().int().min(0),
  assets: z.number().int().min(0),
  skipped: z.number().int().min(0),
  errors: z.number().int().min(0),
  removedAssets: z.number().int().min(0),
  removedFolders: z.number().int().min(0),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1)
});

const ScanProgressResponse = z.object({
  phase: z.enum(["discovering", "scanning", "finalizing"]),
  processed: z.number().int().min(0),
  total: z.number().int().min(0).nullable(),
  percent: z.number().int().min(0).max(100).nullable(),
  currentPath: z.string().nullable()
});

export const ScanStartResponse = z.object({
  status: z.literal("running"),
  jobId: z.string().min(1)
});

export const ScanJobsResponse = z.object({
  jobs: z.array(
    z.object({
      id: z.string().min(1),
      type: z.literal("library_scan"),
      status: z.enum(["running", "completed", "incomplete", "failed"]),
      attempts: z.number().int().min(0),
      error: z.string().nullable(),
      result: ScanResultResponse.nullable(),
      progress: ScanProgressResponse.nullable(),
      createdAt: z.string().min(1),
      updatedAt: z.string().min(1)
    })
  )
});

export const BatchTagsBody = z
  .object({
    assetIds: BatchAssetIds,
    tags: z.array(z.string()).max(50),
    mode: z.enum(["add", "replace"]).default("add")
  })
  .refine(
    (data) =>
      data.mode === "replace" || data.tags.some((tag) => tag.trim().length > 0)
  );

export const TagSuggestionQuery = z.object({
  q: z.string().max(64).default(""),
  limit: z.coerce.number().int().min(1).max(20).default(10)
});

export const AssetTagSuggestionQuery = z.object({
  limit: z.coerce.number().int().min(1).max(12).default(8)
});
