<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:코딩-스타일 -->
# 코딩 스타일

## 변수명: 약어 금지
도메인 의미가 있는 단어는 **약어로 줄이지 않는다.** 풀어쓴다.

- ❌ `queryVec`, `ctx`, `msg`, `doc`, `req`, `res`, `err`, `cfg`
- ✅ `queryVector`, `context`, `message`, `document`, `request`, `response`, `error`, `config`

**예외 (그대로 둘 것):**
- 외부 API/URL 파라미터 이름: `q`, `k`, `id`, `url` 등
- 수학/알고리즘 인덱스: `i`, `j`, `n`, top-K의 `k`

**일관성 룰:** 새 변수 짓기 전에 같은 파일/모듈의 기존 변수명을 먼저 본다. 혼재 금지.

## 1블록 = 1커밋
스펙 §3 빌드 항목의 한 블록 단위로 commit 1개. 여러 블록 묶지 말 것.
커밋 메시지: `feat(영역): 한 줄 요약 (Block N)` 형식.
<!-- END:코딩-스타일 -->
