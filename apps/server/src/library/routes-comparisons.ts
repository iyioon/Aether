import type { FastifyInstance } from "fastify";
import type { AetherDatabase } from "../db/database.js";
import {
  ComparisonConflictError,
  getAsset,
  getNextComparisonPair,
  recordComparisonDecision,
  undoComparisonDecision
} from "./repository.js";
import {
  ComparisonDecisionBody,
  ComparisonEventParams,
  ComparisonPairQuery,
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

    const pair = getNextComparisonPair(db, {
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

    const left = getAsset(db, pair.leftAssetId);
    const right = getAsset(db, pair.rightAssetId);
    if (!left || !right) {
      return reply.code(404).send({ error: "asset_not_indexed" });
    }

    return { left, right, progress: pair.progress };
  });

  app.post("/api/comparisons", async (request, reply) => {
    const body = ComparisonDecisionBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    try {
      const result = recordComparisonDecision(db, {
        ...body.data,
        createdAt: new Date().toISOString()
      });
      if (!result) {
        return reply.code(404).send({ error: "asset_not_indexed" });
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

  app.post("/api/comparisons/:eventId/undo", async (request, reply) => {
    const params = ComparisonEventParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    try {
      const result = undoComparisonDecision(
        db,
        params.data.eventId,
        new Date().toISOString()
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
