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

    let active = true;
    const timer = window.setTimeout(() => {
      suggestTags({ query: normalizedQuery, limit })
        .then((response) => {
          if (active) {
            setSuggestions(response.tags);
          }
        })
        .catch(() => {
          if (active) {
            setSuggestions([]);
          }
        });
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [enabled, limit, normalizedQuery]);

  return suggestions;
}
