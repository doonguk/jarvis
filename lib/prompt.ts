import type { SearchHit } from "./search";

/**
 * 시스템 프롬프트 (Block 10).
 *
 * 핵심 원칙:
 * 1. 주어진 <wiki_excerpts> 발췌만 근거로 답한다.
 * 2. 발췌에 답이 없으면 "위키에 관련 내용이 없습니다"라고 솔직히 말한다.
 *    클로드 학습 지식으로 메우지 않는다 (메우면 인용 출처 없음 = 자비스 의미 X).
 * 3. 인용은 [[페이지명]] 형식으로 본문에 자연스럽게 박는다 (Obsidian wiki 링크 호환).
 * 4. 답변 끝에 "참고:" 줄 후 인용한 페이지 [[...]]를 나열.
 *
 * 톤: 사용자(33살 프론트엔드 개발자)에게 맞춰 간결/직설. 사과/장식 표현 X.
 *
 * 이 프롬프트는 운영 중에 자주 손볼 영역 — 답변 품질 안 나오면 여기 먼저 본다.
 */
export const SYSTEM_PROMPT = `당신은 사용자의 개인 위키(jarvis)를 기반으로 답하는 어시스턴트입니다.

규칙:
1. 답변은 반드시 <wiki_excerpts> 내 발췌만 근거로 합니다.
2. 발췌에 답이 없으면 "위키에 관련 내용이 없습니다"라고 명시합니다.
   일반 지식으로 메우지 마세요.
3. 인용은 [[페이지명]] 형식으로 본문에 자연스럽게 박습니다.
4. 답변 마지막에 "참고:" 줄을 추가하고, 인용한 페이지 [[...]]들을 나열합니다.
5. 톤: 간결, 직설적. 사과나 장식적 표현 사용 X.`;

/**
 * 검색 hit의 path → Obsidian wiki 링크 페이지명.
 *
 * "wiki/React-setState-배치와-마이크로태스크-큐.md" → "React-setState-배치와-마이크로태스크-큐"
 * "raw/MVP_스펙_v3.1.md"                          → "MVP_스펙_v3.1"
 *
 * Obsidian은 페이지명만으로 매칭하므로 디렉토리/확장자 제거.
 * 같은 이름 페이지가 여러 디렉토리에 존재하면 충돌 — 현재 wiki는 flat이라 안 일어남.
 */
export function pathToPageName(path: string): string {
  const lastSegment = path.split("/").pop() ?? path;
  return lastSegment.replace(/\.md$/, "");
}

/**
 * SearchHit[] → 시스템 프롬프트에 박을 <wiki_excerpts> 블록.
 *
 * 각 발췌는 <wiki_doc page="[[...]]" source="..." score="..."> 본문 </wiki_doc>.
 * - page: [[페이지명]] 형식으로 노출 → 모델이 본문에 인용할 때 같은 형식 그대로 따라 씀
 * - source/score: 모델이 신뢰도 가늠 가능 + 디버그 시 출처 추적 쉬움
 * - 본문은 SearchHit.content (전체). Day 1은 페이지 통째, 1주차 청킹 후엔 chunk 본문.
 */
export function formatContext(hits: SearchHit[]): string {
  if (hits.length === 0) {
    return "<wiki_excerpts>\n(검색 결과 없음)\n</wiki_excerpts>";
  }

  const blocks = hits.map((hit) => {
    const pageName = pathToPageName(hit.path);
    return `<wiki_doc page="[[${pageName}]]" source="${hit.source}" score="${hit.score.toFixed(3)}">
${hit.content}
</wiki_doc>`;
  });

  return `<wiki_excerpts>\n${blocks.join("\n\n")}\n</wiki_excerpts>`;
}

export type BuiltPrompt = {
  /** Anthropic SDK `system` 파라미터로 그대로 전달 */
  system: string;
  /** user role message content. 컨텍스트 블록 + 질문 합친 결과 */
  userMessage: string;
};

/**
 * 최종 프롬프트 빌더. Block 11에서 `/api/chat` 라우트가 호출.
 *
 * 형태:
 *   system:      [SYSTEM_PROMPT]
 *   userMessage: [<wiki_excerpts>...</wiki_excerpts>]
 *                [질문: ...]
 *
 * 컨텍스트를 user 메시지에 박는 이유: Anthropic 모델은 system을 "정체성/규칙",
 * user를 "데이터/요청"으로 더 분명히 처리하는 경향. 위키 발췌는 후자에 가까움.
 */
export function buildPrompt(query: string, hits: SearchHit[]): BuiltPrompt {
  const context = formatContext(hits);
  return {
    system: SYSTEM_PROMPT,
    userMessage: `${context}\n\n질문: ${query}`,
  };
}
