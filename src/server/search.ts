export type SearchDoc = {
  id: string;
  title: string;
  publishedOn: string | null;
  rights: string;
  text: string;
};

export type Ranked = {
  id: string;
  score: number;
  hits: string[];
  method: string;
};

const METHOD =
  "질의에서 두 글자 이상인 토큰이 제목·본문에 들어 있으면 토큰 길이만큼 점수를 더합니다. 검색 순위를 위한 점수이며 확률이나 위기 가능성이 아닙니다.";

export function tokensOf(query: string): string[] {
  const parts = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}/]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  return [...new Set(parts)];
}

export function scoreText(query: string, text: string, title = ""): { score: number; hits: string[] } {
  const hay = text.toLowerCase();
  const heading = title.toLowerCase();
  const hits: string[] = [];
  let score = 0;
  for (const token of tokensOf(query)) {
    const needle = token.toLowerCase();
    if (hay.includes(needle) || heading.includes(needle)) {
      score += token.length;
      if (heading.includes(needle)) score += token.length * 2;
      hits.push(token);
    }
  }
  return { score, hits };
}

export function rankDocuments(
  query: string,
  docs: SearchDoc[],
  opts: { includeRestricted?: boolean; limit?: number } = {},
): Ranked[] {
  const ranked: Ranked[] = [];
  for (const doc of docs) {
    if (doc.rights === "restricted" && !opts.includeRestricted) continue;
    const { score, hits } = scoreText(query, doc.text, doc.title);
    if (score <= 0) continue;
    ranked.push({ id: doc.id, score, hits, method: METHOD });
  }
  ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return ranked.slice(0, opts.limit ?? 5);
}

export function eligibleByTime(
  publishedOn: string | null,
  mode: "as_of" | "hindsight",
  asOf: string,
): { include: boolean; warning: string | null } {
  if (mode === "hindsight") {
    if (publishedOn && publishedOn > asOf.slice(0, 10)) {
      return { include: true, warning: "사후 자료" };
    }
    if (!publishedOn) return { include: true, warning: "발행일 미확인" };
    return { include: true, warning: null };
  }
  if (!publishedOn) {
    return { include: false, warning: "발행일 미확인으로 당시 판단 모드에서 제외" };
  }
  if (publishedOn > asOf.slice(0, 10)) {
    return { include: false, warning: "기준일 이후 발행" };
  }
  return { include: true, warning: null };
}

export const SCORE_METHOD = METHOD;
