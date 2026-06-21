import { fetchHackerNewsStories } from "@/lib/curate/hn";
import { summarizeStories } from "@/lib/curate/summarize";
import { writeCuratedFile } from "@/lib/curate/writer";
import { invalidateIndex } from "@/lib/store";

/**
 * Block 18 — 운영 큐레이션 트리거 (수동).
 *
 * POST /api/curate
 *   query string으로 옵션 override 가능 (cron 호출은 옵션 없이 디폴트 사용):
 *     ?query=AI         (HN Algolia 풀텍스트 쿼리)
 *     &maxHits=30       (운영 디폴트 30)
 *     &minPoints=50
 *     &withinDays=7
 *
 * 메서드: POST.
 * - 부수효과 있음 (디스크 변경 + 외부 API 호출 + LLM 호출 ~$0.10/회)
 * - GET은 cache·prefetch 위험. cron/툴들도 보통 부수효과 트리거는 POST.
 *
 * 처리: 동기. fetch + LLM + write 다 끝난 뒤 결과 응답.
 * - 30개 묶음 LLM 호출이 30~60초 소요. cron 호출자는 대기 안 해서 OK.
 * - 사용자 수동 호출 시 답답 → 1주차에 백그라운드 큐 고려.
 *
 * 인덱스 반영: Block 19에서 invalidate 메커니즘 박은 뒤에야 즉시 검색 가능.
 * Block 18 단독으로는 디스크에 파일은 생기지만 chat 검색에는 아직 안 보임 (서버 재시작 필요).
 */
export async function POST(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const query = requestUrl.searchParams.get("query") ?? undefined;
    const maximumHitsRaw = requestUrl.searchParams.get("maxHits");
    const minimumPointsRaw = requestUrl.searchParams.get("minPoints");
    const withinDaysRaw = requestUrl.searchParams.get("withinDays");

    const fetchedStories = await fetchHackerNewsStories({
      query,
      maximumHits: maximumHitsRaw ? Number(maximumHitsRaw) : undefined,
      minimumPoints: minimumPointsRaw ? Number(minimumPointsRaw) : undefined,
      withinDays: withinDaysRaw ? Number(withinDaysRaw) : undefined,
    });

    const summarizedStories = await summarizeStories(fetchedStories);
    const writeResult = await writeCuratedFile(summarizedStories);

    /**
     * Block 19 — write 끝나면 인덱스 무효화.
     * 다음 chat 호출이 cold-start로 wiki 전체 재빌드 → 새 curated 파일이 검색에 즉시 반영.
     */
    invalidateIndex();

    return Response.json({
      fetched: fetchedStories.length,
      summarized: summarizedStories.length,
      ...writeResult,
      indexInvalidated: true,
    });
  } catch (error) {
    console.error("[/api/curate] error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "unknown" },
      { status: 500 }
    );
  }
}
