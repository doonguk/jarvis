import Anthropic from "@anthropic-ai/sdk";
import { search } from "@/lib/search";
import { buildPrompt } from "@/lib/prompt";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// 클라이언트가 보낼 메시지 모양 (page.tsx의 Message 타입과 동일)
type ChatMessage = { role: "user" | "assistant"; content: string };

/**
 * RAG 챗 라우트 (Block 11).
 *
 * 흐름:
 *   1. messages 받기 (클라이언트의 user 원본 + 과거 assistant 응답들)
 *   2. 마지막 user 메시지 = 현재 검색 쿼리
 *   3. search(query, k=3, weighted=true) → top-3 위키 hits
 *   4. buildPrompt(query, hits) → { system, userMessage }
 *   5. 마지막 user 메시지를 컨텍스트 박힌 userMessage로 교체 (enrich)
 *      과거 messages는 원본 그대로 — history는 깨끗하게 유지
 *   6. Anthropic 호출 → 응답 텍스트 + usage 반환
 *
 * Multi-turn 정책 (A 옵션): 매 턴마다 마지막 user 메시지로 새 검색.
 * 클라이언트는 user 원본 메시지만 history로 들고 있음 — 서버 측에서만 enrich.
 *   → 토큰 효율 ↑ (history에 위키 컨텍스트 누적 안 됨)
 *   → 주제 전환 시 새 검색으로 다른 컨텍스트로 자연스럽게 이동
 *
 * usage 노출 이유: 컨텍스트 크기가 페이지 통째라 응답당 1.5만~3만 토큰.
 * 청킹 도입(1주차) 트리거 모니터링 + spending limit 닳음 추적용.
 */
export async function POST(request: Request) {
  try {
    const { messages } = (await request.json()) as { messages: ChatMessage[] };

    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json(
        { error: "messages 배열이 비어 있음" },
        { status: 400 }
      );
    }

    // 마지막 메시지는 반드시 user (방금 사용자가 친 질문). assistant면 잘못된 호출.
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== "user") {
      return Response.json(
        { error: "마지막 메시지는 user여야 함" },
        { status: 400 }
      );
    }

    const query = lastMessage.content;
    const hits = await search(query, 3, { weighted: true });
    const { system, userMessage } = buildPrompt(query, hits);

    // 마지막 user 메시지만 컨텍스트 박힌 버전으로 교체.
    // 과거 messages는 원본 그대로 → 다음 턴의 history도 깨끗.
    const enrichedMessages: ChatMessage[] = [
      ...messages.slice(0, -1),
      { role: "user", content: userMessage },
    ];

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system,
      messages: enrichedMessages,
    });

    // response.content는 ContentBlock[] (text/tool_use 등). text만 합침
    const text = response.content
      .filter(
        (block): block is { type: "text"; text: string } & typeof block =>
          block.type === "text"
      )
      .map((block) => block.text)
      .join("");

    return Response.json({
      text,
      usage: response.usage,
      // 디버그용 RAG 메타. 클라이언트 UI엔 안 쓰지만 dev 콘솔/네트워크 탭에서 확인.
      rag: {
        query,
        hitCount: hits.length,
        hits: hits.map((hit) => ({
          path: hit.path,
          source: hit.source,
          score: +hit.score.toFixed(4),
        })),
      },
    });
  } catch (error) {
    console.error("[/api/chat] error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "unknown" },
      { status: 500 }
    );
  }
}
