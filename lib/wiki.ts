import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * source 분류 (스펙 v3.1 §3 Day 1):
 * - curated: 에이전트가 자동 수집한 큐레이션 노트 (raw/curated/ 하위)
 * - manual:  내가 직접 쓴 손글 (나머지 모두)
 *
 * 인덱싱 시점에 박아두면 검색 시점에 source 가중치(manual=1.0, curated=0.6)
 * 적용이 단순 곱셈으로 끝남. Block 6에서 사용.
 */
export type Source = "manual" | "curated";

export type Document = {
  /** wiki 루트 기준 상대 경로 (예: "raw/MVP_스펙_v3.1.md") */
  path: string;
  /** 절대 경로 (디버그용) */
  absPath: string;
  /** 파일 내용 전체 (Day 1은 청킹 X, 통째) */
  content: string;
  source: Source;
};

function getWikiRoot(): string {
  const root = process.env.OBSIDIAN_WIKI_PATH;
  if (!root) {
    throw new Error(
      "환경변수 OBSIDIAN_WIKI_PATH가 비어 있음. .env.local 확인."
    );
  }
  return root;
}

/**
 * RAG 인덱싱에서 제외할 위키 메타 파일 basename.
 *
 * 이유: 이 파일들은 "위키 운영 규칙"이나 "목차/이력" 같은 메타 정보로,
 * 사용자가 던지는 일반 질문(예: "React가 뭐야?")의 답변에 인용되면
 * RAG 의미가 깨진다. Block 10에서 `[[CLAUDE]]`가 top-1로 박힌 게 발견됨.
 *
 * 같은 이름의 일반 콘텐츠 페이지를 만들 일은 없다는 전제 — 위키 컨벤션상
 * 이 basename들은 항상 메타 파일.
 */
const INDEXING_EXCLUDED_BASENAMES = new Set([
  "CLAUDE.md",
  "AGENTS.md",
  "index.md",
  "log.md",
  "ideas.md",
]);

/** RAG 인덱싱 대상 파일인지. 메타 파일은 제외. */
function isIndexable(absolutePath: string): boolean {
  return !INDEXING_EXCLUDED_BASENAMES.has(path.basename(absolutePath));
}

/**
 * dir 아래의 모든 .md 파일 절대경로를 재귀로 수집. (메타 파일 포함, 필터 X)
 * 숨김 폴더(.obsidian, .git 등)는 제외.
 *
 * RAG 인덱싱용 필터는 loadAllDocuments에서 적용 — 의미 분리.
 * 진짜 모든 파일이 필요하면 이 함수, 인덱싱 대상만 필요하면 loadAllDocuments.
 */
export async function listMarkdownFiles(dir?: string): Promise<string[]> {
  const root = dir ?? getWikiRoot();
  const entries = await readdir(root, { withFileTypes: true });

  const results: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // 숨김 무시
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listMarkdownFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

/**
 * 절대경로 → source 분류.
 * 상대경로의 첫 두 세그먼트가 "raw/curated"면 curated, 아니면 manual.
 */
export function classifySource(absPath: string): Source {
  const rel = path.relative(getWikiRoot(), absPath);
  const segments = rel.split(path.sep);
  if (segments[0] === "raw" && segments[1] === "curated") {
    return "curated";
  }
  return "manual";
}

/** 한 파일을 Document로 로드 */
export async function loadDocument(absPath: string): Promise<Document> {
  const content = await readFile(absPath, "utf-8");
  return {
    path: path.relative(getWikiRoot(), absPath),
    absPath,
    content,
    source: classifySource(absPath),
  };
}

/**
 * wiki 전체 → Document[] (RAG 인덱싱 대상만, 메타 파일 제외).
 *
 * 제외 대상은 INDEXING_EXCLUDED_BASENAMES 참고.
 */
export async function loadAllDocuments(): Promise<Document[]> {
  const files = await listMarkdownFiles();
  const indexableFiles = files.filter(isIndexable);
  return Promise.all(indexableFiles.map(loadDocument));
}
