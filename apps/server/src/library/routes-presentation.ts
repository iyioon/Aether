import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import { mediaErrorStatus, resolveAssetFile } from "./media-serving.js";
import { removePresentationDerivativeFiles } from "./derivative-cache.js";
import { obsoletePresentationDerivativeFiles } from "./repository-presentation.js";
import {
  getPresentationRenditionKeys,
  PRESENTATION_PLAYBACK_RATES
} from "./presentation.js";
import {
  getPresentationMediaCapabilities,
  getPresentationVideoBouncePlan,
  PresentationMediaError
} from "./presentation-media.js";
import { AssetParams } from "./route-schemas.js";
import {
  getAsset,
  saveAssetPresentation,
  PresentationConflictError
} from "./repository.js";

const Framing = z
  .object({
    fit: z.enum(["auto", "contain", "cover"]),
    focalX: z.number().min(0).max(1),
    focalY: z.number().min(0).max(1),
    zoom: z.number().min(1).max(4)
  })
  .strict();

const PresentationBody = z
  .object({
    expectedRevision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
    highlight: z
      .object({
        startMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        endMs: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
      })
      .strict()
      .nullable(),
    ...Framing.shape,
    aspectFraming: z
      .object({
        Square: Framing.optional(),
        Portrait: Framing.optional(),
        Landscape: Framing.optional()
      })
      .strict()
      .optional(),
    feedFraming: z
      .object({
        portrait: Framing.extend({ fit: z.literal("cover") }).optional(),
        landscape: Framing.extend({ fit: z.literal("cover") }).optional()
      })
      .strict()
      .optional(),
    playbackRate: z
      .number()
      .refine((value) =>
        PRESENTATION_PLAYBACK_RATES.some((rate) => rate === value)
      ),
    loopMode: z.enum(["repeat", "bounce"])
  })
  .strict();

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
      const values = {
        ...edits,
        aspectFraming:
          edits.aspectFraming ?? current.presentation.aspectFraming ?? {},
        feedFraming: edits.feedFraming ?? current.presentation.feedFraming ?? {}
      };
      // Framing and reset remain available even for files the decoder cannot open.
      const needsTiming =
        values.highlight !== null ||
        values.playbackRate !== 1 ||
        values.loopMode !== "repeat";
      if (needsTiming) {
        const capabilities = await getPresentationMediaCapabilities({
          db,
          config,
          file
        });
        const duration = capabilities.durationMs;
        if (values.loopMode === "bounce" && capabilities.bounceUnavailable)
          return reply.code(400).send({ error: "bounce_source_not_supported" });
        if (
          capabilities.kind === "still" ||
          duration === null ||
          duration <= 0
        ) {
          return reply
            .code(400)
            .send({ error: "presentation_timing_not_supported" });
        }
        const range = values.highlight;
        if (
          range &&
          (range.endMs - range.startMs < Math.min(100, duration) ||
            range.endMs > duration ||
            range.endMs - range.startMs > capabilities.maxHighlightDurationMs)
        ) {
          return reply.code(400).send({ error: "invalid_highlight" });
        }
        if (
          values.loopMode === "bounce" &&
          (range ? range.endMs - range.startMs : duration) >
            capabilities.maxBounceDurationMs
        ) {
          return reply.code(400).send({ error: "bounce_duration_exceeded" });
        }
        if (values.loopMode === "bounce" && capabilities.kind === "video") {
          await getPresentationVideoBouncePlan(
            db,
            file,
            range ?? { startMs: 0, endMs: duration }
          );
        }
      }
      const fresh = await resolveAssetFile(db, assetId);
      if (
        !fresh ||
        fresh.mtimeMs !== file.mtimeMs ||
        fresh.sizeBytes !== file.sizeBytes
      ) {
        return reply.code(409).send({ error: "source_changed" });
      }
      const keys = getPresentationRenditionKeys(
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
      const asset = getAsset(db, assetId);
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
      return { asset };
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
