"use client";

import { useState, Fragment } from "react";

type Role = "user" | "assistant";
type Message = { role: Role; content: string };

/**
 * assistant 답변 안의 [[페이지명]] 인용을 시각적으로 강조해서 렌더링.
 *
 * 동작: 텍스트를 정규식으로 split → 일반 텍스트는 그대로, [[...]] 부분만 span으로 박스 처리.
 * 클릭은 안 받음 — Obsidian wiki 링크는 브라우저에서 열 수 없고, 본인 로컬 vault에서만 의미 있음.
 * 시각 강조만으로 "여기가 출처 인용이다"를 빠르게 인식 가능.
 *
 * user 메시지엔 적용 안 함 — 사용자가 친 [[X]]는 그냥 텍스트로 둠.
 */
function renderMessageWithCitations(content: string) {
  const parts = content.split(/(\[\[[^\]]+\]\])/g);
  return parts.map((part, index) => {
    if (/^\[\[[^\]]+\]\]$/.test(part)) {
      return (
        <span
          key={index}
          className="font-mono text-xs px-1.5 py-0.5 mx-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
        >
          {part}
        </span>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;

    // 1) 새 user 메시지를 포함한 다음 상태를 미리 만든다.
    //    setState는 비동기라서 fetch 바디에 그대로 쓰면 안 됨 (stale).
    const nextMessages: Message[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages(nextMessages);
    setInput("");
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.text ?? "" },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 dark:bg-black">
      <main className="flex w-full max-w-2xl flex-1 flex-col">
        <header className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <h1 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            jarvis
          </h1>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
          {messages.length === 0 && !isLoading && (
            <p className="text-sm text-zinc-400 dark:text-zinc-600">
              아무거나 쳐보기.
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={
                m.role === "user" ? "flex justify-end" : "flex justify-start"
              }
            >
              <div
                className={
                  "max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap " +
                  (m.role === "user"
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-black"
                    : "bg-zinc-200 text-black dark:bg-zinc-800 dark:text-white")
                }
              >
                {m.role === "assistant"
                  ? renderMessageWithCitations(m.content)
                  : m.content}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="rounded-2xl px-4 py-2 text-sm bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                답하는 중…
              </div>
            </div>
          )}
          {error && (
            <div className="flex justify-start">
              <div className="rounded-2xl px-4 py-2 text-sm bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                에러: {error}
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="border-t border-zinc-200 dark:border-zinc-800 p-3 flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading}
            placeholder={isLoading ? "답하는 중…" : "질문을 입력..."}
            className="flex-1 rounded-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2 text-sm outline-none focus:border-zinc-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="rounded-full bg-zinc-900 dark:bg-white text-white dark:text-black px-4 py-2 text-sm disabled:opacity-40"
          >
            전송
          </button>
        </form>
      </main>
    </div>
  );
}
