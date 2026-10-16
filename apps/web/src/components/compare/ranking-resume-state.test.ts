import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RankingResumeState } from "./ranking-resume-state";

const mutationId = "d1bca270-9a54-4ca6-b3d9-ddeed5982c47";
const otherMutationId = "e15ab9e7-8f93-4cce-8611-d19fe3a95df6";
const checkpoint: RankingResumeState = {
  contextKey: "folder/image/unranked",
  comparisonGeneration: otherMutationId,
  pairAssetIds: ["right", "left"],
  previousDecision: {
    eventId: mutationId,
    pairAssetIds: ["previous-left", "previous-right"]
  },
  pending: null
};

describe("ranking resume checkpoint", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("restores ordered IDs and Undo only in the matching filter context", async () => {
    const stored = JSON.stringify({ version: 1, ...checkpoint });
    vi.stubGlobal("window", { localStorage: { getItem: () => stored } });
    const resume = await import("./ranking-resume-state");
    expect(resume.readRankingResumeState(checkpoint.contextKey)).toEqual(
      checkpoint
    );
    expect(resume.readRankingResumeState("another-folder")).toBeNull();
  });

  it("rejects malformed, old and inconsistent mutation checkpoints", async () => {
    const { parseRankingResumeState } = await import("./ranking-resume-state");
    for (const serialized of [
      "bad-json",
      "x".repeat(8_193),
      JSON.stringify({ version: 0, ...checkpoint }),
      JSON.stringify({
        version: 1,
        ...checkpoint,
        pairAssetIds: ["same", "same"]
      }),
      JSON.stringify({
        version: 1,
        ...checkpoint,
        pending: {
          kind: "choice",
          mutationId,
          pairAssetIds: ["left", "right"],
          winnerAssetId: "elsewhere"
        }
      })
    ]) {
      expect(parseRankingResumeState(serialized)).toBeNull();
    }
  });

  it("keeps working in memory when storage reads and writes fail", async () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("quota");
        },
        removeItem: () => {
          throw new Error("blocked");
        }
      }
    });
    const resume = await import("./ranking-resume-state");
    resume.writeRankingResumeState(
      checkpoint,
      resume.rankingResumeGeneration()
    );
    expect(resume.readRankingResumeState(checkpoint.contextKey)).toEqual(
      checkpoint
    );
    expect(() => resume.clearRankingResumeState()).not.toThrow();
    expect(resume.readRankingResumeState(checkpoint.contextKey)).toBeNull();
  });

  it("does not let an old response recreate state after logout or reset", async () => {
    const resume = await import("./ranking-resume-state");
    const generation = resume.rankingResumeGeneration();
    resume.writeRankingResumeState(checkpoint, generation);
    resume.clearRankingResumeState();
    expect(resume.writeRankingResumeState(checkpoint, generation)).toBe(false);
    expect(resume.readRankingResumeState(checkpoint.contextKey)).toBeNull();
  });

  it("accepts the first pending receipt and rejects late competing completions", async () => {
    const resume = await import("./ranking-resume-state");
    const pending = {
      ...checkpoint,
      pending: {
        kind: "choice" as const,
        mutationId,
        pairAssetIds: ["left", "right"] as [string, string],
        winnerAssetId: "left"
      }
    };
    const generation = resume.rankingResumeGeneration();
    resume.writeRankingResumeState(pending, generation);
    expect(
      resume.completeRankingMutation(checkpoint, otherMutationId, generation)
    ).toBe(false);
    expect(
      resume.completeRankingMutation(checkpoint, mutationId, generation)
    ).toBe(true);
    expect(
      resume.completeRankingMutation(
        { ...checkpoint, pairAssetIds: ["stale", "pair"] },
        mutationId,
        generation
      )
    ).toBe(false);
    expect(
      resume.readRankingResumeState(checkpoint.contextKey)?.pairAssetIds
    ).toEqual(["right", "left"]);
  });

  it("retains uncertain intent when navigating to another filter context", async () => {
    const resume = await import("./ranking-resume-state");
    const generation = resume.rankingResumeGeneration();
    const pending = {
      ...checkpoint,
      pending: {
        kind: "choice" as const,
        mutationId,
        pairAssetIds: ["left", "right"] as [string, string],
        winnerAssetId: "left"
      }
    };
    resume.writeRankingResumeState(pending, generation);
    resume.writeRankingResumeState(
      { ...checkpoint, contextKey: "different-folder" },
      generation
    );
    expect(
      resume.readRankingResumeState(checkpoint.contextKey)?.pending?.mutationId
    ).toBe(mutationId);
    expect(
      resume.completeRankingMutation(checkpoint, mutationId, generation)
    ).toBe(true);
    expect(resume.readRankingResumeState("different-folder")).not.toBeNull();
  });

  it("never evicts unresolved intents when the bounded context limit is reached", async () => {
    const resume = await import("./ranking-resume-state");
    const generation = resume.rankingResumeGeneration();
    for (
      let index = 0;
      index < resume.MAX_RANKING_RESUME_CONTEXTS;
      index += 1
    ) {
      expect(
        resume.writeRankingResumeState(
          {
            ...checkpoint,
            contextKey: `folder-${index}`,
            pending: {
              kind: "choice",
              mutationId,
              pairAssetIds: ["left", "right"],
              winnerAssetId: "left"
            }
          },
          generation
        )
      ).toBe(true);
    }
    expect(resume.writeRankingResumeState(checkpoint, generation)).toBe(false);
    expect(resume.readRankingResumeState("folder-0")?.pending).not.toBeNull();
    const settled = { ...checkpoint, contextKey: "folder-0" };
    expect(
      resume.completeRankingMutation(settled, mutationId, generation)
    ).toBe(true);
    expect(resume.writeRankingResumeState(checkpoint, generation)).toBe(true);
    expect(resume.readRankingResumeState("folder-0")).toBeNull();
  });
});
