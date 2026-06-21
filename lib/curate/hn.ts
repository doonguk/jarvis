/**
 * Hacker News Algolia API 클라이언트.
 *
 * 자비스 큐레이션 Day 3 — Block 15.
 *
 * 왜 Algolia인가 (Firebase top-stories와 비교):
 * - Firebase: ID 리스트 받고 N+1번 fetch. 전체 top N개 다 가져와서 LLM에 던지면
 *   AI 콘텐츠 비율(~15%) 낮아 LLM 호출 낭비.
 * - Algolia: query=AI 한 번 호출로 풀텍스트 매칭 결과만. 1차 필터를 API에 위임.
 *
 * 무료, 인증 불필요. 분당 ~10k req. 일 1회 큐레이션엔 무한.
 * 문서: https://hn.algolia.com/api
 */

/** Algolia search 응답의 1개 hit (필요한 필드만 좁힘) */
type AlgoliaHit = {
  objectID: string;
  title: string | null;
  url: string | null;
  points: number | null;
  num_comments: number | null;
  author: string | null;
  created_at: string;
  created_at_i: number;
};

type AlgoliaSearchResponse = {
  hits: AlgoliaHit[];
  nbHits: number;
};

/**
 * 파싱이 끝난 HN 스토리. Block 16(LLM 요약/분류) 입력 형태.
 *
 * 변수명 약어 금지 룰: numComments 그대로 (API 응답이 num_comments라 매핑).
 */
export type HackerNewsStory = {
  id: string;
  title: string;
  url: string;
  points: number;
  numComments: number;
  author: string;
  /** ISO 문자열 (UTC) */
  createdAt: string;
};

export type FetchOptions = {
  /** Algolia 풀텍스트 쿼리. 기본 "AI" */
  query?: string;
  /** points 최소값. 기본 50 (저품질 컷) */
  minimumPoints?: number;
  /**
   * 응답 최대 hits. 기본 30.
   *
   * 운영 컨텍스트(Block 18 cron 큐레이션) 기준. 디버그 라우트
   * (`/api/debug/curate-summarize`)는 LLM 비용 절약 위해 명시적으로 10 박음.
   * 디폴트가 layer별로 다른 이유: 각 layer의 주된 호출자 의도를 반영.
   */
  maximumHits?: number;
  /** 최근 N일만. 기본 7. 매일 큐레이션 → 1주 윈도우 안에서 신선한 거 우선 */
  withinDays?: number;
};

const ALGOLIA_SEARCH_ENDPOINT = "https://hn.algolia.com/api/v1/search";

/**
 * Algolia HN API에서 스토리 fetch + 파싱.
 *
 * 필터링 정책:
 * - url 없는 hit 제외 (Ask HN 등 본문형). Day 3는 외부 링크형만 다룸.
 * - title 빈 hit 제외 (예외적이지만 방어).
 *
 * 비용/시간:
 * - 호출 1회, 200~500ms.
 * - LLM 분류는 Block 16에서. 여기선 그냥 raw 스토리 반환.
 */
export async function fetchHackerNewsStories(
  options: FetchOptions = {}
): Promise<HackerNewsStory[]> {
  const query = options.query ?? "AI";
  const minimumPoints = options.minimumPoints ?? 50;
  const maximumHits = options.maximumHits ?? 30;
  const withinDays = options.withinDays ?? 7;

  const sinceTimestamp =
    Math.floor(Date.now() / 1000) - withinDays * 24 * 60 * 60;

  /**
   * Algolia numericFilters는 같은 키를 여러 번 보내는 방식이 명세상 가장 안전.
   *
   * 주의: HN 공개 인덱스는 `points`를 numericAttributesForFiltering에 박아두지 않아서
   * `points>N` 형태로 보내면 400 떨어짐. `created_at_i`, `num_comments`만 됨.
   * points 컷은 API 응답 받은 뒤 코드에서 적용 (아래 루프 참고).
   */
  const searchParams = new URLSearchParams({
    query,
    tags: "story",
    hitsPerPage: String(maximumHits),
  });
  searchParams.append("numericFilters", `created_at_i>${sinceTimestamp}`);

  const requestUrl = `${ALGOLIA_SEARCH_ENDPOINT}?${searchParams.toString()}`;

  const response = await fetch(requestUrl);
  if (!response.ok) {
    /**
     * Algolia 4xx는 본문에 구체적 사유가 들어옴 (예: "invalid numericFilters").
     * 본문 같이 throw하면 다음번 400 디버깅에서 1회 왕복 절약.
     */
    const errorBody = await response.text().catch(() => "<본문 읽기 실패>");
    throw new Error(
      `HN Algolia 요청 실패: ${response.status} ${response.statusText} | url: ${requestUrl} | body: ${errorBody}`
    );
  }

  const responseData = (await response.json()) as AlgoliaSearchResponse;

  const parsedStories: HackerNewsStory[] = [];
  for (const hit of responseData.hits) {
    if (!hit.url) continue;
    if (!hit.title) continue;
    /**
     * points 컷은 API 단에서 못 걸어서 (위 numericFilters 주석 참고)
     * 클라이언트단에서 처리. points 없으면 0으로 보고 컷에서 제외.
     */
    const storyPoints = hit.points ?? 0;
    if (storyPoints < minimumPoints) continue;
    parsedStories.push({
      id: hit.objectID,
      title: hit.title,
      url: hit.url,
      points: storyPoints,
      numComments: hit.num_comments ?? 0,
      author: hit.author ?? "unknown",
      createdAt: hit.created_at,
    });
  }

  return parsedStories;
}
