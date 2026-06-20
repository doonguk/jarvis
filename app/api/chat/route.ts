import Anthropic from "@anthropic-ai/sdk";
import { search } from "@/lib/search";
import { buildPrompt } from "@/lib/prompt";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// 클라이언트가 보낼 메시지 모양 (page.tsx의 Message 타입과 동일)
type ChatMessage = { role: "user" | "assistant"; content: string };

/**
 * RAG 챗 라우트 — SSE 스트리밍 버전 (Block 13).
 *
 * 변경 (Block 11 → Block 13):
 *   - Anthropic 호출을 `messages.stream`으로 바꿔 토큰 단위 이벤트 받기
 *   - 받은 토큰을 SSE 포맷으로 클라이언트에 흘려보냄
 *   - usage/rag 메타는 마지막 `done` 청크 1개에 묶어 전송 (B 옵션)
 *
 * SSE 청크 포맷 (B 옵션):
 *   data: {"type":"token","content":"안"}\n\n
 *   data: {"type":"token","content":"녕"}\n\n
 *   ...
 *   data: {"type":"done","usage":{...},"rag":{...}}\n\n
 *   data: {"type":"error","error":"..."}\n\n   ← 중간에 터지면
 *
 * Multi-turn 정책 (A 옵션): Block 11과 동일.
 *   매 턴마다 마지막 user 메시지로 새 검색 → 컨텍스트 박은 userMessage로 enrich.
 *   과거 messages는 원본 그대로 → history 깨끗.
 *
 * 비용/모니터링:
 *   응답당 input 1.5만~3만 토큰 (페이지 통째라). usage는 done 청크에 박힘.
 *   청킹 도입(1주차) 트리거 측정용.
 */
export async function POST(request: Request) {
  let messages: ChatMessage[];
  try {
    const parsedBody = (await request.json()) as { messages: ChatMessage[] };
    messages = parsedBody.messages;
  } catch {
    return Response.json({ error: "잘못된 JSON 바디" }, { status: 400 });
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json(
      { error: "messages 배열이 비어 있음" },
      { status: 400 }
    );
  }

  const lastMessage = messages[messages.length - 1];
  if (lastMessage.role !== "user") {
    return Response.json(
      { error: "마지막 메시지는 user여야 함" },
      { status: 400 }
    );
  }

  // 검색 + 프롬프트 빌드까지는 스트림 시작 전에 처리 (실패 시 일반 400/500 응답).
  // 스트림 시작 후에는 HTTP 상태 변경 불가 — Next docs 'The HTTP contract' 참고.
  const query = lastMessage.content;
  const hits = await search(query, 3, { weighted: true });
  const { system, userMessage } = buildPrompt(query, hits);

  const enrichedMessages: ChatMessage[] = [
    ...messages.slice(0, -1),
    { role: "user", content: userMessage },
  ];

  // 디버그용 RAG 메타. done 청크에 박을 페이로드.
  const ragMeta = {
    query,
    hitCount: hits.length,
    hits: hits.map((hit) => ({
      path: hit.path,
      source: hit.source,
      score: +hit.score.toFixed(4),
    })),
  };

  const encoder = new TextEncoder();
  const encodeSseChunk = (payload: unknown) =>
    encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

  const responseStream = new ReadableStream({
    async start(controller) {
      const anthropicStream = client.messages.stream({
        model: "claude-sonnet-4-5",
        max_tokens: 1024,
        system,
        messages: enrichedMessages,
      });

      try {
        for await (const event of anthropicStream) {
          // 토큰은 content_block_delta + text_delta 조합으로만 옴.
          // 다른 delta 타입(thinking 등)이나 메타 이벤트는 무시.
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(
              encodeSseChunk({ type: "token", content: event.delta.text })
            );
          }
        }

        // 스트림이 정상 종료되면 finalMessage로 usage 메타 회수.
        // (SDK가 message_delta/message_stop 이벤트의 usage를 내부적으로 누적해 둠.)
        const finalMessage = await anthropicStream.finalMessage();

        controller.enqueue(
          encodeSseChunk({
            type: "done",
            usage: finalMessage.usage,
            rag: ragMeta,
          })
        );
      } catch (error) {
        // 스트림 시작 후 에러는 SSE 청크로만 전달 가능 (HTTP 상태 변경 불가).
        // 클라이언트는 type === "error"를 받으면 UI에 에러 박스로 표시.
        console.error("[/api/chat] stream error:", error);
        controller.enqueue(
          encodeSseChunk({
            type: "error",
            error: error instanceof Error ? error.message : "unknown",
          })
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(responseStream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx 등 reverse proxy의 응답 버퍼링 방지 (Next streaming docs 권장).
      "X-Accel-Buffering": "no",
    },
  });
}
