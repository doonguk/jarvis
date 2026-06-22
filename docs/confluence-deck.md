# 자비스 — 위키 RAG 개인 비서 + Bedrock 사내 적용 인사이트

> 발표 자료. 자비스 자랑이 아니라 **RAG 메커니즘 + 사내 Bedrock 적용 시 고려사항** 공유.
> 발표 시간: 10~15분 + Q&A
> 발표일: 2026-06-22

---

## 0. 자비스 한 줄 + 시연 (30초)

**Obsidian 위키를 long-term memory 로 쓰는 개인 AI 비서.**
위키 RAG 텍스트 채팅 + 음성 인터페이스 + 데스크톱 앱(Electron). ⌘⇧Space 로 어디서든 호출.

### 시연 절차

> 시연 전 셋업 (한 번): `pnpm dev` + `pnpm electron` 띄움 → 자비스 콘솔 표시 → 마이크 권한 모달 한 번 트리거 (음성 모드 1회 진입).

**시연 1 — 텍스트 채팅 (15s)**
- 질문: `RAG 파이프라인 어떻게 박았어?` (위키에 박힌 답 있는 안전 쿼리)
- 답변 스트리밍 + 인용 칩 표시
- (옵션) 인용 칩 클릭 → Obsidian 으로 해당 페이지 열림

**시연 2 — 음성 입력 (15s)**
- 마이크 버튼 클릭 → "Voyage 임베딩 어떤 모델 박았어?" 말함 → 다시 클릭
- STT → LLM → **음성 응답** (어감 어색한 거 인지, 다음 스펙 영역)

---

## 1. 박힌 기능

- **위키 RAG**: Obsidian 위키 → Voyage 임베딩 → 코사인 검색 → Anthropic Claude 답변 + 인용
- **인용 칩 → Obsidian**: 답변 안 인용 클릭 → Obsidian URI 로 페이지 열림 (근거 추적)
- **음성 입력**: OpenAI Whisper STT, push-to-talk
- **음성 응답**: Web Speech API TTS (1주차 OpenAI TTS 교체)
- **글로벌 단축키**: ⌘⇧Space 창 토글, 메뉴바 tray 상주
- **HUD UI**: Claude Design 시안 기반, 4 상태(idle/listening/thinking/speaking) 시각화

---

## 2. 기술 스택 + 선택 이유

| 영역 | 선택 | 이유 |
| --- | --- | --- |
| LLM | Anthropic Claude Sonnet 4.5 | 인용 강제 프롬프트 follow 잘함 + 긴 컨텍스트(200K) |
| Embedding | Voyage `voyage-3` | multilingual (한국어 ↔ 영어 매칭) + 200M tokens 무료 |
| STT | OpenAI Whisper `whisper-1` | 한국어 정확도 OK + $0.006/min |
| TTS | Web Speech API | 무료 (1주차 OpenAI TTS 로 교체 예정) |
| Frontend | Next.js 16 + Tailwind v4 + React 19 | App Router + 임의값 인라인 |
| Desktop | Electron | 글로벌 단축키 + 메뉴바 상주 |

---

## 3. RAG 메커니즘 — 어떻게 박혔는가

### 흐름 (5단계)

```
┌─ 인덱싱 (cold start 1회) ────────────────────────┐
│  wiki/raw/wiki 파일 리스트 → Voyage embedding    │
│  → in-memory vector store (HMR-safe 싱글톤)      │
└──────────────────────────────────────────────────┘

┌─ 질의 (매 턴) ───────────────────────────────────┐
│  ① 사용자 질문 → Voyage 임베딩                    │
│  ② 코사인 유사도 검색 top-K=3                     │
│  ③ 시스템 프롬프트 + 컨텍스트 빌더 (인용 강제)    │
│  ④ Anthropic 스트리밍 (SSE → 클라이언트 누적)    │
│  ⑤ done 청크에 RAG 메타 (hits/score) → 인용 칩  │
└──────────────────────────────────────────────────┘
```

### 핵심 결정

- **청킹 없음 (Day 1~3)**: 위키 페이지 통째로 인덱싱. 응답당 input 1.5만~3만 토큰. 청킹 도입 시 1/3~1/4. 1주차 영역.
- **multi-turn = A 옵션 (Day 2 박힘)**: 매 턴 독립 검색, history 깨끗. 대화 누적 ↓ 단점 인지.
- **시스템 프롬프트가 인용 강제**: 답변에 `[[페이지명]]` 박도록 명시. follow rate 측정 후 페이지 강조 UI 박음.
- **HMR-safe 싱글톤**: Next dev 리로드 시 인덱스 재빌드 회피. `globalThis.__jarvisIndex__`.

---

## 4. 박힌 함정 / 측정 데이터

박는 과정에서 측정 결과로 결정 뒤집힌 거.

### 4.1 source 가중치 0.6 폐기

**가설**: `wiki/` 정제 노트 > `raw/curated/` 외부 자료 > `raw/` 원자료. 가중치 0.6 곱해서 raw 결과 핸디캡.

**측정 (6쿼리 baseline)**:
- 가중치 X: 정답률 4/6
- 가중치 0.6 적용: **3/6** (curated 가 0.6 핸디캡으로 밀림)

**결정**: 가중치 폐기, `SOURCE_WEIGHT = 1.0/1.0`.

**교훈**: 직관적 가설도 측정 안 하면 안 됨. RAG 튜닝은 measurement-driven.

### 4.2 메타 파일 인덱싱 제외

**문제**: `CLAUDE.md`, `AGENTS.md`, `index.md`, `log.md`, `ideas.md` 가 검색 결과 노이즈로 박힘.

**Day 2 fix**: `INDEXING_EXCLUDED_BASENAMES` 박아서 제외.

**측정 (5쿼리)**:
- 메타 제외 전: 정답률 2/5, top-1 score 평균 0.32
- 메타 제외 후: **3/5, 0.348**

### 4.3 응답당 input 토큰 1.5만~3만

청킹 안 박은 함정. 응답당 비용 $0.04~0.06. spending limit $10 이면 dogfood 일 10응답 한 달 내 닳음. **청킹 도입 = 1주차 필수**.

### 4.4 HN AI 쿼리 rejection 80%

Day 3 박은 HN 큐레이션. AI 쿼리 5개 중 1개만 통과. 정책·사회 의견글이 매칭. **해결**: query 좁히기 (`"AI agent"`, `"LLM"`, `"MCP"`), multi-query OR + dedup. 1주차.

---

## 5. 사내 Bedrock 으로 RAG 박을 때 고려사항

자비스에서 박은 거 vs Bedrock 박을 때 비교. **핵심 인사이트는 음영**.

| 영역 | 자비스 (개인) | Bedrock (사내) | 짚을 거 |
| --- | --- | --- | --- |
| **벡터 검색** | in-memory 코사인 유사도, top-K=3 | Bedrock Knowledge Base 내장 (OpenSearch Serverless / Pinecone) | **Knowledge Base 는 청킹/재정렬 자동.** 직접 박을 거 없음. 대신 retrieval 동작 블랙박스. 인덱싱 정책 디테일은 매뉴얼 박아야. |
| **임베딩 모델** | Voyage `voyage-3` (multilingual) | Cohere Embed Multilingual / Titan Embeddings v2 | **다국어 품질 비교 측정 필요.** 회사 데이터가 한국어/영어 섞이면 Cohere multilingual 가 안전. Titan 은 영어 위주. |
| **LLM** | Anthropic Claude Sonnet 4.5 (직접 API) | Bedrock 의 Claude (같은 모델, 다른 API) | **리전/지연시간 검토 필수.** 서울 리전 가능. Provisioned Throughput vs 온디맨드 비용 모델 다름. |
| **청킹** | 박지 않음 (Day 1~3), 1주차 도입 | Knowledge Base 가 청킹 옵션 제공 (기본 300 tokens + overlap) | 청킹 사이즈 측정 안 하면 default 가 무난. 단 도메인 특수 (코드/SQL/긴 표) 면 직접 박는 게 안전. |
| **보안 / 거버넌스** | 외부 API 키 (.env.local) | IAM 권한 + VPC PrivateLink + CloudTrail 감사 로그 | **회사 데이터가 외부 안 나감.** 컴플라이언스 대응 자동. 개인 키 관리 부담 X. |
| **비용** | API 종량제 ($10/월 limit) | 온디맨드 또는 Provisioned Throughput | 트래픽 예측 가능하면 Provisioned 가 단가 ↓. 예측 안 되면 온디맨드. |
| **인용 추적** | 응답 끝 done 청크에 hits 박음, 페이지 절대경로 + score | Knowledge Base 가 자동 인용 반환 (`retrievedReferences`) | **인용 UX 박는 패턴은 같다.** Knowledge Base 가 metadata 함께 반환해서 출처 표시 쉽다. |

### 핵심 인사이트

**자비스에서 박은 코사인 유사도 top-K + 컨텍스트 빌더 패턴은 Bedrock Knowledge Base 가 그대로 박혀 있음.** 즉 같은 RAG 메커니즘이고 인프라/거버넌스 층만 다름.

**박을 가치 있는 측정 영역** (자비스에서 박은 함정과 동일하게 검토 필요):
- 임베딩 모델 다국어 품질 (한국어/영어 혼합 문서에서)
- 청킹 사이즈 + overlap (도메인별)
- top-K 와 reranking 박을지 여부
- 인용 fidelity (LLM 이 인용 강제 follow 하는지)

**박지 말 함정**:
- 직관적 source 가중치 박기 → 측정 안 하면 역효과 (자비스 경험)
- 메타 파일 / 노이즈 노트 인덱싱 → 검색 품질 저하

---

## 6. 다음 스펙 (1주차+)

- **청킹 도입** — 응답 input 토큰 1/3~1/4, spending limit 해소
- **TTS 음질 개선** — Web Speech → OpenAI TTS (`tts-1` + voice `nova`), 음성 모드 답변 시스템 프롬프트 분기 (영문 기술 용어 한국어 풀어쓰기)
- **multi-cite UI** — RAG top-3 다 표시 (현재 top-1만)
- **multi-turn UI** — 시안 single-turn 한계 해소
- **VAD** — 마이크 자동 무음 감지
- **Electron 패키징** — `.app/.dmg` 빌드 (4주차)
- **HN 큐레이션 query 좁히기** — `"AI agent"`/`"LLM"`/`"MCP"` 박기

---

## 7. Q&A

자유 토론. 박힐 만한 질문 안:
- Voyage vs Cohere vs OpenAI Embedding 어느 거 박을지?
- 청킹 사이즈 어떻게 결정?
- Knowledge Base 의 black-box retrieval 디버깅 어떻게?
- 인용 fidelity 가 떨어질 때 prompt engineering vs reranking 어디 박을지?
- 비용 모니터링 어떻게 박을지?

---

*박힌 코드: [GitHub repo url 박을 거]*
*문의: 대두*
