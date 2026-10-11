import { useEffect, useState } from "react";
import { suggestTags, type TagRecord } from "../../api/client";

export function useTagSuggestions({
  enabled = true,
  limit = 8,
  query
}: {
  enabled?: boolean;
  limit?: number;
  query: string;
}): TagRecord[] {
  const [suggestions, setSuggestions] = useState<TagRecord[]>([]);
  const normalizedQuery = query.trim();

  useEffect(() => {
    if (!enabled || !normalizedQuery) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      suggestTags({ query: normalizedQuery, limit, signal: controller.signal })
        .then((response) => {
          if (!controller.signal.aborted) {
            setSuggestions(response.tags);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setSuggestions([]);
          }
        });
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [enabled, limit, normalizedQuery]);

  return suggestions;
}
