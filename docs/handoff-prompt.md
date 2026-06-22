# 회사 맥 Claude 핸드오프 프롬프트

> 본인 맥에서 박은 발표 자료(`docs/confluence-deck.md`)를 회사 맥 환경에서 다듬을 때 던질 프롬프트.
> 회사 맥의 Claude (cowork 등) 에 통째로 복붙. jarvis 폴더 + wiki 폴더 둘 다 mount 추천.

---

## 프롬프트 (이 줄 밑으로 통째 복붙)

```
[컨텍스트]
나는 자비스라는 사이드 프로젝트를 박았어. Obsidian 위키를 long-term memory 로 쓰는 개인 RAG 비서야 (위키 RAG 텍스트 채팅 + 음성 인터페이스 + Electron 데스크톱 앱).

오늘 회사 팀 앞에서 10~15분 발표할 예정이야. 발표 톤은 "자비스 자랑이 아니라 RAG 메커니즘 + 사내 Bedrock 적용 시 인사이트 공유". 청중은 회사 팀 — 개발자가 섞여 있지만 RAG/LLM/임베딩 직접 경험 없는 사람도 있어.

[현재 자료]
`docs/confluence-deck.md` 에 발표 자료 초안 박혀 있어. 자비스 코드(`app/`, `lib/`, `electron/`)랑 README 도 같이 읽어가며 컨텍스트 잡아줘.

(옵션: `.env.local` 의 `OBSIDIAN_WIKI_PATH` 폴더 안에 `wiki/wiki/RAG-Day1-baseline-평가.md` 같은 측정 노트가 있어. 더 깊이 들어가고 싶으면 그것도 읽어.)

[작업]
`docs/confluence-deck.md` 를 다음 방향으로 개선해줘:

1. 어려운 개념 쉽게 풀어쓰기
   - 임베딩 / 벡터 / 코사인 유사도 / 청킹 같은 개념을 모르는 사람도 이해 가능하게.
   - 비유와 일상 예시 박아 (예: "임베딩 = 문서의 좌표 찍기. 비슷한 의미는 가까운 점").
   - 특히 RAG 메커니즘 섹션 (현재 §3) 이 핵심 — 자세히 + 쉽게.

2. 그림 풍부하게
   - mermaid 다이어그램 박혀 있으면 좋음 (Confluence 가 mermaid 매크로로 받음).
   - mermaid 안 되면 ASCII art / 단순 박스+화살표 / 또는 표.
   - 박을 만한 그림: RAG 흐름 (인덱싱 → 질의 5단계), 임베딩 공간 시각화 (의미 가까운 점 모여 있는 모양), Bedrock vs 자비스 책임 분담 다이어그램.

[유지할 거 (변경 금지)]
- 자비스 자랑 X 톤 — 사이드 자랑 아니라 인사이트 공유
- 솔직함 — "TTS 어감 어색", "측정 안 하면 직관 함정", "박지 않은 거" 다 솔직 박기
- Bedrock 인사이트 섹션 (§5) — 자비스 vs Bedrock 비교 표 + 핵심 인사이트 살리기. 자비스 코사인 검색 패턴이 Bedrock Knowledge Base 에 그대로 박혀 있다는 메시지 유지.
- 박힌 측정 데이터 — source 가중치 0.6 폐기, 메타 파일 인덱싱 제외, 응답 토큰 1.5만~3만, HN rejection 80%. 다 살리되 표현은 쉽게.

[변경 자유 영역]
- 섹션 순서 손대도 OK
- 표/박스/다이어그램 추가 자유
- 새 비유/예시 박아도 OK
- 마지막 placeholder `[GitHub repo url 박을 거]` 는 그대로 두기

[결과물]
- 같은 파일 `docs/confluence-deck.md` 갱신 (overwrite)
- Confluence 호환 markdown (mermaid 매크로 OK)
- 다 박은 후 짧게 변경 요약 (어떤 비유 박았는지, 어떤 그림 박았는지)
```

---

## 사용 흐름

1. 회사 맥에 repo clone + `.env.local` 박기 (README Quickstart 참고)
2. Claude (cowork) 에 jarvis 폴더 mount
3. 위 프롬프트 ``` 블록 안 통째 복붙
4. 결과 받으면 자비스에서 실제 동작 확인 (text 1 + voice 1 시연 쿼리)
5. `docs/confluence-deck.md` 통째 Confluence 새 페이지에 복붙
