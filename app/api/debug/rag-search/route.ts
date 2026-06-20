import { search } from "@/lib/search";
import { embedOne } from "@/lib/embed";

/**
 * Block 9 측정용. 가중치 적용 전/후 검색 결과를 한 응답으로 비교.
 *
 * GET /api/debug/rag-search?q=쿼리&k=5
 *
 * 같은 쿼리로 weighted=false / true 두 결과를 함께 반환.
 * 쿼리 임베딩은 1번만 호출 (Voyage 비용 절약).
 *
 * 측정 흐름:
 *   Day 1 baseline 5쿼리를 그대로 돌려서 raw vs weighted 순위 변동 확인.
 *   - manual이 위로 올라오는지
 *   - top-1이 바뀌는 쿼리가 있는지
 *   효과 없으면 가중치 빼고 1주차 청킹 도입으로 직행.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("q");
    const k = Math.max(1, Math.min(10, Number(url.searchParams.get("k") ?? 5)));

    if (!q) {
      return Response.json(
        {
          error: "q 파라미터 필수",
          example: "/api/debug/rag-search?q=React%20setState&k=5",
        },
        { status: 400 }
      );
    }

    const startedAt = Date.now();
    const queryVector = await embedOne(q, "query");
    const [raw, weighted] = await Promise.all([
      search(q, k, { weighted: false, precomputedVector: queryVector }),
      search(q, k, { weighted: true, precomputedVector: queryVector }),
    ]);
    const elapsedMs = Date.now() - startedAt;

    const fmt = (hits: typeof raw) =>
      hits.map((h) => ({
        path: h.path,
        source: h.source,
        score: +h.score.toFixed(4),
        rawScore: +h.rawScore.toFixed(4),
        weight: h.weight,
        preview: h.preview,
      }));

    return Response.json({
      query: q,
      k,
      elapsedMs,
      raw: fmt(raw),
      weighted: fmt(weighted),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "unknown" },
      { status: 500 }
    );
  }
}
