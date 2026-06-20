import { loadAllDocuments } from "@/lib/wiki";

/**
 * Block 4 검증용. 운영 코드 아님 — Day 1~2 내내 디버그용으로만 씀.
 * GET /api/debug/wiki → wiki 전체 파일 개수, source 분류, 길이 요약.
 */
export async function GET() {
  try {
    const docs = await loadAllDocuments();
    return Response.json({
      count: docs.length,
      bySource: {
        manual: docs.filter((d) => d.source === "manual").length,
        curated: docs.filter((d) => d.source === "curated").length,
      },
      files: docs.map((d) => ({
        path: d.path,
        source: d.source,
        contentLength: d.content.length,
      })),
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }
}
