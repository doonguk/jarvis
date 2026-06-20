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
 * dir 아래의 모든 .md 파일 절대경로를 재귀로 수집.
 * 숨김 폴더(.obsidian, .git 등)는 제외.
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

/** wiki 전체 → Document[] */
export async function loadAllDocuments(): Promise<Document[]> {
  const files = await listMarkdownFiles();
  return Promise.all(files.map(loadDocument));
}
