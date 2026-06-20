import { VoyageAIClient } from "voyageai";

const client = new VoyageAIClient({
  apiKey: process.env.VOYAGE_API_KEY!,
});

/**
 * Voyage 모델 선택 (2026-06 기준):
 * - voyage-3        : 1024차원, 기본 추천. 다국어/한국어 OK
 * - voyage-3-large  : 1024차원, 정확도 ↑, 비용 ↑
 * - voyage-3-lite   : 512차원, 저렴 (학습 단계 비용 절약용)
 * - voyage-code-3   : 1024차원, 코드 특화
 *
 * 우리는 한국어 wiki + 코드 섞임 → voyage-3 무난.
 */
export const EMBED_MODEL = "voyage-3";

/**
 * inputType은 Voyage 특화 옵션:
 * - "document" : 인덱싱(저장)할 텍스트
 * - "query"    : 사용자 질문
 *
 * 같은 텍스트라도 어느 쪽으로 임베딩하느냐에 따라 벡터가 다름.
 * 검색 정확도에 직접 영향 → 인덱싱과 검색에서 반드시 구분할 것.
 */
type InputType = "document" | "query";

export type BatchEmbedResult = {
  vectors: number[][];
  /** API 응답의 토큰 사용량 (비용 추적용) */
  totalTokens: number;
  /** 호출 소요 시간 */
  elapsedMs: number;
};

/**
 * 텍스트 1개 → 벡터 1개.
 * 학습용 함수. 운영에서는 embedBatch 권장 (호출당 1개는 비효율).
 */
export async function embedOne(
  text: string,
  inputType: InputType = "document"
): Promise<number[]> {
  const result = await client.embed({
    input: [text],
    model: EMBED_MODEL,
    inputType,
  });
  const vec = result.data?.[0]?.embedding;
  if (!vec) throw new Error("Voyage 응답에 embedding이 없음");
  return vec;
}

/**
 * 텍스트 배열 → 벡터 배열 (같은 순서로 반환).
 *
 * Voyage 제약:
 * - 한 번 호출당 최대 128개
 * - voyage-3 총 토큰 한도 120K
 * - 이 초과 시 분할 호출 필요 (현재는 안 함, 한 달 사이드 1주차에 도입)
 */
export async function embedBatch(
  texts: string[],
  inputType: InputType = "document"
): Promise<BatchEmbedResult> {
  if (texts.length === 0) {
    return { vectors: [], totalTokens: 0, elapsedMs: 0 };
  }
  if (texts.length > 128) {
    throw new Error(
      `embedBatch: 128개 초과 (${texts.length}). 분할 호출 필요 (한 달 사이드 1주차).`
    );
  }

  const t0 = Date.now();
  const result = await client.embed({
    input: texts,
    model: EMBED_MODEL,
    inputType,
  });
  const elapsedMs = Date.now() - t0;

  const vectors =
    result.data
      ?.map((d) => d.embedding)
      .filter((v): v is number[] => Array.isArray(v)) ?? [];

  if (vectors.length !== texts.length) {
    throw new Error(
      `embedBatch: 입력 ${texts.length}개 → 출력 ${vectors.length}개 (불일치)`
    );
  }

  return {
    vectors,
    totalTokens: result.usage?.totalTokens ?? 0,
    elapsedMs,
  };
}
