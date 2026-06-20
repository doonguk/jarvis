import { search } from "@/lib/search";
import { getIndex } from "@/lib/store";

/**
 * Block 6~7 검증용.
 *
 * GET /api/debug/search           → 인덱스 상태 (몇 개 박혔는지)
 * GET /api/debug/search?q=쿼리    → top-3 검색 결과
 *
 * 첫 호출은 wiki 빌드 + 임베딩으로 ~1.5초 걸림. 두 번째부터 즉시.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("q");

    if (!q) {
      const index = await getIndex();
      return Response.json({
        indexSize: index.length,
        bySource: {
          manual: index.filter((d) => d.source === "manual").length,
          curated: index.filter((d) => d.source === "curated").length,
        },
        sample: index.slice(0, 3).map((d) => ({
          path: d.path,
          source: d.source,
          dims: d.vector.length,
        })),
        hint: "쿼리 검색은 ?q=... 로 호출",
      });
    }

    const t0 = Date.now();
    const hits = await search(q, 3);
    const elapsedMs = Date.now() - t0;

    return Response.json({
      query: q,
      elapsedMs,
      hits: hits.map((h) => ({
        ...h,
        score: +h.score.toFixed(4),
      })),
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }
}
