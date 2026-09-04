import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/config.js";
import { openDatabase } from "../src/db/database.js";
import { resolveAssetFile } from "../src/library/media-serving.js";
import {
  folderIdFor,
  listAssets,
  setAssetTags
} from "../src/library/repository.js";
import { scanLibrary } from "../src/library/scanner.js";
import {
  type AiTagFetch,
  suggestAiAssetTags
} from "../src/library/ai-tag-suggestions.js";

describe("AI tag suggestions", () => {
  it("parses reviewed local Ollama tags without saving them", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "aether-ai-tags-"));
    await mkdir(path.join(cwd, "media"));
    await sharp({
      create: {
        width: 24,
        height: 18,
        channels: 3,
        background: "#87a2b0"
      }
    })
      .png()
      .toFile(path.join(cwd, "media", "beach-family.png"));

    const config = await loadConfig(
      {
        AETHER_MEDIA_ROOTS: "./media",
        AETHER_CONFIG_DIR: "./config",
        AETHER_CACHE_DIR: "./cache",
        AETHER_AI_PROVIDER: "ollama",
        AETHER_OLLAMA_BASE_URL: "http://127.0.0.1:11434/",
        AETHER_OLLAMA_VISION_MODEL: "llava:test",
        NODE_ENV: "test"
      },
      cwd
    );
    const db = openDatabase(config.configDir);

    try {
      await scanLibrary(db, config.mediaRoots);
      const root = config.mediaRoots[0]!;
      const asset = listAssets(db, {
        folderId: folderIdFor(root.id, ""),
        offset: 0,
        limit: 10,
        sort: "filename",
        type: "all",
        recursive: true
      })?.items[0];

      if (!asset) {
        throw new Error("Expected indexed AI fixture asset.");
      }

      setAssetTags(db, asset.id, ["Beach"]);
      const file = await resolveAssetFile(db, asset.id);

      if (!file) {
        throw new Error("Expected resolved AI fixture asset.");
      }

      const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
      const fetchImpl: AiTagFetch = async (url, init) => {
        calls.push({
          url,
          body: JSON.parse(init.body) as Record<string, unknown>
        });

        return {
          ok: true,
          status: 200,
          async json() {
            return {
              response:
                '{"tags":["Beach","Family portrait","image","Sunset Sky","Family portrait"]}'
            };
          },
          async text() {
            return "";
          }
        };
      };

      const result = await suggestAiAssetTags({
        db,
        config,
        file,
        limit: 4,
        fetchImpl
      });

      expect(calls[0]?.url).toBe("http://127.0.0.1:11434/api/generate");
      expect(calls[0]?.body).toMatchObject({
        model: "llava:test",
        stream: false,
        format: "json"
      });
      expect(result).toMatchObject({
        provider: "ollama",
        model: "llava:test"
      });
      expect(result.suggestions).toEqual([
        {
          displayName: "Family Portrait",
          normalizedName: "family portrait",
          confidence: 0.82,
          source: "local-ai",
          reason: "Ollama vision analysis"
        },
        {
          displayName: "Sunset Sky",
          normalizedName: "sunset sky",
          confidence: 0.82,
          source: "local-ai",
          reason: "Ollama vision analysis"
        }
      ]);

      const malformedFetch: AiTagFetch = async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            response: "tags may include {not valid json"
          };
        },
        async text() {
          return "";
        }
      });
      const malformedResult = await suggestAiAssetTags({
        db,
        config,
        file,
        limit: 4,
        fetchImpl: malformedFetch
      });

      expect(malformedResult.suggestions).toEqual([]);
    } finally {
      db.close();
      await rm(cwd, { force: true, recursive: true });
    }
  });
});
