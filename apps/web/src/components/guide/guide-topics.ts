export const guideTopics = [
  ["browse", "Browse"],
  ["edit", "Edit media"],
  ["ranking", "Rank media"],
  ["manage", "Manage media"],
  ["files", "Media files"],
  ["help", "Help"]
] as const;

export type GuideTopic = (typeof guideTopics)[number][0];

export function parseGuideTopic(value: unknown): GuideTopic {
  return guideTopics.find(([id]) => id === value)?.[0] ?? "browse";
}
