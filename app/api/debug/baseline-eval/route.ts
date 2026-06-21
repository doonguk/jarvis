import { search } from "@/lib/search";
import { embedOne } from "@/lib/embed";

/**
 * Block 20 — Day 3 baseline 재측정 도구.
 *
 * Day 1 baseline 5쿼리 + Day 3 curated 매칭 검증 쿼리 1개 = 6쿼리.
 * 각 쿼리에 대해 raw vs weighted top-3을 한 번에 돌려서 source 가중치 효과 확인.
 *
 * GET /api/debug/baseline-eval
 *   ?queries=쿼리1,쿼리2,...   (지정 시 override, 기본은 DEFAULT_QUERIES)
 *   &k=3
 *
 * 1회 호출에 Voyage 6번 + 검색 12번. 30~60초 소요. 측정 끝나면 폐기 가능 일회용 도구.
 */

const DEFAULT_QUERIES = [
  "Voyage 임베딩", //         Day 1 baseline #1
  "Electron 단축키", //       Day 1 baseline #2
  "AI 잘 쓰는 개발자", //     Day 1 baseline #3 (KPI)
  "MCP", //                   Day 1 baseline #4
  "내일 뭐 할 거지", //       Day 1 baseline #5
  "Linear A 해독 AI", //      Day 3 curated 매칭 검증
];

type CompactHit = {
  path: string;
  source: string;
  score: number;
  rawScore: number;
  weight: number;
};

type QueryResult = {
  query: string;
  raw: CompactHit[];
  weighted: CompactHit[];
};

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const queriesParam = requestUrl.searchParams.get("queries");
    const queries = queriesParam
      ? queriesParam.split(",").map((q) => q.trim()).filter(Boolean)
      : DEFAULT_QUERIES;
    const k = Math.max(1, Math.min(10, Number(requestUrl.searchParams.get("k") ?? 3)));

    const startedAt = Date.now();
    const results: QueryResult[] = [];

    for (const query of queries) {
      const queryVector = await embedOne(query, "query");
      const [rawHits, weightedHits] = await Promise.all([
        search(query, k, { weighted: false, precomputedVector: queryVector }),
        search(query, k, { weighted: true, precomputedVector: queryVector }),
      ]);

      const compact = (hit: (typeof rawHits)[number]): CompactHit => ({
        path: hit.path,
        source: hit.source,
        score: +hit.score.toFixed(4),
        rawScore: +hit.rawScore.toFixed(4),
        weight: hit.weight,
      });

      results.push({
        query,
        raw: rawHits.map(compact),
        weighted: weightedHits.map(compact),
      });
    }

    const elapsedMs = Date.now() - startedAt;

    /**
     * 요약 메트릭: weighted 적용으로 top-1이 바뀐 쿼리, manual/curated가 top-1인 비율 등.
     * Day 1 baseline 페이지 갱신에 그대로 박을 수 있게 정리.
     */
    const summary = {
      rawTop1ScoreAverage:
        +(
          results.reduce((sum, result) => sum + (result.raw[0]?.score ?? 0), 0) /
          results.length
        ).toFixed(4),
      weightedTop1ScoreAverage:
        +(
          results.reduce(
            (sum, result) => sum + (result.weighted[0]?.score ?? 0),
            0
          ) / results.length
        ).toFixed(4),
      top1ChangedCount: results.filter(
        (result) => result.raw[0]?.path !== result.weighted[0]?.path
      ).length,
      rawTop1BySource: {
        manual: results.filter((result) => result.raw[0]?.source === "manual")
          .length,
        curated: results.filter((result) => result.raw[0]?.source === "curated")
          .length,
      },
      weightedTop1BySource: {
        manual: results.filter(
          (result) => result.weighted[0]?.source === "manual"
        ).length,
        curated: results.filter(
          (result) => result.weighted[0]?.source === "curated"
        ).length,
      },
    };

    return Response.json({
      queries,
      k,
      elapsedMs,
      summary,
      results,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "unknown" },
      { status: 500 }
    );
  }
}
