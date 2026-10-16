import type { FastifyInstance } from "fastify";
import type { AetherDatabase } from "../db/database.js";
import { getComparisonGeneration } from "./comparison-generation.js";
import {
  ComparisonConflictError,
  getAsset,
  getAssetsByIds,
  getNextComparisonPair,
  prefetchComparisonPairs,
  recordComparisonDecision,
  resumeComparisonSession,
  undoComparisonDecision
} from "./repository.js";
import {
  ComparisonDecisionBody,
  ComparisonEventParams,
  ComparisonPairQuery,
  ComparisonPrefetchBody,
  ComparisonResumeBody,
  ComparisonUndoBody,
  FolderParams
} from "./route-schemas.js";

export function registerComparisonRoutes(
  app: FastifyInstance,
  db: AetherDatabase
): void {
  app.get("/api/folders/:folderId/comparisons/next", async (request, reply) => {
    const params = FolderParams.safeParse(request.params);
    const query = ComparisonPairQuery.safeParse(request.query);

    if (!params.success || !query.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const pair = getHydratedComparisonPair(db, {
      folderId: params.data.folderId,
      type: query.data.type,
      recursive: query.data.recursive,
      search: query.data.search,
      tags: query.data.tag,
      scoreFilter: query.data.score,
      excludeAssetIds: query.data.exclude
    });

    if (!pair) {
      return reply.code(404).send({ error: "comparison_pair_unavailable" });
    }

    return pair;
  });

  app.post(
    "/api/folders/:folderId/comparisons/prefetch",
    async (request, reply) => {
      const params = FolderParams.safeParse(request.params);
      const body = ComparisonPrefetchBody.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      const pairs = prefetchComparisonPairs(db, {
        folderId: params.data.folderId,
        type: body.data.type,
        recursive: body.data.recursive,
        search: body.data.search,
        tags: body.data.tags,
        scoreFilter: body.data.score,
        count: body.data.count,
        excludePairs: body.data.excludePairs
      });
      const assetsById = new Map(
        getAssetsByIds(
          db,
          pairs.flatMap((pair) => [pair.leftAssetId, pair.rightAssetId])
        ).map((asset) => [asset.id, asset])
      );
      const comparisonGeneration = getComparisonGeneration(db);
      return {
        comparisonGeneration,
        pairs: pairs.flatMap((pair) => {
          const left = assetsById.get(pair.leftAssetId);
          const right = assetsById.get(pair.rightAssetId);
          return left && right
            ? [{ left, right, progress: pair.progress, comparisonGeneration }]
            : [];
        })
      };
    }
  );

  app.post(
    "/api/folders/:folderId/comparisons/resume",
    async (request, reply) => {
      const params = FolderParams.safeParse(request.params);
      const body = ComparisonResumeBody.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      const restored = resumeComparisonSession(db, {
        folderId: params.data.folderId,
        type: body.data.type,
        recursive: body.data.recursive,
        search: body.data.search,
        tags: body.data.tags,
        scoreFilter: body.data.score,
        pairAssetIds: body.data.pairAssetIds,
        previousDecision: body.data.previousDecision
      });
      return {
        comparisonGeneration: getComparisonGeneration(db),
        pair: hydratePair(db, restored.pair),
        previousDecision: restored.previousDecision
          ? {
              eventId: restored.previousDecision.eventId,
              pair: hydratePair(db, restored.previousDecision.pair)
            }
          : null
      };
    }
  );

  app.post("/api/comparisons", async (request, reply) => {
    const body = ComparisonDecisionBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    try {
      const { pairContext, nextPairAssetIds, ...decision } = body.data;
      const result = recordComparisonDecision(db, {
        ...decision,
        createdAt: new Date().toISOString()
      });
      if (!result) {
        return reply.code(404).send({ error: "asset_not_indexed" });
      }

      const response = {
        ...result,
        assets: result.assetIds
          .map((assetId) => getAsset(db, assetId))
          .filter(Boolean)
      };

      if (!pairContext) {
        return response;
      }

      let nextPair;
      try {
        nextPair = getHydratedComparisonPair(db, {
          folderId: pairContext.folderId,
          type: pairContext.type,
          recursive: pairContext.recursive,
          search: pairContext.search,
          tags: pairContext.tags,
          scoreFilter: pairContext.score,
          preferredPairAssetIds: nextPairAssetIds,
          excludeAssetIds: [decision.leftAssetId, decision.rightAssetId]
        });
      } catch (error) {
        request.log.warn(
          { err: error },
          "Comparison saved, but the next pair could not be prepared"
        );
        return response;
      }

      return {
        ...response,
        nextPair
      };
    } catch (error) {
      if (error instanceof ComparisonConflictError) {
        return reply.code(409).send({ error: error.code });
      }
      throw error;
    }
  });

  app.post("/api/comparisons/:eventId/undo", async (request, reply) => {
    const params = ComparisonEventParams.safeParse(request.params);
    const body = ComparisonUndoBody.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    try {
      const result = undoComparisonDecision(
        db,
        params.data.eventId,
        new Date().toISOString(),
        body.data.mutationId,
        body.data.comparisonGeneration
      );
      if (!result) {
        return reply.code(404).send({ error: "comparison_not_found" });
      }

      return {
        ...result,
        assets: result.assetIds
          .map((assetId) => getAsset(db, assetId))
          .filter(Boolean)
      };
    } catch (error) {
      if (error instanceof ComparisonConflictError) {
        return reply.code(409).send({ error: error.code });
      }
      throw error;
    }
  });
}

function getHydratedComparisonPair(
  db: AetherDatabase,
  options: Parameters<typeof getNextComparisonPair>[1]
) {
  return hydratePair(db, getNextComparisonPair(db, options));
}

function hydratePair(
  db: AetherDatabase,
  pair: ReturnType<typeof getNextComparisonPair>
) {
  if (!pair) {
    return null;
  }

  const left = getAsset(db, pair.leftAssetId);
  const right = getAsset(db, pair.rightAssetId);
  if (!left || !right) {
    return null;
  }

  return {
    left,
    right,
    progress: pair.progress,
    comparisonGeneration: getComparisonGeneration(db)
  };
}
