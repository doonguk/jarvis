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

/**
 * source 가중치 (스펙 v3.1 §3 Day 2).
 *
 * 같은 코사인 점수라도 내가 직접 쓴 manual이 외부 복붙 curated보다
 * 위로 올라오게 점수(스칼라)에 곱한다. curated가 manual을 이기려면
 * 유사도 격차가 0.6 핸디캡을 극복할 만큼 커야 함.
 *
 * 주의: 벡터 자체에 곱하면 방향이 안 바뀌어 코사인 결과가 동일 — 의미 없음.
 * 반드시 cosine 결과(스칼라)에 곱한다.
 *
 * 이 수치(1.0/0.6)는 측정 없이 박은 직관값. Block 9에서 raw vs weighted
 * top-K를 비교해 효과 없으면 빼거나 조정한다.
 */
export const SOURCE_WEIGHT: Record<Source, number> = {
  manual: 1.0,
  curated: 0.6,
};

export type SearchHit = {
  path: string;
  source: Source;
  /** 정렬 기준 최종 점수. weighted=true면 rawScore * weight, false면 rawScore와 동일. */
  score: number;
  /** 가중치 적용 전 코사인 유사도. 비교/디버그용. */
  rawScore: number;
  /** 이 문서에 적용된 source 가중치. */
  weight: number;
  /**
   * 문서 본문 전체. Block 10에서 buildPrompt가 Claude 컨텍스트로 박을 때 사용.
   * Day 1은 청킹 X라 페이지 통째 — 1주차 청킹 도입 후엔 chunk 단위로 바뀜.
   */
  content: string;
  /** 디버그 가독성용 미리보기 (앞 120자) */
  preview: string;
};

export type SearchOptions = {
  /**
   * source 가중치를 score에 곱할지 여부.
   * 기본 false — Day 1 baseline 동작 보존. RAG 라우트(Block 11)에선 true로 호출.
   */
  weighted?: boolean;
  /**
   * 미리 계산해 둔 쿼리 임베딩 재사용.
   * 같은 쿼리로 두 번 검색하는 디버그 라우트(weighted vs raw 비교)에서
   * Voyage 호출을 1회로 줄이기 위함.
   */
  precomputedVector?: number[];
};

/**
 * 쿼리 → top-K wiki 문서.
 *
 * 중요: inputType="query" — Voyage는 인덱싱(document)과 검색(query) 벡터가
 * 살짝 다르게 나옴. 같은 텍스트라도 쪽 다른 임베딩.
 */
export async function search(
  query: string,
  k = 3,
  options: SearchOptions = {}
): Promise<SearchHit[]> {
  const { weighted = false, precomputedVector } = options;
  const queryVector = precomputedVector ?? (await embedOne(query, "query"));
  const index = await getIndex();

  const scored: SearchHit[] = index.map((document) => {
    const rawScore = cosine(queryVector, document.vector);
    const weight = SOURCE_WEIGHT[document.source];
    return {
      path: document.path,
      source: document.source,
      rawScore,
      weight,
      score: weighted ? rawScore * weight : rawScore,
      content: document.content,
      preview: document.content.slice(0, 120).replace(/\s+/g, " "),
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
