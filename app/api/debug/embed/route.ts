import { embedOne, embedBatch, EMBED_MODEL } from "@/lib/embed";
import { loadAllDocuments } from "@/lib/wiki";

/**
 * Block 5 검증용.
 * GET /api/debug/embed
 * 1) embedOne으로 짧은 문장 → 차원 확인
 * 2) embedBatch로 wiki 전체 → 토큰/시간/차원 확인
 */
export async function GET() {
  try {
    // 1) 1개 임베딩 — 차원 확인
    const single = await embedOne("hello world", "document");

    // 2) wiki 전체 batch 임베딩
    const docs = await loadAllDocuments();
    const totalChars = docs.reduce((s, d) => s + d.content.length, 0);

    const batch = await embedBatch(
      docs.map((d) => d.content),
      "document"
    );

    return Response.json({
      model: EMBED_MODEL,
      single: {
        dims: single.length,
        sample: single.slice(0, 5).map((n) => +n.toFixed(4)),
      },
      batch: {
        docCount: docs.length,
        vectorCount: batch.vectors.length,
        dims: batch.vectors[0]?.length,
        totalChars,
        totalTokens: batch.totalTokens,
        charsPerToken: +(totalChars / Math.max(batch.totalTokens, 1)).toFixed(
          2
        ),
        elapsedMs: batch.elapsedMs,
        msPerDoc: Math.round(batch.elapsedMs / Math.max(docs.length, 1)),
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "unknown" },
      { status: 500 }
    );
  }
}
