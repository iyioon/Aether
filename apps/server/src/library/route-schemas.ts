import { z } from "zod";

export const AssetListQuery = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(250).default(80),
  sort: z
    .enum(["newest", "oldest", "filename", "rating", "random"])
    .default("newest"),
  type: z.enum(["all", "image", "video"]).default("all"),
  search: z.string().max(128).default(""),
  tag: z.string().max(64).default(""),
  rating: z.enum(["all", "favorites", "rated", "unrated"]).default("all"),
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

export const RatingBody = z
  .object({
    rating: z.number().int().min(0).max(10).nullable().optional(),
    favorite: z.boolean().optional()
  })
  .refine((data) => data.rating !== undefined || data.favorite !== undefined);

export const TagsBody = z.object({
  tags: z.array(z.string()).max(50)
});

const BatchAssetIds = z.array(z.string().min(1).max(256)).min(1).max(500);

export const BatchRatingBody = z
  .object({
    assetIds: BatchAssetIds,
    rating: z.number().int().min(0).max(10).nullable().optional(),
    favorite: z.boolean().optional()
  })
  .refine((data) => data.rating !== undefined || data.favorite !== undefined);

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
