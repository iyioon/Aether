import { stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ImageDerivativeError } from "./image-cache.js";
import { runMediaCommand } from "./video-processing.js";

export const HEIF_MAX_DECODED_BYTES = 512 * 1024 * 1024;
export interface HeifImageInfo {
  width: number;
  height: number;
  pages: number;
  primaryPage: number;
  bitDepth: number;
  hasAlpha: boolean;
  hasProfile: boolean;
}

export async function inspectHeifImage(
  sourcePath: string
): Promise<HeifImageInfo> {
  try {
    const source = await stat(sourcePath);
    if (!source.isFile() || source.size > 256 * 1024 * 1024)
      throw new ImageDerivativeError("heic_limit_exceeded", 422);
    const info = await runMediaCommand("heif-info", [sourcePath], 10_000);
    const dump = await runMediaCommand(
      "heif-info",
      ["-d", sourcePath],
      10_000,
      1024 * 1024
    );
    return parseHeifInfo(info.stdout, dump.stdout);
  } catch (error) {
    if (error instanceof ImageDerivativeError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new ImageDerivativeError("heic_decoder_unavailable", 503);
    throw new ImageDerivativeError("heic_decode_failed");
  }
}

export function parseHeifInfo(info: string, dump: string): HeifImageInfo {
  const images = [
    ...info.matchAll(
      /^image: (\d+)x(\d+) \(id=(\d+)\)([^\n]*)([\s\S]*?)(?=^image: |$(?![\s\S]))/gm
    )
  ];
  const primaryPage = images.findIndex((image) =>
    image[4]!.includes("primary")
  );
  const primary = images[primaryPage];
  const associations = primary
    ? (new RegExp(
        `associations for item ID: ${primary[3]}\\s*\\n([\\s\\S]*?)(?=^[| ]*associations for item ID:|^[| ]*Box:|$(?![\\s\\S]))`,
        "m"
      ).exec(dump)?.[1] ?? "")
    : "";
  const propertyIds = new Set(
    [...associations.matchAll(/property index: (\d+)/g)].map((entry) =>
      Number(entry[1])
    )
  );
  const properties = [
    ...dump.matchAll(
      /^[| ]*index: (\d+)\s*\n([\s\S]*?)(?=^[| ]*index: \d+\s*$|^[| ]*Box: ipma\b)/gm
    )
  ];
  const primaryProperties = properties
    .filter((property) => propertyIds.has(Number(property[1])))
    .map((property) => property[2])
    .join("\n");
  const pixelDepths = [
    ...primaryProperties.matchAll(/bits_per_channel: ([\d,]+)/g)
  ].flatMap((entry) => entry[1]!.split(",").map(Number));
  const codecDepths = [
    ...dump.matchAll(/bit_depth_(?:luma|chroma): (\d+)/g)
  ].map((entry) => Number(entry[1]));
  const depths = pixelDepths.length ? pixelDepths : codecDepths;
  if (
    !/^MIME type: image\/hei[cf]\s*$/m.test(info) ||
    images.length < 1 ||
    images.length > 4 ||
    primaryPage < 0 ||
    images.filter((image) => image[4]!.includes("primary")).length !== 1 ||
    !primaryProperties ||
    !depths.length ||
    depths.some((depth) => depth !== 8 && depth !== 10) ||
    /Box: av1C\b/.test(dump) ||
    !/Box: hvcC\b/.test(dump)
  )
    throw new ImageDerivativeError("heic_source_not_supported");
  const bitDepth = Math.max(...depths);
  if (/data_reference_index: [1-9]\d*/.test(dump))
    throw new ImageDerivativeError("heic_source_not_supported");
  const codedExtents = [
    ...dump.matchAll(/image width: (\d+)\s*\n[| ]*image height: (\d+)/g)
  ];
  if (
    !codedExtents.length ||
    codedExtents.some(
      (extent) =>
        Number(extent[1]) * Number(extent[2]) > 64_000_000 ||
        Number(extent[1]) * Number(extent[2]) * 8 > HEIF_MAX_DECODED_BYTES
    )
  )
    throw new ImageDerivativeError("heic_limit_exceeded", 422);
  const pixels = images.reduce(
    (total, image) => total + Number(image[1]) * Number(image[2]),
    0
  );
  if (
    !Number.isSafeInteger(pixels) ||
    pixels <= 0 ||
    pixels > 64_000_000 ||
    pixels * 4 * (Math.max(...codecDepths, bitDepth) > 8 ? 2 : 1) >
      HEIF_MAX_DECODED_BYTES
  )
    throw new ImageDerivativeError("heic_limit_exceeded", 422);
  const hasProfile = /color profile: (?:prof|rICC)\b/.test(primary![5]!);
  const transfers = [
    ...primaryProperties.matchAll(/transfer_characteristics: (\d+)/g)
  ].map((entry) => Number(entry[1]));
  const primaries = [
    ...primaryProperties.matchAll(/colour_primaries: (\d+)/g)
  ].map((entry) => Number(entry[1]));
  if (
    transfers.some((value) => value === 16 || value === 18) ||
    /Box: (?:mdcv|clli)\b/.test(primaryProperties)
  )
    throw new ImageDerivativeError("heic_hdr_not_supported");
  if (
    !hasProfile &&
    (primaries.some((value) => value !== 1 && value !== 2) ||
      transfers.some((value) => ![2, 13].includes(value)))
  )
    throw new ImageDerivativeError("heic_color_not_supported");
  return {
    width: Number(primary![1]),
    height: Number(primary![2]),
    pages: images.length,
    primaryPage,
    bitDepth,
    hasAlpha: /alpha channel: yes\b/.test(primary![5]!),
    hasProfile
  };
}

export async function decodeHeifImage(
  sourcePath: string,
  directory: string,
  info: HeifImageInfo
): Promise<string> {
  try {
    const output = path.join(directory, "decoded.png");
    await runMediaCommand(
      "heif-convert",
      ["--quiet", "--codec-threads", "2", sourcePath, output],
      30_000
    );
    const selected =
      info.pages === 1
        ? output
        : path.join(directory, `decoded-${info.primaryPage + 1}.png`);
    const metadata = await sharp(selected, {
      limitInputPixels: 64_000_000
    }).metadata();
    if (
      metadata.width !== info.width ||
      metadata.height !== info.height ||
      metadata.hasAlpha !== info.hasAlpha
    )
      throw new ImageDerivativeError("heic_decode_failed");
    return selected;
  } catch (error) {
    if (error instanceof ImageDerivativeError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new ImageDerivativeError("heic_decoder_unavailable", 503);
    throw new ImageDerivativeError("heic_decode_failed");
  }
}
