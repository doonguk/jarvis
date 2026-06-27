/**
 * Block 33 — heading-aware 마크다운 청킹 (순수함수, 외부 API 0).
 *
 * 왜: Block 32 측정 결과 input 토큰의 97%가 "통문서 통째 주입"에서 나옴.
 *   문서를 작은 청크로 쪼개 검색 단위를 문서 → 청크로 바꾸면, 질문에 맞는
 *   조각만 주입해 토큰을 1/4 이하로 줄인다. 이 파일은 그 "쪼개기" 1단계.
 *
 * 전략 (granularity 균일화):
 *   1. `#`~`######` 헤딩 경계로 섹션 분리 (위키가 `##` 구조라 자연 경계).
 *   2. 큰 섹션 방어: maxChars 초과 섹션은 문단 단위로 재분할 + 오버랩.
 *   3. 작은 섹션 방어: 연속된 작은 섹션은 targetChars까지 묶음(pack).
 *      마지막에 남은 buffer가 minChars 미만이면 직전 청크에 병합(고아 청크 방지).
 *
 * 크기 단위 = 문자 수(char). 토큰으로 정확히 자르려면 청크마다 countTokens
 *   (네트워크) 호출이 필요해 인덱싱이 느려짐. 한글 위키 기준 토큰 ≈ 문자 × 0.5~0.7.
 *   실제 토큰 분포는 Block 34/36에서 countTokens로 검증한다.
 *
 * 순수함수라 단위 테스트가 쉬움. content(텍스트)만 받고 path/source 같은 문서
 *   메타는 붙이지 않음 — 그건 Block 34에서 인덱스 빌드 시 결합한다.
 */

export type Chunk = {
  /** 청크 본문. 임베딩 + 컨텍스트 주입 대상. 헤딩 라인 포함. */
  content: string;
  /** 이 청크가 속한 헤딩 경로 (예: ["제목", "섹션", "하위섹션"]). 인용/디버그용. */
  headingTrail: string[];
  /** 문서 내 청크 순번 (0부터). */
  chunkIndex: number;
};

export type ChunkOptions = {
  /** 청크 목표 크기(문자). 이 크기에 도달하면 끊는다. */
  targetChars?: number;
  /** 청크 최대 크기(문자). 이 크기를 넘는 섹션은 강제 재분할. */
  maxChars?: number;
  /** 청크 간 겹치는 문자 수. 경계에서 문맥 끊김 방어. */
  overlapChars?: number;
  /** 단독 청크로 두기엔 너무 작은 임계(문자). 미만이면 인접 청크에 병합. */
  minChars?: number;
};

const DEFAULT_OPTIONS: Required<ChunkOptions> = {
  targetChars: 1000,
  maxChars: 1600,
  overlapChars: 150,
  minChars: 200,
};

type Section = {
  headingTrail: string[];
  text: string;
};

// `## 제목` 형태의 ATX 헤딩 한 줄. 그룹1 = 헤딩 레벨(#개수), 그룹2 = 제목 텍스트.
const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;

/**
 * Pass 1 — 헤딩 경계로 섹션 분리하며 헤딩 경로(trail)를 추적한다.
 * 첫 헤딩 이전의 머리말(preamble)은 trail이 빈 섹션으로 나온다.
 */
function splitIntoSections(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  const headingStack: { level: number; text: string }[] = [];

  let currentLines: string[] = [];
  let currentTrail: string[] = [];

  const flushSection = () => {
    const text = currentLines.join("\n").trim();
    if (text.length > 0) {
      sections.push({ headingTrail: [...currentTrail], text });
    }
    currentLines = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(HEADING_PATTERN);
    if (headingMatch) {
      flushSection(); // 새 헤딩 만나면 이전 섹션 마감

      const level = headingMatch[1].length;
      const headingText = headingMatch[2].trim();

      // 같은 레벨 이하의 헤딩은 스택에서 제거 후 현재 헤딩 push → trail 갱신.
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1].level >= level
      ) {
        headingStack.pop();
      }
      headingStack.push({ level, text: headingText });
      currentTrail = headingStack.map((entry) => entry.text);

      currentLines.push(line); // 헤딩 라인도 섹션 본문에 포함
    } else {
      currentLines.push(line);
    }
  }
  flushSection();

  return sections;
}

/** 텍스트 뒤쪽 overlapChars 만큼을 잘라 다음 청크 머리로 쓸 오버랩 조각을 만든다. */
function takeOverlap(text: string, overlapChars: number): string {
  if (overlapChars <= 0 || text.length <= overlapChars) return text;
  const tail = text.slice(-overlapChars);
  // 문장 중간에서 시작하지 않도록 첫 줄바꿈 이후부터 사용 (없으면 그대로).
  const firstNewline = tail.indexOf("\n");
  return firstNewline >= 0 ? tail.slice(firstNewline + 1) : tail;
}

/** 한 문단도 maxChars를 넘으면 고정 폭(문자 윈도우)으로 강제 분할 + 오버랩. */
function hardSplit(text: string, settings: Required<ChunkOptions>): string[] {
  const pieces: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + settings.targetChars, text.length);
    pieces.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - settings.overlapChars; // 뒤로 물려 오버랩
  }
  return pieces;
}

/** maxChars 초과 섹션을 문단(빈 줄 기준) 단위로 묶어 targetChars 안팎으로 재분할. */
function splitLargeSection(
  text: string,
  settings: Required<ChunkOptions>
): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const pieces: string[] = [];
  let buffer = "";

  for (const paragraph of paragraphs) {
    if (paragraph.length > settings.maxChars) {
      if (buffer.trim().length > 0) {
        pieces.push(buffer.trim());
        buffer = "";
      }
      pieces.push(...hardSplit(paragraph, settings));
      continue;
    }

    const wouldExceed = buffer.length + paragraph.length + 2 > settings.targetChars;
    if (wouldExceed && buffer.length > 0) {
      pieces.push(buffer.trim());
      buffer = takeOverlap(buffer, settings.overlapChars); // 오버랩으로 다음 청크 시작
    }
    buffer = buffer.length > 0 ? `${buffer}\n\n${paragraph}` : paragraph;
  }

  if (buffer.trim().length > 0) pieces.push(buffer.trim());
  return pieces;
}

/**
 * 마크다운 텍스트 → 청크 배열.
 *
 * @param content 문서 전체 텍스트
 * @param options 크기 파라미터 (미지정 시 DEFAULT_OPTIONS)
 */
export function chunkMarkdown(
  content: string,
  options: ChunkOptions = {}
): Chunk[] {
  const settings: Required<ChunkOptions> = { ...DEFAULT_OPTIONS, ...options };
  const sections = splitIntoSections(content);

  const chunks: Chunk[] = [];
  let packBuffer = "";
  let packTrail: string[] = [];

  const flushPack = () => {
    if (packBuffer.trim().length > 0) {
      chunks.push({
        content: packBuffer.trim(),
        headingTrail: packTrail,
        chunkIndex: chunks.length,
      });
    }
    packBuffer = "";
    packTrail = [];
  };

  for (const section of sections) {
    // 큰 섹션: 묶음 buffer 비우고 재분할해서 바로 emit.
    if (section.text.length > settings.maxChars) {
      flushPack();
      for (const piece of splitLargeSection(section.text, settings)) {
        chunks.push({
          content: piece.trim(),
          headingTrail: section.headingTrail,
          chunkIndex: chunks.length,
        });
      }
      continue;
    }

    // 작은/중간 섹션: targetChars까지 묶기.
    if (packBuffer.length === 0) {
      packTrail = section.headingTrail;
    }
    packBuffer =
      packBuffer.length > 0 ? `${packBuffer}\n\n${section.text}` : section.text;

    if (packBuffer.length >= settings.targetChars) {
      flushPack();
    }
  }

  // 마지막 남은 묶음: 너무 작으면 직전 청크에 병합(고아 청크 방지), 아니면 emit.
  const remaining = packBuffer.trim();
  if (remaining.length > 0) {
    if (remaining.length < settings.minChars && chunks.length > 0) {
      const lastChunk = chunks[chunks.length - 1];
      lastChunk.content = `${lastChunk.content}\n\n${remaining}`;
    } else {
      chunks.push({
        content: remaining,
        headingTrail: packTrail,
        chunkIndex: chunks.length,
      });
    }
  }

  return chunks;
}
