# Jarvis

Obsidian 위키를 long-term memory 로 쓰는 개인 AI 비서. 위키 RAG 텍스트 채팅 + 음성 입력/응답 + 데스크톱 앱(Electron). ⌘⇧Space 로 어디서든 호출.

영감: [Karpathy 의 LLM Wiki 아이디어](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

---

## 박힌 기능

- **위키 RAG** — Obsidian 위키 파일을 Voyage 임베딩으로 인덱싱, 코사인 유사도 검색 후 Anthropic Claude 로 답변. 답변에 인용 페이지 표시.
- **인용 칩 → Obsidian** — 답변 dock 안 인용 칩 클릭 시 Obsidian URI 로 해당 위키 페이지 열림.
- **음성 입력** — OpenAI Whisper STT. 마이크 버튼 또는 단축키로 push-to-talk, 자동 LLM 전송.
- **음성 응답** — Web Speech API 로 TTS. 문장 단위 utterance 큐.
- **글로벌 단축키** — ⌘⇧Space 로 창 토글. 메뉴바 tray 아이콘 상주 (dock 숨김).
- **HUD UI** — Claude Design 시안 기반 단일 컴포넌트. 4 상태(idle/listening/thinking/speaking) 시각화.

## 기술 스택

- **Frontend**: Next.js 16 (App Router) + React 19 + Tailwind v4
- **Desktop**: Electron (dev 모드 wrapper)
- **LLM**: Anthropic Claude Sonnet 4.5
- **Embedding**: Voyage `voyage-3` (multilingual)
- **STT**: OpenAI Whisper API (`whisper-1`)
- **TTS**: Web Speech API (브라우저 내장, 1주차 OpenAI TTS 교체 예정)
- **Package manager**: pnpm

---

## Quickstart (회사 맥 / 새 환경)

### 1. 사전 요구사항

- macOS (Electron 마이크 권한 / Obsidian URI 핸들링)
- Node.js 20+ / pnpm 11+
- Obsidian (위키 페이지 열기용)
- 본인 Obsidian vault 가 로컬에 있어야 함 (RAG 인덱싱 대상)

### 2. clone + 의존성

```bash
git clone <repo-url> jarvis
cd jarvis
pnpm install
```

### 3. 환경변수 박기

`.env.example` 을 `.env.local` 로 복사하고 값 채우기.

```bash
cp .env.example .env.local
```

`.env.local` 안:

| 키 | 설명 |
| --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic Console 에서 발급 |
| `VOYAGE_API_KEY` | Voyage AI 에서 발급 (200M tokens 무료) |
| `OPENAI_API_KEY` | OpenAI 에서 발급 (Whisper 만 씀) |
| `OBSIDIAN_WIKI_PATH` | 본인 Obsidian vault 의 절대 경로 |
| `OBSIDIAN_VAULT_NAME` | Obsidian 좌측 하단 vault 이름 (인용 칩 클릭용) |

### 4. 띄우기

두 터미널 필요 (dev 모드, Electron 패키징은 4주차 영역):

```bash
# 터미널 1
pnpm dev

# 터미널 2 — Next dev 가 localhost:3000 떠야 띄움
pnpm electron
```

자비스 콘솔 화면이 뜨면 OK. dock 에는 안 보이고 메뉴바 우측 원형 아이콘으로 상주.

### 5. 마이크 권한 (첫 1회)

음성 모드 처음 진입 시 macOS 가 마이크 권한 모달 띄움. 허용. 한 번만.

---

## 사용

- **텍스트 채팅**: 명령창에 질문 + Enter → 위키에서 근거 찾아 답변 + 인용 칩.
- **음성 입력**: 마이크 버튼 또는 ⌘⇧Space → 녹음 시작 → 다시 누르면 정지 → STT → LLM → 음성 응답.
- **인용 확인**: 답변 dock 안 인용 칩 클릭 → Obsidian 으로 해당 페이지 열림.
- **창 토글**: ⌘⇧Space (어디서든).
- **취소**: ESC (녹음 중일 때).
- **종료**: tray 아이콘 우클릭 → 종료.

---

## 박힌 한계 (다음 스펙)

- **TTS 음질 어색** — Web Speech 무료 voice. 한국어 답변에 영문 기술 용어 섞이면 발음 어색. 1주차에 OpenAI TTS 로 교체 + 시스템 프롬프트 분기(음성 모드 답변 정제) 예정.
- **dev 모드만 동작** — Electron 패키징(.app/.dmg) 안 박음. `pnpm dev` + `pnpm electron` 두 프로세스 필요. 4주차 영역.
- **인용 top-1 만 표시** — RAG 가 top-3 가져오는데 UI 가 1개만. multi-cite UI 1주차.
- **multi-turn 대화 X** — single-turn 패턴 (시안 UI 한계). 매 질문 독립 검색.
- **VAD 안 박음** — 사용자가 마이크 정지 트리거 박아야. 자동 무음 감지 1주차.
- **canvas orb RAF 항상 돔** — 배터리/CPU 영향. 페이지 visibility 박을 거.

---

## 폴더 구조

```
jarvis/
├── app/                — Next.js App Router
│   ├── api/
│   │   ├── chat/       — RAG + Anthropic 스트림 (Block 13)
│   │   ├── transcribe/ — OpenAI Whisper (Block 26)
│   │   └── debug/      — 인덱싱/검색/프롬프트 디버그
│   ├── components/
│   │   └── JarvisConsole.jsx — Claude Design 시안 통합 (Block 24~28)
│   ├── page.tsx        — JarvisConsole 렌더만
│   ├── layout.tsx
│   └── globals.css     — IBM Plex fonts + jcursor 키프레임
├── electron/
│   ├── main.js         — 메인 프로세스 (창/단축키/tray/IPC/env loader)
│   ├── preload.js      — contextBridge (window.electronAPI)
│   └── assets/         — tray 아이콘
├── lib/
│   ├── wiki.ts         — wiki 파일 리스트 + source 분류
│   ├── embed.ts        — Voyage 임베딩 호출
│   ├── store.ts        — HMR-safe 인덱스 싱글톤
│   ├── search.ts       — 코사인 유사도
│   ├── prompt.ts       — 시스템 프롬프트 + 컨텍스트 빌더
│   └── curate/         — HN Algolia 큐레이션 (Day 3)
└── docs/
    └── ui-brief.md     — Claude Design 입력 brief
```

---

## License

MIT
