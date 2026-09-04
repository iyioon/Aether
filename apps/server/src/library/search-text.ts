const CJK_SEARCH_CHAR_PATTERN =
  /[\u1100-\u11ff\u3130-\u318f\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/u;
const MAX_SEARCH_TERMS = 8;
const MAX_NGRAM_SOURCE_LENGTH = 96;
const MAX_NGRAM_LENGTH = 12;

export function assetSearchQuery(query: string): string {
  const terms = searchTerms(query);

  return terms.map((term) => `${term}*`).join(" AND ");
}

export function searchNgramText(input: string): string {
  const terms = new Set<string>();

  for (const term of searchTerms(input, null)) {
    if (!CJK_SEARCH_CHAR_PATTERN.test(term)) {
      continue;
    }

    const chars = [...term].slice(0, MAX_NGRAM_SOURCE_LENGTH);

    for (let start = 0; start < chars.length; start += 1) {
      const maxEnd = Math.min(chars.length, start + MAX_NGRAM_LENGTH);

      for (let end = start + 1; end <= maxEnd; end += 1) {
        terms.add(chars.slice(start, end).join(""));
      }
    }
  }

  return [...terms].join(" ");
}

function searchTerms(
  input: string,
  limit: number | null = MAX_SEARCH_TERMS
): string[] {
  const terms =
    input
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .match(/[\p{L}\p{N}]+/gu)
      ?? [];

  return limit === null ? terms : terms.slice(0, limit);
}
