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
 * 원래 도입 동기: "내 손글 manual이 외부 큐레이션 curated보다 우선" 직관.
 * curated × 0.6 핸디캡으로 유사도 격차가 작아도 manual이 위로 오게 함.
 *
 * **Block 20 (2026-06-21) 측정 결과 — 가중치 폐기 결정:**
 * - 5 baseline 쿼리: 가중치 효과 0 (curated 애초에 top-3 미진입)
 * - 1 curated 매칭 쿼리("Linear A 해독 AI"): rawScore 0.4659 매우 강한 매칭이
 *   × 0.6 = 0.2796으로 밀려 무관한 manual learn 노트들에 top-1 자리 빼앗김.
 * - 손익: "맞춰주는 케이스 0건 + 망치는 케이스 1건" → 명백한 마이너스.
 * → 1.0 통일로 가중치 무력화.
 *
 * weighted 옵션 자체는 코드 호환성 위해 유지 (효과 0). 1주차에 가중치 로직
 * 자체 제거 또는 다른 기준(시간 가중치, 메타 가중치 등)으로 재설계.
 *
 * 자세한 측정 데이터: [[RAG-Day1-baseline-평가]] Day 3 섹션.
 */
export const SOURCE_WEIGHT: Record<Source, number> = {
  manual: 1.0,
  curated: 1.0,
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
