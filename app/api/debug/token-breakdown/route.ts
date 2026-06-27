import Anthropic from "@anthropic-ai/sdk";
import { search } from "@/lib/search";
import { formatContext, SYSTEM_PROMPT } from "@/lib/prompt";

/**
 * Block 32 — input 토큰 귀속(attribution) 측정 도구.
 *
 * 목적: 청킹 도입 전에 "input 토큰이 어디서 뚱뚱한가"를 숫자로 확인한다.
 *   route.ts 주석의 "응답당 input 1.5만~3만 토큰 (페이지 통째라)" 전제를
 *   검증하지 않고 청킹부터 박으면, 정작 토큰을 먹는 곳이 다른 데일 수 있다.
 *   → 측정 먼저. context(위키 발췌) 비중이 충분히 커야 청킹 효과가 나온다.
 *
 * 무엇을 재나 (single-turn 기준, 멀티턴이면 history 버킷이 추가됨):
 *   total   = system + (context + 질문)   ← 실제 청구되는 전체 input
 *   context = 위키 발췌(<wiki_excerpts>)가 먹는 양
 *   system  = 시스템 프롬프트가 먹는 양
 *   query   = 질문 + 메시지 프레이밍이 먹는 양
 *   (구성상 system + query + context = total 로 정확히 합산됨)
 *
 * 어떻게 재나 — countTokens 차분법:
 *   countTokens()는 호출 전에 토큰 수만 세주는 가벼운 엔드포인트.
 *   "전체"와 "한 조각 뺀 것"의 차이로 그 조각의 비용을 격리한다.
 *     contextTokens = total - (context 뺀 메시지)
 *     systemTokens  = (system + 더미) - (더미만)   ← 쿼리와 무관, 1회만 계산
 *
 * GET /api/debug/token-breakdown
 *   ?queries=쿼리1,쿼리2,...   (지정 시 override, 기본은 DEFAULT_QUERIES)
 *   &k=3
 *
 * baseline-eval과 같은 6쿼리 재사용 → 전후 비교 가능. 청킹 후 같은 도구로 재측정한다.
 * 측정 끝나면 폐기 가능한 일회용 도구 (Block 20 baseline-eval과 동일 성격).
 */

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// 토큰 카운트는 모델/토크나이저에 종속 → 실제 챗 라우트(route.ts)와 동일 모델로 측정.
const MODEL = "claude-sonnet-4-5";

const DEFAULT_QUERIES = [
  "Voyage 임베딩", //         Day 1 baseline #1
  "Electron 단축키", //       Day 1 baseline #2
  "AI 잘 쓰는 개발자", //     Day 1 baseline #3 (KPI)
  "MCP", //                   Day 1 baseline #4
  "내일 뭐 할 거지", //       Day 1 baseline #5
  "Linear A 해독 AI", //      Day 3 curated 매칭 검증
];

type TokenBreakdown = {
  query: string;
  hitCount: number;
  totalInput: number;
  systemTokens: number;
  contextTokens: number;
  queryTokens: number;
  /** context가 전체 input에서 차지하는 비율(%) — 청킹 효과의 상한 가늠치 */
  contextPercent: number;
};

/** countTokens 한 번 호출 → input_tokens 정수 반환 */
async function countInputTokens(
  systemPrompt: string,
  userContent: string
): Promise<number> {
  const result = await client.messages.countTokens({
    model: MODEL,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });
  return result.input_tokens;
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const queriesParam = requestUrl.searchParams.get("queries");
    const queries = queriesParam
      ? queriesParam.split(",").map((query) => query.trim()).filter(Boolean)
      : DEFAULT_QUERIES;
    const k = Math.max(
      1,
      Math.min(10, Number(requestUrl.searchParams.get("k") ?? 3))
    );

    const startedAt = Date.now();

    // system 토큰은 쿼리와 무관 → 루프 밖에서 1회만 계산 (countTokens 호출 절약).
    // 더미 메시지를 넣고(메시지는 필수) system 있음/없음 차이로 system 순비용 격리.
    const DUMMY_USER_CONTENT = ".";
    const systemPlusDummy = await countInputTokens(
      SYSTEM_PROMPT,
      DUMMY_USER_CONTENT
    );
    const dummyOnly = await countInputTokens("", DUMMY_USER_CONTENT);
    const systemTokens = systemPlusDummy - dummyOnly;

    const breakdowns: TokenBreakdown[] = [];

    for (const query of queries) {
      const hits = await search(query, k, { weighted: true });

      // route.ts와 동일하게 재구성: userMessage = context + "\n\n질문: " + query
      const context = formatContext(hits);
      const userMessageFull = `${context}\n\n질문: ${query}`;
      const userMessageNoContext = `질문: ${query}`;

      // total: system + (context + 질문) = 실제 청구 input (single-turn)
      const totalInput = await countInputTokens(SYSTEM_PROMPT, userMessageFull);
      // noContext: system + (질문만)
      const noContext = await countInputTokens(
        SYSTEM_PROMPT,
        userMessageNoContext
      );

      const contextTokens = totalInput - noContext;
      // 합산 보존: system + query + context = total 이 되도록 query를 나머지로 정의.
      const queryTokens = noContext - systemTokens;

      breakdowns.push({
        query,
        hitCount: hits.length,
        totalInput,
        systemTokens,
        contextTokens,
        queryTokens,
        contextPercent: +((contextTokens / totalInput) * 100).toFixed(1),
      });
    }

    const elapsedMs = Date.now() - startedAt;

    const count = breakdowns.length;
    const average = (pick: (item: TokenBreakdown) => number) =>
      +(breakdowns.reduce((sum, item) => sum + pick(item), 0) / count).toFixed(1);

    const summary = {
      averageTotalInput: average((item) => item.totalInput),
      averageContextTokens: average((item) => item.contextTokens),
      averageSystemTokens: systemTokens,
      averageQueryTokens: average((item) => item.queryTokens),
      averageContextPercent: average((item) => item.contextPercent),
      // 전제 판단 힌트: context 비중이 클수록 청킹 효과가 큼.
      verdict:
        average((item) => item.contextPercent) >= 60
          ? "context 비중 높음 → 청킹 GO (전제 성립)"
          : "context 비중 낮음 → 청킹 효과 제한적, 우선순위 재고",
    };

    return Response.json({
      model: MODEL,
      note: "single-turn 측정. 멀티턴이면 history 버킷이 별도로 추가됨.",
      queries,
      k,
      elapsedMs,
      summary,
      breakdowns,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "unknown" },
      { status: 500 }
    );
  }
}
