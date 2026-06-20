import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// 클라이언트가 보낼 메시지 모양 (page.tsx의 Message 타입과 동일)
type ChatMessage = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  try {
    const { messages } = (await req.json()) as { messages: ChatMessage[] };

    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json(
        { error: "messages 배열이 비어 있음" },
        { status: 400 }
      );
    }

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      messages, // [{role, content}] — Anthropic 포맷과 동일하므로 그대로 전달
    });

    // response.content는 ContentBlock[] (text/tool_use 등). text만 합침
    const text = response.content
      .filter(
        (b): b is { type: "text"; text: string } & typeof b => b.type === "text"
      )
      .map((b) => b.text)
      .join("");

    return Response.json({
      text,
      usage: response.usage, // 학습용: 토큰 사용량 확인
    });
  } catch (err) {
    console.error("[/api/chat] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }
}
