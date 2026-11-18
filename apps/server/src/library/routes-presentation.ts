import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import { mediaErrorStatus, resolveAssetFile } from "./media-serving.js";
import { removePresentationDerivativeFiles } from "./derivative-cache.js";
import { obsoletePresentationDerivativeFiles } from "./repository-presentation.js";
import {
  canonicalPresentationValues,
  presentationRenditionKeys
} from "./presentation.js";
import {
  getPresentationMediaCapabilities,
  getPresentationVideoBouncePlan,
  PresentationMediaError
} from "./presentation-media.js";
import { AssetParams } from "./route-schemas.js";
import { PresentationBody } from "./presentation-schemas.js";
import { withPresentationLifecycle } from "./presentation-cache.js";
import {
  getAsset,
  saveAssetPresentation,
  PresentationConflictError
} from "./repository.js";

export function registerPresentationRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: AetherDatabase
): void {
  app.put("/api/assets/:assetId/presentation", async (request, reply) => {
    const params = AssetParams.safeParse(request.params);
    const body = PresentationBody.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const assetId = params.data.assetId;
    try {
      const file = await resolveAssetFile(db, assetId);
      if (!file) return reply.code(404).send({ error: "asset_not_found" });
      if (
        Math.trunc(file.asset.indexedMtimeMs) !== Math.trunc(file.mtimeMs) ||
        file.asset.indexedSizeBytes !== file.sizeBytes
      ) {
        return reply.code(409).send({ error: "source_changed" });
      }
      const current = getAsset(db, assetId);
      if (!current) return reply.code(404).send({ error: "asset_not_indexed" });
      if (current.presentation.revision !== body.data.expectedRevision) {
        return reply
          .code(409)
          .send({ error: "presentation_conflict", asset: current });
      }
      const { expectedRevision, ...edits } = body.data;
      const values = canonicalPresentationValues(
        {
          ...edits,
          aspectFraming:
            edits.aspectFraming ?? current.presentation.aspectFraming ?? {},
          feedFraming:
            edits.feedFraming ?? current.presentation.feedFraming ?? {}
        },
        current.presentation
      );
      // Framing and reset remain available even for files the decoder cannot open.
      const needsTiming =
        values.highlight !== null ||
        values.highlights.length > 0 ||
        values.playbackRate !== 1 ||
        values.loopMode !== "repeat";
      if (needsTiming) {
        const capabilities = await getPresentationMediaCapabilities({
          db,
          config,
          file,
          includeSavedTimeline: false
        });
        const duration = capabilities.durationMs;
        if (
          capabilities.kind === "still" ||
          duration === null ||
          duration <= 0
        ) {
          return reply
            .code(400)
            .send({ error: "presentation_timing_not_supported" });
        }
        const timedValues = [values, ...values.highlights];
        const checkedBounceRanges = new Set<string>();
        for (const timed of timedValues) {
          if (timed.loopMode === "bounce" && capabilities.bounceUnavailable)
            return reply
              .code(400)
              .send({ error: "bounce_source_not_supported" });
          const range = timed.highlight;
          if (
            range &&
            (range.endMs - range.startMs < Math.min(100, duration) ||
              range.endMs > duration ||
              range.endMs - range.startMs > capabilities.maxHighlightDurationMs)
          ) {
            return reply.code(400).send({ error: "invalid_highlight" });
          }
          if (
            timed.loopMode === "bounce" &&
            (range ? range.endMs - range.startMs : duration) >
              capabilities.maxBounceDurationMs
          ) {
            return reply.code(400).send({ error: "bounce_duration_exceeded" });
          }
          if (timed.loopMode === "bounce" && capabilities.kind === "video") {
            const signature = `${range?.startMs ?? 0}:${range?.endMs ?? duration}`;
            if (checkedBounceRanges.has(signature)) continue;
            checkedBounceRanges.add(signature);
            await getPresentationVideoBouncePlan(
              db,
              file,
              range ?? { startMs: 0, endMs: duration }
            );
          }
        }
      }
      return await withPresentationLifecycle(db, async () => {
        const fresh = await resolveAssetFile(db, assetId);
        if (
          !fresh ||
          fresh.mtimeMs !== file.mtimeMs ||
          fresh.sizeBytes !== file.sizeBytes ||
          fresh.device !== file.device ||
          fresh.inode !== file.inode
        ) {
          return reply.code(409).send({ error: "source_changed" });
        }
        const keys = presentationRenditionKeys(
          {
            id: assetId,
            mtimeMs: file.asset.indexedMtimeMs,
            sizeBytes: file.asset.indexedSizeBytes
          },
          values
        );
        const obsoleteFiles = obsoletePresentationDerivativeFiles(
          db,
          assetId,
          keys
        );
        const saved = saveAssetPresentation(db, {
          assetId,
          expectedRevision,
          values,
          sourceMtimeMs: file.asset.indexedMtimeMs,
          sourceSizeBytes: file.asset.indexedSizeBytes,
          updatedAt: new Date().toISOString()
        });
        if (!saved) return reply.code(404).send({ error: "asset_not_indexed" });
        if (obsoleteFiles.length > 0) {
          try {
            await removePresentationDerivativeFiles(
              config.cacheDir,
              obsoleteFiles
            );
          } catch {
            request.log.warn("Presentation cache cleanup could not finish");
          }
        }
        const asset = getAsset(db, assetId);
        if (!asset) return reply.code(404).send({ error: "asset_not_indexed" });
        return { asset };
      });
    } catch (error) {
      if (error instanceof PresentationConflictError) {
        return reply.code(409).send({
          error: "presentation_conflict",
          asset: getAsset(db, assetId)
        });
      }
      if (error instanceof PresentationMediaError) {
        return reply.code(error.status).send({ error: error.code });
      }
      return reply
        .code(mediaErrorStatus(error) === 403 ? 403 : 422)
        .send({ error: "presentation_save_failed" });
    }
  });
}
