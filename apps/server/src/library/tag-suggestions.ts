import path from "node:path";
import type { AetherDatabase } from "../db/database.js";
import {
  getAssetSource,
  getAssetTags,
  suggestTags
} from "./repository.js";

export interface TagSuggestion {
  displayName: string;
  normalizedName: string;
  confidence: number;
  source: "local-metadata";
  reason: string;
}

interface Candidate {
  displayName: string;
  normalizedName: string;
  confidence: number;
  reason: string;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "asset",
  "copy",
  "dsc",
  "edited",
  "final",
  "image",
  "img",
  "media",
  "mov",
  "movie",
  "new",
  "photo",
  "photos",
  "picture",
  "pxl",
  "raw",
  "the",
  "untitled",
  "vid",
  "video"
]);

export function suggestAssetTags(
  db: AetherDatabase,
  assetId: string,
  limit: number
): { suggestions: TagSuggestion[] } | null {
  const asset = getAssetSource(db, assetId);

  if (!asset) {
    return null;
  }

  const existingTagNames = new Set(
    getAssetTags(db, assetId).map((tag) => tag.normalizedName)
  );
  const candidates = new Map<string, Candidate>();
  const folderPath = path.dirname(asset.relativePath);
  const folderParts =
    folderPath === "." ? [] : folderPath.split("/").filter(Boolean);

  for (const folderPart of folderParts) {
    addCandidates(candidates, folderPart, 0.74, "Folder name");
  }

  addCandidates(
    candidates,
    path.basename(asset.name, asset.extension),
    0.68,
    "File name"
  );

  const suggestions = [...candidates.values()]
    .filter((candidate) => !existingTagNames.has(candidate.normalizedName))
    .map((candidate) => promoteExistingTag(db, candidate))
    .sort(
      (left, right) =>
        right.confidence - left.confidence ||
        left.displayName.localeCompare(right.displayName)
    )
    .slice(0, limit);

  return {
    suggestions
  };
}

function addCandidates(
  candidates: Map<string, Candidate>,
  rawValue: string,
  confidence: number,
  reason: string
) {
  for (const token of tokenizeTagTerms(rawValue)) {
    const normalizedName = normalizeTagName(token);

    if (!normalizedName || STOP_WORDS.has(normalizedName)) {
      continue;
    }

    const current = candidates.get(normalizedName);

    if (!current || confidence > current.confidence) {
      candidates.set(normalizedName, {
        displayName: displayNameFor(token),
        normalizedName,
        confidence,
        reason
      });
    }
  }
}

function promoteExistingTag(
  db: AetherDatabase,
  candidate: Candidate
): TagSuggestion {
  const existingTag = suggestTags(db, {
    query: candidate.displayName,
    limit: 6
  }).find((tag) => tag.normalizedName === candidate.normalizedName);

  if (!existingTag) {
    return {
      ...candidate,
      source: "local-metadata"
    };
  }

  return {
    displayName: existingTag.displayName,
    normalizedName: existingTag.normalizedName,
    confidence: Math.min(candidate.confidence + 0.12, 0.95),
    source: "local-metadata",
    reason: `${candidate.reason}; matches existing tag`
  };
}

function tokenizeTagTerms(rawValue: string): string[] {
  const normalized = rawValue
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

  if (!normalized) {
    return [];
  }

  const terms = new Map<string, string>();

  for (const rawTerm of normalized.split(/\s+/)) {
    const term = rawTerm.trim();
    const normalizedName = normalizeTagName(term);

    if (
      !normalizedName ||
      normalizedName.length < 3 ||
      normalizedName.length > 48 ||
      /^\d+$/.test(normalizedName) ||
      STOP_WORDS.has(normalizedName)
    ) {
      continue;
    }

    if (!terms.has(normalizedName)) {
      terms.set(normalizedName, term);
    }
  }

  return [...terms.values()];
}

function normalizeTagName(rawValue: string): string {
  return rawValue.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function displayNameFor(rawValue: string): string {
  const normalized = normalizeTagName(rawValue);

  if (!normalized) {
    return "";
  }

  return normalized
    .split(" ")
    .map((part) => part.charAt(0).toLocaleUpperCase("en-US") + part.slice(1))
    .join(" ");
}
