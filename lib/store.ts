import { Document, loadAllDocuments } from "./wiki";
import { embedBatch } from "./embed";

export type IndexedDocument = Document & {
  vector: number[];
};

/**
 * Next.js dev 모드에서 HMR(Hot Module Reload)로 모듈이 다시 평가돼도
 * globalThis는 살아있음. 거기에 인덱스를 박으면 빌드는 진짜 첫 호출 1번만.
 *
 * 운영(prod)에선 서버 부팅 후 첫 요청에 1번 빌드 → 이후 즉시.
 * 영구 저장(Supabase pgvector)은 한 달 사이드 1주차에 도입.
 */
declare global {
  // eslint-disable-next-line no-var
  var __INDEX: IndexedDocument[] | undefined;
  // eslint-disable-next-line no-var
  var __INDEX_BUILDING: Promise<IndexedDocument[]> | undefined;
}

/**
 * 인덱스가 없으면 빌드, 있으면 그대로 반환.
 *
 * 동시 첫 호출 방어:
 * - 사용자가 새 탭 2개에서 동시에 첫 요청을 날리면
 *   buildIndex가 2번 돌면서 Voyage도 2번 호출됨 (낭비).
 * - __INDEX_BUILDING에 진행 중 Promise를 박아두면
 *   두 번째 요청은 같은 Promise를 await만 함.
 */
export async function getIndex(): Promise<IndexedDocument[]> {
  if (globalThis.__INDEX) return globalThis.__INDEX;
  if (globalThis.__INDEX_BUILDING) return globalThis.__INDEX_BUILDING;

  globalThis.__INDEX_BUILDING = buildIndex();
  try {
    globalThis.__INDEX = await globalThis.__INDEX_BUILDING;
    return globalThis.__INDEX;
  } finally {
    globalThis.__INDEX_BUILDING = undefined;
  }
}

async function buildIndex(): Promise<IndexedDocument[]> {
  const docs = await loadAllDocuments();
  const { vectors } = await embedBatch(
    docs.map((d) => d.content),
    "document"
  );
  return docs.map((d, i) => ({ ...d, vector: vectors[i] }));
}
