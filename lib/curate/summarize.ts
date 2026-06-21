import Anthropic from "@anthropic-ai/sdk";
import type { HackerNewsStory } from "./hn";

/**
 * Block 16 — HN 스토리 묶음을 LLM에 한 번 호출해서
 * 한국어 요약 + 영문 키워드 + 자비스 인덱스 적격성(boolean) 받기.
 *
 * 설계 결정:
 * - 묶음 1회 호출 (스토리당 1회 X). 입출력 묶음 토큰 효율 ↑, LLM 라운드트립 1회.
 *   단점: 호출 1회 실패 = 전체 실패. Day 3는 단순화, 운영 견고성은 1주차.
 * - tool_use 패턴으로 structured output 보장. 프롬프트 JSON 강제는 파싱 실패 위험 ↑.
 * - 분류 카테고리(AI 도구/모델/기타) 빼고 isAiRelevant boolean만.
 *   사유: 분류는 RAG 검색에 안 쓰이고 휴먼 메타 가치도 작음 (Block 16 진입 전 합의).
 *
 * 언어 정책 (Day 3 합의):
 * - 요약: 한국어. 영문 고유명사(Cursor, MCP, GPT 등)는 영문 그대로.
 * - 키워드: 영문 (Voyage multilingual이지만 영문 임베딩 매칭이 정확도 더 안정).
 */

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SUMMARIZE_MODEL = "claude-sonnet-4-5";

/** 묶음 1회 호출의 출력 토큰 상한. 30개 × ~200자 한글 ≈ 5~6K 토큰 추정 → 6000으로 박음. */
const MAXIMUM_OUTPUT_TOKENS = 6000;

export type SummarizedStory = {
  id: string;
  title: string;
  url: string;
  /** 한국어 2~3줄 요약 (300자 이내) */
  summary: string;
  /** 영문 키워드 5~8개. 임베딩 매칭용. */
  keywords: string[];
  /**
   * 자비스 wiki에 인덱스할 가치가 있는가.
   * - true: AI 도구/모델/연구/논문/벤치마크 등 실무자에게 유용한 기술 기사
   * - false: AI 정책·사회·의견·비판, AI 직접 안 다루는 글 → Block 17에서 거름
   */
  isAiRelevant: boolean;
};

const SYSTEM_PROMPT = `너는 Hacker News 영문 기사 묶음을 받아 자비스 인덱스용 메타를 만드는 도구다.

응답 정책:
- 모든 summary는 한국어 (2~3줄, 300자 이내).
- 영문 고유명사 (Cursor, Claude Code, MCP, OpenAI, GPT 등)는 영문 그대로 사용.
- keywords는 5~8개의 영문 명사·구. 한국어 금지. (영문 임베딩 매칭 정확도 ↑)

isAiRelevant 판정 기준:
- true: AI 도구·모델·SDK·라이브러리·논문·벤치마크·실무 사례 등 개발자에게 유용한 기술 기사.
- false: AI 정책·규제·사회 영향·비판 칼럼·일반론, AI를 직접 다루지 않는 글.

submit_summaries 도구를 정확히 한 번 호출해 모든 결과를 한꺼번에 제출하라.`;

/** Anthropic SDK tool 응답의 input 모양. tool_use 블록의 input 필드 cast 용도. */
type ToolInputShape = {
  results: Array<{
    id: string;
    summary: string;
    keywords: string[];
    isAiRelevant: boolean;
  }>;
};

export async function summarizeStories(
  stories: HackerNewsStory[]
): Promise<SummarizedStory[]> {
  if (stories.length === 0) return [];

  /**
   * 유저 메시지: id/title/url 묶음. body 본문은 안 보냄 (Day 3 단순화).
   * LLM이 title + url에서 유추해 한국어 요약 작성.
   */
  const userMessage = stories
    .map(
      (story) =>
        `ID: ${story.id}\nTitle: ${story.title}\nURL: ${story.url}`
    )
    .join("\n\n");

  const response = await client.messages.create({
    model: SUMMARIZE_MODEL,
    max_tokens: MAXIMUM_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    tools: [
      {
        name: "submit_summaries",
        description:
          "각 스토리에 대해 한국어 요약, 영문 키워드, 자비스 인덱스 적격성을 한 번에 제출.",
        input_schema: {
          type: "object",
          properties: {
            results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: {
                    type: "string",
                    description: "스토리 ID. 유저 메시지의 ID를 그대로 사용.",
                  },
                  summary: {
                    type: "string",
                    description: "한국어 요약 2~3줄, 300자 이내.",
                  },
                  keywords: {
                    type: "array",
                    items: { type: "string" },
                    description: "영문 키워드 5~8개.",
                  },
                  isAiRelevant: {
                    type: "boolean",
                    description:
                      "AI 도구/모델/연구를 다루는 기술 기사면 true.",
                  },
                },
                required: ["id", "summary", "keywords", "isAiRelevant"],
              },
            },
          },
          required: ["results"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "submit_summaries" },
  });

  // tool_use 블록 찾기. tool_choice로 강제했으니 정상 응답에는 무조건 존재.
  const toolUseBlock = response.content.find(
    (block) => block.type === "tool_use"
  );
  if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
    throw new Error("LLM 응답에 submit_summaries tool_use 블록이 없음");
  }

  const toolInput = toolUseBlock.input as ToolInputShape;

  /**
   * LLM 결과를 원본 스토리와 결합 (id 매칭).
   * LLM이 잘못된 ID를 만들거나 일부 누락하는 케이스 방어:
   * - 잘못된 ID: skip
   * - 누락: 결과 배열 길이가 입력보다 작음 (호출자에서 length 비교로 감지 가능)
   */
  const storyById = new Map(stories.map((story) => [story.id, story]));
  const summarizedStories: SummarizedStory[] = [];
  for (const result of toolInput.results) {
    const originalStory = storyById.get(result.id);
    if (!originalStory) continue;
    summarizedStories.push({
      id: originalStory.id,
      title: originalStory.title,
      url: originalStory.url,
      summary: result.summary,
      keywords: result.keywords,
      isAiRelevant: result.isAiRelevant,
    });
  }

  return summarizedStories;
}
