import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { FastifyReply } from "fastify";
import type { AetherDatabase } from "../db/database.js";
import { UnsafePathError, resolveMediaPath } from "../security/path-safety.js";
import { getAssetSource, type AssetSourceRecord } from "./repository.js";

export interface ResolvedAssetFile {
  asset: AssetSourceRecord;
  sourcePath: string;
  sizeBytes: number;
  mtimeMs: number;
}

export interface ByteRange {
  start: number;
  end: number;
}

export async function resolveAssetFile(
  db: AetherDatabase,
  assetId: string
): Promise<ResolvedAssetFile | null> {
  const asset = getAssetSource(db, assetId);

  if (!asset) {
    return null;
  }

  const sourcePath = await resolveMediaPath(asset.rootRealPath, asset.relativePath);
  const fileStat = await stat(sourcePath).catch(() => null);

  if (!fileStat?.isFile()) {
    return null;
  }

  return {
    asset,
    sourcePath,
    sizeBytes: fileStat.size,
    mtimeMs: Math.trunc(fileStat.mtimeMs)
  };
}

export function parseRangeHeader(
  rangeHeader: string | undefined,
  sizeBytes: number
): ByteRange | "invalid" | null {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());

  if (!match) {
    return "invalid";
  }

  const [, startText, endText] = match;

  if (!startText && !endText) {
    return "invalid";
  }

  if (!startText) {
    const suffixLength = Number(endText);

    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return "invalid";
    }

    const start = Math.max(sizeBytes - suffixLength, 0);
    return {
      start,
      end: sizeBytes - 1
    };
  }

  const start = Number(startText);
  const end = endText ? Number(endText) : sizeBytes - 1;

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= sizeBytes
  ) {
    return "invalid";
  }

  return {
    start,
    end: Math.min(end, sizeBytes - 1)
  };
}

export function sendAssetStream({
  reply,
  file,
  range,
  disposition
}: {
  reply: FastifyReply;
  file: ResolvedAssetFile;
  range: ByteRange | null;
  disposition: "inline" | "attachment";
}): FastifyReply {
  const contentType = file.asset.mimeType ?? "application/octet-stream";
  const contentDisposition =
    disposition === "attachment"
      ? attachmentDisposition(file.asset.name)
      : inlineDisposition(file.asset.name);

  reply.header("accept-ranges", "bytes");
  reply.header("cache-control", "private, max-age=3600");
  reply.header("content-disposition", contentDisposition);
  reply.type(contentType);

  if (range) {
    const chunkSize = range.end - range.start + 1;
    reply.code(206);
    reply.header(
      "content-range",
      `bytes ${range.start}-${range.end}/${file.sizeBytes}`
    );
    reply.header("content-length", String(chunkSize));
    return reply.send(
      createReadStream(file.sourcePath, {
        start: range.start,
        end: range.end
      })
    );
  }

  reply.header("content-length", String(file.sizeBytes));
  return reply.send(createReadStream(file.sourcePath));
}

export function sendRangeNotSatisfiable(
  reply: FastifyReply,
  sizeBytes: number
): FastifyReply {
  reply.header("content-range", `bytes */${sizeBytes}`);
  return reply.code(416).send({ error: "range_not_satisfiable" });
}

export function mediaErrorStatus(error: unknown): number {
  return error instanceof UnsafePathError ? 403 : 404;
}

function inlineDisposition(fileName: string): string {
  return `inline; filename="${asciiFallback(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function attachmentDisposition(fileName: string): string {
  return `attachment; filename="${asciiFallback(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function asciiFallback(fileName: string): string {
  const stripped = fileName
    .replace(/[\\/\r\n"]/g, "_")
    .replace(/[^\x20-\x7E]/g, "_")
    .trim();

  return stripped || "download";
}
