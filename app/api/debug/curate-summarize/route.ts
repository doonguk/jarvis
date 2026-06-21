import { fetchHackerNewsStories } from "@/lib/curate/hn";
import { summarizeStories } from "@/lib/curate/summarize";

/**
 * Block 16 검증용. 운영 라우트 아님.
 *
 * GET /api/debug/curate-summarize
 *   ?query=AI       (HN Algolia 풀텍스트 쿼리, 기본 "AI")
 *   &maxHits=10     (LLM 호출 전 fetch 개수, 기본 10 — 디버그 비용 절약용)
 *   &minPoints=50
 *   &withinDays=7
 *
 * 응답:
 *   - fetched: HN에서 받은 스토리 개수
 *   - summarized: LLM이 채워준 요약 개수
 *   - relevantCount: isAiRelevant=true 개수 (Block 17이 저장할 후보 수)
 *   - results: SummarizedStory[]
 *
 * 디폴트 maxHits를 30이 아닌 10으로 잡은 이유: LLM 호출 1번에 토큰 ~10K → ~$0.10.
 * 디버그 호출 반복 시 비용 빨림. 운영 큐레이션(Block 18)에서는 30 사용.
 */
export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const query = requestUrl.searchParams.get("query") ?? undefined;
    const maximumHitsRaw = requestUrl.searchParams.get("maxHits");
    const minimumPointsRaw = requestUrl.searchParams.get("minPoints");
    const withinDaysRaw = requestUrl.searchParams.get("withinDays");

    const fetchedStories = await fetchHackerNewsStories({
      query,
      maximumHits: maximumHitsRaw ? Number(maximumHitsRaw) : 10,
      minimumPoints: minimumPointsRaw ? Number(minimumPointsRaw) : undefined,
      withinDays: withinDaysRaw ? Number(withinDaysRaw) : undefined,
    });

    const summarizedStories = await summarizeStories(fetchedStories);
    const relevantCount = summarizedStories.filter(
      (story) => story.isAiRelevant
    ).length;

    return Response.json({
      fetched: fetchedStories.length,
      summarized: summarizedStories.length,
      relevantCount,
      results: summarizedStories,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "unknown" },
      { status: 500 }
    );
  }
}
