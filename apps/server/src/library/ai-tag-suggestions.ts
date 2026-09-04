import sharp from "sharp";
import type { AppConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import type { ResolvedAssetFile } from "./media-serving.js";
import {
  getAssetTags,
  suggestTags,
  type TagRecord
} from "./repository.js";

export interface AiTagSuggestion {
  displayName: string;
  normalizedName: string;
  confidence: number;
  source: "local-ai";
  reason: string;
}

export interface AiTagSuggestionResult {
  suggestions: AiTagSuggestion[];
  provider: "ollama";
  model: string;
}

export type AiTagFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  }
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

const AI_IMAGE_SIZE = 768;
const AI_STOP_WORDS = new Set([
  "asset",
  "file",
  "image",
  "media",
  "photo",
  "picture",
  "snapshot",
  "video"
]);

export async function suggestAiAssetTags({
  db,
  config,
  file,
  limit,
  fetchImpl = fetch as AiTagFetch
}: {
  db: AetherDatabase;
  config: AppConfig;
  file: ResolvedAssetFile;
  limit: number;
  fetchImpl?: AiTagFetch;
}): Promise<AiTagSuggestionResult> {
  if (config.aiProvider !== "ollama") {
    throw new AiTaggingDisabledError();
  }

  if (file.asset.mediaType !== "image") {
    throw new AiTaggingUnsupportedAssetError("AI tag suggestions support images first.");
  }

  const existingTags = getAssetTags(db, file.asset.id);
  const imageBase64 = await imagePreviewBase64(file.sourcePath);
  const response = await fetchImpl(`${config.ollamaBaseUrl}/api/generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: config.ollamaVisionModel,
      stream: false,
      format: "json",
      images: [imageBase64],
      options: {
        temperature: 0.1
      },
      prompt: aiTagPrompt(file, existingTags, limit)
    }),
    signal: AbortSignal.timeout(config.aiTimeoutMs)
  }).catch((error: unknown) => {
    throw new AiTaggingProviderError(errorMessage(error));
  });

  if (!response.ok) {
    throw new AiTaggingProviderError(
      `Ollama responded with ${response.status}: ${await response.text()}`
    );
  }

  const payload = await response.json().catch((error: unknown) => {
    throw new AiTaggingProviderError(errorMessage(error));
  });

  return {
    provider: "ollama",
    model: config.ollamaVisionModel,
    suggestions: parseAiSuggestions(db, payload, existingTags, limit)
  };
}

function aiTagPrompt(
  file: ResolvedAssetFile,
  existingTags: TagRecord[],
  limit: number
): string {
  const savedTags = existingTags.map((tag) => tag.displayName).join(", ") || "none";

  return [
    "You help organize a private local media library.",
    `Suggest up to ${limit} concise tags for this image.`,
    "Use objective visible content only. Avoid guessing private identities, places, or events.",
    "Use 1 to 3 words per tag. Do not include duplicates, file types, or generic words.",
    `Filename: ${file.asset.name}`,
    `Existing tags to avoid: ${savedTags}`,
    'Return only JSON in this shape: {"tags":["tag one","tag two"]}'
  ].join("\n");
}

async function imagePreviewBase64(sourcePath: string): Promise<string> {
  const buffer = await sharp(sourcePath, {
    failOn: "none",
    limitInputPixels: 268_402_689
  })
    .rotate()
    .resize({
      width: AI_IMAGE_SIZE,
      height: AI_IMAGE_SIZE,
      fit: "inside",
      withoutEnlargement: true
    })
    .jpeg({
      quality: 78,
      mozjpeg: true
    })
    .toBuffer();

  return buffer.toString("base64");
}

function parseAiSuggestions(
  db: AetherDatabase,
  payload: unknown,
  existingTags: TagRecord[],
  limit: number
): AiTagSuggestion[] {
  const existingNames = new Set(existingTags.map((tag) => tag.normalizedName));
  const suggestions = new Map<string, AiTagSuggestion>();
  const tags = extractTagStrings(payload);

  for (const rawTag of tags) {
    const tag = normalizeAiTag(rawTag);

    if (
      !tag ||
      existingNames.has(tag.normalizedName) ||
      AI_STOP_WORDS.has(tag.normalizedName) ||
      suggestions.has(tag.normalizedName)
    ) {
      continue;
    }

    const existingVocabulary = suggestTags(db, {
      query: tag.displayName,
      limit: 8
    }).find((candidate) => candidate.normalizedName === tag.normalizedName);
    const displayName = existingVocabulary?.displayName ?? tag.displayName;
    suggestions.set(tag.normalizedName, {
      displayName,
      normalizedName: tag.normalizedName,
      confidence: existingVocabulary ? 0.88 : 0.82,
      source: "local-ai",
      reason: existingVocabulary
        ? `Ollama vision analysis; matches existing tag`
        : "Ollama vision analysis"
    });

    if (suggestions.size >= limit) {
      break;
    }
  }

  return [...suggestions.values()];
}

function extractTagStrings(payload: unknown): string[] {
  if (!isRecord(payload)) {
    return [];
  }

  const response = payload.response;
  const parsedResponse =
    typeof response === "string" ? parseLooseJson(response) : response;
  const tagSource = isRecord(parsedResponse) ? parsedResponse.tags : null;

  if (parsedResponse === null) {
    return [];
  }

  if (Array.isArray(tagSource)) {
    return tagSource.filter((tag): tag is string => typeof tag === "string");
  }

  if (typeof tagSource === "string") {
    return splitTagList(tagSource);
  }

  if (Array.isArray(payload.tags)) {
    return payload.tags.filter((tag): tag is string => typeof tag === "string");
  }

  return typeof response === "string" ? splitTagList(response) : [];
}

function parseLooseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    const match = /\{[\s\S]*\}/.exec(value);
    if (!match) {
      return /[{}]/.test(value) ? null : value;
    }

    try {
      return JSON.parse(match[0]!);
    } catch {
      return null;
    }
  }
}

function splitTagList(value: string): string[] {
  return value
    .split(/[\n,;]/)
    .map((tag) => tag.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function normalizeAiTag(
  rawValue: string
): { displayName: string; normalizedName: string } | null {
  const displayName = rawValue
    .normalize("NFKC")
    .replace(/[_\-.]+/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

  if (!displayName || displayName.length > 48) {
    return null;
  }

  const normalizedName = displayName.toLocaleLowerCase("en-US");

  if (normalizedName.length < 3 || /^\d+$/.test(normalizedName)) {
    return null;
  }

  return {
    displayName: displayNameFor(displayName),
    normalizedName
  };
}

function displayNameFor(value: string): string {
  return value
    .split(" ")
    .map((part) => part.charAt(0).toLocaleUpperCase("en-US") + part.slice(1))
    .join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown AI provider failure.";
}

export class AiTaggingDisabledError extends Error {
  constructor() {
    super("AI tag suggestions are disabled.");
    this.name = "AiTaggingDisabledError";
  }
}

export class AiTaggingUnsupportedAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiTaggingUnsupportedAssetError";
  }
}

export class AiTaggingProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiTaggingProviderError";
  }
}
