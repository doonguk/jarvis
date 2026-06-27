import { Document, loadAllDocuments, type Source } from "./wiki";
import { embedBatch } from "./embed";
import { chunkMarkdown, type Chunk } from "./chunk";

/**
 * 인덱스의 한 항목 = 문서가 아니라 "청크"(Block 34).
 *
 * 문서 메타(path/absPath/source) + 청크 메타(headingTrail/chunkIndex) + 벡터.
 * 한 문서가 여러 IndexedChunk로 펼쳐짐 → 검색 단위가 문서에서 청크로 바뀐다.
 * (Block 32 측정: input 토큰 97%가 통문서 주입 → 청크 단위로 쪼개 토큰 절감.)
 */
export type IndexedChunk = {
  /** 출처 문서의 wiki 루트 기준 상대 경로 (인용 [[페이지명]] 생성용) */
  path: string;
  /** 출처 문서 절대 경로 (디버그용) */
  absPath: string;
  source: Source;
  /** 청크 본문. 임베딩 + 컨텍스트 주입 대상. */
  content: string;
  /** 청크가 속한 헤딩 경로 (인용/디버그용) */
  headingTrail: string[];
  /** 출처 문서 내 청크 순번 */
  chunkIndex: number;
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
  var __INDEX: IndexedChunk[] | undefined;
  // eslint-disable-next-line no-var
  var __INDEX_BUILDING: Promise<IndexedChunk[]> | undefined;
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
export async function getIndex(): Promise<IndexedChunk[]> {
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

async function buildIndex(): Promise<IndexedChunk[]> {
  const documents = await loadAllDocuments();

  // 각 문서를 청크로 쪼개고 (문서, 청크) 쌍으로 평탄화 → 임베딩 순서 보존.
  const pendingChunks: { document: Document; chunk: Chunk }[] = [];
  for (const document of documents) {
    for (const chunk of chunkMarkdown(document.content)) {
      pendingChunks.push({ document, chunk });
    }
  }

  // 청크 본문을 한 번에 임베딩. embedBatch는 128개 초과 시 에러를 던짐.
  // 위키가 커져 청크 수가 128을 넘으면 분할 호출 도입 필요(후속).
  const { vectors } = await embedBatch(
    pendingChunks.map((item) => item.chunk.content),
    "document"
  );

  return pendingChunks.map((item, index) => ({
    path: item.document.path,
    absPath: item.document.absPath,
    source: item.document.source,
    content: item.chunk.content,
    headingTrail: item.chunk.headingTrail,
    chunkIndex: item.chunk.chunkIndex,
    vector: vectors[index],
  }));
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
