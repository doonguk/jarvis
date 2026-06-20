import { getIndex } from "./store";
import { embedOne } from "./embed";
import type { Source } from "./wiki";

/**
 * 코사인 유사도. 두 벡터의 "방향이 얼마나 비슷한가" (-1 ~ 1).
 *
 * 공식:  cos(a, b) = dot(a, b) / (||a|| * ||b||)
 *
 * Voyage 임베딩은 보통 unit vector(||v|| = 1)로 반환되므로
 * 이론적으론 dot product만으로 충분. 안전하게 정규화도 같이 계산.
 * (벡터 차원 1024, 비교 대상 ~10개라 비용 무시 가능.)
 */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: 차원 불일치 (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export type SearchHit = {
  path: string;
  source: Source;
  score: number;
  /** 디버그 가독성용 미리보기 (앞 120자) */
  preview: string;
};

/**
 * 쿼리 → top-K wiki 문서.
 *
 * 중요: inputType="query" — Voyage는 인덱싱(document)과 검색(query) 벡터가
 * 살짝 다르게 나옴. 같은 텍스트라도 쪽 다른 임베딩.
 *
 * Day 2에서 추가될 것:
 * - source 가중치 (manual=1.0, curated=0.6) → final score 곱셈
 * - Top-K 결과를 Claude 컨텍스트로 합쳐 답변 생성 + 인용
 */
export async function search(query: string, k = 3): Promise<SearchHit[]> {
  const queryVec = await embedOne(query, "query");
  const index = await getIndex();

  const scored: SearchHit[] = index.map((doc) => ({
    path: doc.path,
    source: doc.source,
    score: cosine(queryVec, doc.vector),
    preview: doc.content.slice(0, 120).replace(/\s+/g, " "),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
