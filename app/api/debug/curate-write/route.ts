import { fetchHackerNewsStories } from "@/lib/curate/hn";
import { summarizeStories } from "@/lib/curate/summarize";
import { writeCuratedFile } from "@/lib/curate/writer";

/**
 * Block 17 검증용. 운영 라우트 아님 (운영은 Block 18 /api/curate).
 *
 * GET /api/debug/curate-write
 *   ?query=AI       (HN Algolia query, 기본 "AI")
 *   &maxHits=5      (디버그 비용 절약 기본 5, 운영은 30)
 *   &minPoints=50
 *   &withinDays=7
 *
 * 응답: WriteCuratedResult — 어디 썼고 몇 개 들어갔는지.
 *
 * 주의: 이 라우트 호출하면 wiki 디스크에 실제 파일이 박힘. 디버그 호출 자제.
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
      maximumHits: maximumHitsRaw ? Number(maximumHitsRaw) : 5,
      minimumPoints: minimumPointsRaw ? Number(minimumPointsRaw) : undefined,
      withinDays: withinDaysRaw ? Number(withinDaysRaw) : undefined,
    });

    const summarizedStories = await summarizeStories(fetchedStories);
    const writeResult = await writeCuratedFile(summarizedStories);

    return Response.json({
      fetched: fetchedStories.length,
      summarized: summarizedStories.length,
      ...writeResult,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "unknown" },
      { status: 500 }
    );
  }
}
