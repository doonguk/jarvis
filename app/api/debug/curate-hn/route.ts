import { fetchHackerNewsStories } from "@/lib/curate/hn";

/**
 * Block 15 검증용. 운영 라우트 아님.
 *
 * GET /api/debug/curate-hn
 *   ?query=AI            (기본 "AI")
 *   &minPoints=50        (기본 50)
 *   &maxHits=30          (기본 30)
 *   &withinDays=7        (기본 7)
 *
 * 응답: 가져온 스토리 count + 전체 배열.
 * 가져온 raw 데이터 점검용. 분류/요약은 Block 16에서.
 */
export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const query = requestUrl.searchParams.get("query") ?? undefined;
    const minimumPointsRaw = requestUrl.searchParams.get("minPoints");
    const maximumHitsRaw = requestUrl.searchParams.get("maxHits");
    const withinDaysRaw = requestUrl.searchParams.get("withinDays");

    const stories = await fetchHackerNewsStories({
      query,
      minimumPoints: minimumPointsRaw ? Number(minimumPointsRaw) : undefined,
      maximumHits: maximumHitsRaw ? Number(maximumHitsRaw) : undefined,
      withinDays: withinDaysRaw ? Number(withinDaysRaw) : undefined,
    });

    return Response.json({
      count: stories.length,
      stories,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "unknown" },
      { status: 500 }
    );
  }
}
