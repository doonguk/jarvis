// Day 4 / Block 24 — Claude Design 시안(JarvisConsole) 통합 진입점.
//
// 이전 page.tsx (Block 1~14에서 박은 state-only 챗 + SSE 스트림 소비) 는
// JarvisConsole 안 submitText 가 가져간다 (Block 25에서 실제 /api/chat 연결).
// 지금 단계는 시안 그대로, 데모 reveal 타이머로 동작.

import JarvisConsole from "./components/JarvisConsole";

export default function Home() {
  return <JarvisConsole />;
}
