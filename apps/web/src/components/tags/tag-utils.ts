import { normalizeTagDraft } from "../library-state";

export function uniqueTagNames(tagNames: string[]): string[] {
  const tags = new Map<string, string>();

  for (const tagName of tagNames) {
    const displayName = normalizeTagDraft(tagName);

    if (!displayName) {
      continue;
    }

    const normalizedName = displayName.toLocaleLowerCase("en-US");

    if (!tags.has(normalizedName)) {
      tags.set(normalizedName, displayName);
    }
  }

  return [...tags.values()];
}
