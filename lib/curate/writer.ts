import { writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import type { SummarizedStory } from "./summarize";

/**
 * Block 17 — SummarizedStory[]를 wiki/raw/curated/YYYY-MM-DD.md 한 파일로 씀.
 *
 * 정책:
 * - isAiRelevant=false인 스토리는 거름 (자비스 인덱스에 노이즈 안 들어감).
 * - 같은 날 재호출 시 overwrite. 호출자가 previouslyExisted 플래그로 의식 가능.
 *   append 안 함 — HN 인기글이 며칠 동안 같은 시간대에 보여서 중복 누적 위험.
 *
 * 포맷:
 * - wiki/CLAUDE.md의 takeaway callout 규정은 wiki/wiki/ 페이지 한정.
 *   raw/curated/는 raw 자료라 형식 자유. 임베딩 매칭 잘 되게:
 *   - 영문 제목을 ## 헤더 (영문 키워드 매칭)
 *   - 한글 요약 줄 (한국어 쿼리 매칭)
 *   - 영문 키워드 줄 (검색 보강)
 */

function getWikiRoot(): string {
  const root = process.env.OBSIDIAN_WIKI_PATH;
  if (!root) {
    throw new Error(
      "환경변수 OBSIDIAN_WIKI_PATH가 비어 있음. .env.local 확인."
    );
  }
  return root;
}

/** Date → "YYYY-MM-DD" (로컬 타임존). */
function formatDateYyyyMmDd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export type WriteCuratedResult = {
  /** 저장된 파일 절대경로 */
  absolutePath: string;
  /** wiki 루트 기준 상대경로 (예: "raw/curated/2026-06-21.md") */
  relativePath: string;
  /** 저장한 스토리 개수 (isAiRelevant=true만) */
  writtenCount: number;
  /** 거른 스토리 개수 (isAiRelevant=false) */
  skippedCount: number;
  /** 같은 날 파일이 이미 있었는가 (overwrite 발생 신호) */
  previouslyExisted: boolean;
};

export type WriteOptions = {
  /** 파일 날짜. 기본 = 현재 시각. 테스트/재실행 시 명시 가능. */
  date?: Date;
};

export async function writeCuratedFile(
  stories: SummarizedStory[],
  options: WriteOptions = {}
): Promise<WriteCuratedResult> {
  const date = options.date ?? new Date();
  const dateString = formatDateYyyyMmDd(date);

  const wikiRoot = getWikiRoot();
  const curatedDirectory = path.join(wikiRoot, "raw", "curated");
  await mkdir(curatedDirectory, { recursive: true });

  const absolutePath = path.join(curatedDirectory, `${dateString}.md`);
  const relativePath = path.relative(wikiRoot, absolutePath);

  /** 동일 경로 파일 존재 여부 — overwrite 신호. */
  const previouslyExisted = await access(absolutePath)
    .then(() => true)
    .catch(() => false);

  const relevantStories = stories.filter((story) => story.isAiRelevant);
  const skippedCount = stories.length - relevantStories.length;

  const fileContent = buildCuratedMarkdown(relevantStories, dateString);
  await writeFile(absolutePath, fileContent, "utf-8");

  return {
    absolutePath,
    relativePath,
    writtenCount: relevantStories.length,
    skippedCount,
    previouslyExisted,
  };
}

function buildCuratedMarkdown(
  stories: SummarizedStory[],
  dateString: string
): string {
  const lines: string[] = [];
  lines.push(`# 큐레이션 ${dateString}`);
  lines.push("");
  lines.push(
    `HN Algolia에서 자동 수집. 자비스 인덱스 적격(개발자 실무 가치 있는 AI 기술 기사) ${stories.length}개.`
  );
  lines.push("");

  if (stories.length === 0) {
    lines.push("_오늘은 적격 글 없음._");
    lines.push("");
  }

  for (const story of stories) {
    lines.push(`## ${story.title}`);
    lines.push("");
    lines.push(`- URL: ${story.url}`);
    lines.push(`- 한글 요약: ${story.summary}`);
    lines.push(`- 영문 키워드: ${story.keywords.join(", ")}`);
    lines.push("");
  }

  lines.push("---");
  lines.push(`*출처: HN Algolia API · 정리일: ${dateString}*`);
  lines.push("");

  return lines.join("\n");
}
