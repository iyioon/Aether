import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config/config.js";
import type { AetherDatabase } from "../db/database.js";
import { resetLibraryData } from "./repository.js";
import { LibraryDataResetBody } from "./route-schemas.js";
import type { LibraryScanner } from "./scanner.js";
import type { LibraryWatcher } from "./watcher.js";

export function registerAdminRoutes(
  app: FastifyInstance,
  config: AppConfig,
  db: AetherDatabase,
  scanner: LibraryScanner,
  watcher: LibraryWatcher | null
): void {
  app.post("/api/admin/scan", async (_request, reply) => {
    const job = scanner.startScan();
    return reply.code(202).send({ status: job.status, jobId: job.id });
  });

  app.get("/api/admin/jobs", async () => ({
    jobs: scanner.listJobs().map((job) => ({
      id: job.id,
      type: job.type,
      status: job.status,
      attempts: job.attempts,
      error: job.error,
      result: parseJobResult(job.result),
      progress: job.progress,
      createdAt: job.created_at,
      updatedAt: job.updated_at
    }))
  }));

  app.get(
    "/api/admin/watch",
    async () =>
      watcher?.status() ?? {
        enabled: false,
        running: false,
        debounceMs: config.watchDebounceMs,
        watchedDirectories: 0,
        lastEventAt: null,
        lastScanJobId: null,
        lastError: null
      }
  );

  app.get("/api/admin/ai", async () => ({
    enabled: config.aiProvider !== "disabled",
    provider: config.aiProvider,
    model: config.aiProvider === "ollama" ? config.ollamaVisionModel : null
  }));

  app.get("/api/admin/settings", async () => ({
    server: {
      environment: process.env.NODE_ENV ?? "development",
      version: process.env.npm_package_version ?? null
    },
    library: {
      mediaRootCount: config.mediaRoots.length,
      mediaRoots: config.mediaRoots.map((root) => ({
        id: root.id,
        label: root.label
      })),
      watchEnabled: config.watchEnabled,
      watchDebounceMs: config.watchDebounceMs
    },
    security: {
      passwordConfigured: Boolean(config.passwordHash),
      cookieSecure: config.cookieSecure,
      trustProxy: config.trustProxy,
      sessionTtlDays: config.sessionTtlDays,
      loginMaxAttempts: config.loginMaxAttempts,
      loginWindowMinutes: Math.round(config.loginWindowMs / 60_000),
      loginLockoutMinutes: Math.round(config.loginLockoutMs / 60_000)
    },
    ai: {
      enabled: config.aiProvider !== "disabled",
      provider: config.aiProvider,
      model: config.aiProvider === "ollama" ? config.ollamaVisionModel : null,
      timeoutMs: config.aiTimeoutMs
    }
  }));

  app.post("/api/admin/database/reset", async (request, reply) => {
    const body = LibraryDataResetBody.safeParse(request.body);

    if (!body.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    return resetLibraryData(db, body.data, new Date().toISOString());
  });
}

function parseJobResult(result: string | null): unknown {
  if (!result) {
    return null;
  }

  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}
