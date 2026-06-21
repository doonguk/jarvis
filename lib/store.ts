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

/**
 * Block 19 — 인덱스 무효화.
 *
 * 캐시된 인덱스를 비워서 다음 getIndex() 호출이 cold-start로 전체 재빌드 트리거.
 *
 * 정책 결정 (Day 3, 증분 임베딩 대신 전체 재빌드 선택):
 * - 증분은 prod 재시작/HMR 시 휘발 → 어차피 cold-start 로직 필요 → 두 경로 유지 부담
 * - 증분은 부분 상태 노출 위험 (큐레이션 중 chat 끼어들면 미완성 인덱스 봄)
 * - wiki 작아서 (~11 파일) 전체 재빌드 비용 ~$0.0001 + 3~5초. 절약 이득 없음
 *
 * 호출 시점: 큐레이션 write 끝난 직후 (디스크 ↔ 인덱스 동기화 시점).
 * 호출 후 즉시 재빌드 X — lazy. 다음 chat 첫 호출이 cold-start (3~5초).
 *
 * 동시성: 호출 순간 진행 중인 검색은 이미 받은 index 그대로 씀.
 * 새 검색만 새 index 봄. 안전.
 */
export function invalidateIndex(): void {
  globalThis.__INDEX = undefined;
}
