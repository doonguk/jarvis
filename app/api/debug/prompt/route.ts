import { search } from "@/lib/search";
import { buildPrompt } from "@/lib/prompt";

/**
 * Block 10 검증용. Block 11에서 `/api/chat`이 RAG로 교체되기 전,
 * 빌더가 만드는 프롬프트 형태를 미리 눈으로 확인.
 *
 * GET /api/debug/prompt?q=쿼리&k=3
 *
 * 흐름: 쿼리 → search(weighted=true) → buildPrompt → 결과 JSON.
 *
 * 보는 포인트:
 *   - hitSummary: 어느 페이지가 컨텍스트로 박혔나
 *   - systemPrompt: 규칙 5개 그대로 박혔나
 *   - userMessage: <wiki_doc page="[[...]]"> 형식이 인용 강제로 작동할 만한가
 *   - userMessage 길이: 토큰 폭주 위험 (1주차 청킹 도입 트리거)
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("q");
    const k = Math.max(1, Math.min(10, Number(url.searchParams.get("k") ?? 3)));

    if (!query) {
      return Response.json(
        {
          error: "q 파라미터 필수",
          example: "/api/debug/prompt?q=React%20setState&k=3",
        },
        { status: 400 }
      );
    }

    const startedAt = Date.now();
    const hits = await search(query, k, { weighted: true });
    const prompt = buildPrompt(query, hits);
    const elapsedMs = Date.now() - startedAt;

    return Response.json({
      query,
      k,
      elapsedMs,
      hitCount: hits.length,
      hitSummary: hits.map((hit) => ({
        path: hit.path,
        source: hit.source,
        score: +hit.score.toFixed(4),
        contentLength: hit.content.length,
      })),
      systemPrompt: prompt.system,
      userMessage: prompt.userMessage,
      userMessageLength: prompt.userMessage.length,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "unknown" },
      { status: 500 }
    );
  }
}
