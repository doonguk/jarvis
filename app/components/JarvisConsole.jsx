'use client';

/**
 * JARVIS HUD Console — Next.js 16 / React 19 / Tailwind v4
 * ------------------------------------------------------------------
 * Drop-in client component. No external deps (canvas orb is hand-drawn).
 *
 * 통합 메모:
 *  - STT(Whisper): enterVoice() 안의 reveal('transcript', ...) 데모를
 *    실제 마이크 스트림 → Whisper 부분 transcript 업데이트로 교체.
 *  - LLM 스트리밍: submitText() / 음성 speaking 단계의 reveal('answer', ...)을
 *    토큰 스트림 onToken(t => setAnswer(a => a + t)) 으로 교체.
 *  - TTS: v_speaking 진입 시 audio 재생 시작, onended → setPhase('answer').
 *    (지금은 텍스트 길이로 duration 추정)
 *  - 인용: setCite({ page, score }) — 답변에 함께 노출. page 클릭 시 위키 라우팅.
 *  - Electron tray + ⌘⇧Space 글로벌 단축키는 메인 프로세스 globalShortcut 으로,
 *    렌더러에서는 onToggle 콜백만 받아 enterVoice/exitVoice 호출하면 됨.
 *
 * Tailwind v4: 별도 config 불필요. 색은 임의값(arbitrary value)로 인라인.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

const HUES = { idle: '#7b8fa5', listening: '#3ee9e0', thinking: '#9682f5', speaking: '#f5b25a' };
const LABELS = { idle: 'READY', listening: 'LISTENING', thinking: 'THINKING', speaking: 'SPEAKING' };

const A_VOICE =
  '위키의 STT/Whisper-설정 노트 기준, 설정에서 음성, 모델 순서로 들어가면 바꿀 수 있어요. ' +
  '현재 기본 모델은 small.en 이고, 영어 위주면 그대로 두는 걸 추천해요. ' +
  '한국어 받아쓰기 정확도가 필요하면 large-v3 로 올리되 GPU 메모리를 더 쓴다는 점만 감안하세요.';
const A_RAG =
  '질문이 들어오면 임베딩해 둔 Obsidian 위키 인덱스에서 의미가 가까운 노트를 먼저 찾고, 그 본문을 컨텍스트로 넣어 답을 생성합니다. ' +
  '청크는 512토큰에 64토큰 오버랩으로 잘랐고, 검색은 코사인 유사도 상위 6개를 가져온 뒤 재정렬해 상위 3개만 프롬프트에 넣어요. ' +
  '근거가 된 노트는 항상 인용으로 함께 노출해서, 답이 어디서 나왔는지 추적할 수 있게 했습니다.';
const Q_VOICE = 'Whisper STT 설정 어디서 바꾸지?';

/**
 * wiki path → 화면 표시용 라벨.
 * lib/wiki.ts 가 wiki root 기준 상대경로(예: 'wiki/RAG-파이프라인.md', 'raw/curated/2026-06-21.md')를 박음.
 * 첫 디렉토리 (wiki/raw) 떼고 .md 제거.
 */
function formatWikiPath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return 'unknown';
  return rawPath.replace(/^(wiki|raw)\//, '').replace(/\.md$/, '');
}

/* ─────────────────────────── Orb (canvas) ─────────────────────────── */
function useOrb(voice) {
  const canvasRef = useRef(null);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const SIZE = 300;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = SIZE * dpr;
    c.height = SIZE * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);

    let raf;
    const waves = [];
    let lastWave = 0;

    const draw = (now) => {
      const st = voiceRef.current;
      const col = HUES[st];
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      ctx.save();
      ctx.translate(SIZE / 2, SIZE / 2);

      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 118, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (st === 'idle') {
        ctx.globalAlpha = 0.28;
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, 84 + 4 * Math.sin(now / 1100), 0, Math.PI * 2);
        ctx.stroke();
        ctx.save();
        ctx.rotate(now / 4000);
        ctx.globalAlpha = 0.22;
        ctx.setLineDash([4, 10]);
        ctx.beginPath();
        ctx.arc(0, 0, 60, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 0.55;
        ctx.shadowBlur = 26;
        ctx.shadowColor = col;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(0, 0, 18 + 5 * Math.sin(now / 900), 0, Math.PI * 2);
        ctx.fill();
      }
      if (st === 'listening') {
        const N = 78, R = 80;
        ctx.lineCap = 'round';
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = col;
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2;
          const amp = 5 + 30 * Math.abs(Math.sin(now / 240 + i * 0.5)) * (0.45 + 0.55 * Math.sin(now / 120 + i * 0.8));
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R);
          ctx.lineTo(Math.cos(a) * (R + amp), Math.sin(a) * (R + amp));
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 30;
        ctx.shadowColor = col;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(0, 0, 16 + 3 * Math.sin(now / 180), 0, Math.PI * 2);
        ctx.fill();
      }
      if (st === 'thinking') {
        const rot = now / 1100;
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = col;
        for (let k = 0; k < 2; k++) {
          const r = 58 + k * 26;
          const dir = k % 2 ? -1 : 1;
          ctx.save();
          ctx.rotate(rot * dir * (1 + k * 0.5));
          ctx.globalAlpha = 0.65;
          for (let s = 0; s < 3; s++) {
            const start = s * ((Math.PI * 2) / 3);
            ctx.beginPath();
            ctx.arc(0, 0, r, start, start + Math.PI / 3.2);
            ctx.stroke();
          }
          ctx.restore();
        }
        for (let d = 0; d < 3; d++) {
          const a = now / 700 + d * ((Math.PI * 2) / 3);
          ctx.globalAlpha = 1;
          ctx.shadowBlur = 14;
          ctx.shadowColor = col;
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * 94, Math.sin(a) * 94, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 24;
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(0, 0, 11, 0, Math.PI * 2);
        ctx.fill();
      }
      if (st === 'speaking') {
        if (now - lastWave > 600) { waves.push(now); lastWave = now; }
        for (let i = waves.length - 1; i >= 0; i--) if (now - waves[i] >= 2000) waves.splice(i, 1);
        ctx.lineWidth = 2;
        ctx.strokeStyle = col;
        for (const b of waves) {
          const age = (now - b) / 2000;
          ctx.globalAlpha = (1 - age) * 0.45;
          ctx.beginPath();
          ctx.arc(0, 0, 28 + age * 80, 0, Math.PI * 2);
          ctx.stroke();
        }
        const M = 11;
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 14;
        ctx.shadowColor = col;
        ctx.fillStyle = col;
        for (let i = 0; i < M; i++) {
          const x = (i - (M - 1) / 2) * 9;
          const h = 8 + 38 * Math.abs(Math.sin(now / 170 + i * 0.7));
          ctx.beginPath();
          ctx.rect(x - 2, -h / 2, 4, h);
          ctx.fill();
        }
      }
      ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return canvasRef;
}

/* ─────────────────────────── Component ─────────────────────────── */
export default function JarvisConsole() {
  // phase: empty | t_thinking | answer | v_listening | v_thinking | v_speaking
  const [phase, setPhase] = useState('empty');
  const [voice, setVoice] = useState('idle');
  const [answer, setAnswer] = useState('');
  const [transcript, setTranscript] = useState('');
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [showCite, setShowCite] = useState(false);
  const [src, setSrc] = useState('text');
  const [question, setQuestion] = useState('');
  const [cite, setCite] = useState({});

  const timers = useRef([]);
  const revealIv = useRef(null);
  const canvasRef = useOrb(voice);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (revealIv.current) clearInterval(revealIv.current);
  }, []);
  const t = (fn, ms) => { const id = setTimeout(fn, ms); timers.current.push(id); return id; };

  // 데모용 타이핑 효과. 실제로는 토큰 스트림으로 교체.
  const reveal = useCallback((setter, full, step, done) => {
    if (revealIv.current) clearInterval(revealIv.current);
    let i = 0;
    setter('');
    revealIv.current = setInterval(() => {
      i++;
      setter(full.slice(0, i));
      if (i >= full.length) { clearInterval(revealIv.current); done && done(); }
    }, step);
  }, []);

  const busyVoice = useCallback(
    () => ['v_listening', 'v_thinking', 'v_speaking'].includes(phase),
    [phase]
  );

  /**
   * Block 25 — LLM 실제 연결.
   * 기존 데모 reveal 제거. /api/chat (Block 13 SSE 스트림) 호출 → 토큰 누적.
   * - 시안 변수명 't_thinking'/'answer' phase 그대로 사용.
   * - rag.hits[0] 을 인용 칩에 매핑. hits 0개면 cite 안 박음.
   * - 에러는 answer phase 에 (에러) 박스로 표시.
   * Multi-turn 정책 = Day 2 박힌 A 옵션 (매 턴 독립 검색, history 깨끗). 시안 single-turn UI 라 messages 도 단일.
   */
  const submitText = useCallback(async (questionText) => {
    if (!questionText || !questionText.trim()) return;
    clearTimers();
    setSrc('text');
    setQuestion(questionText);
    setInput('');
    setAnswer('');
    setShowCite(false);
    setCite({});
    setPhase('t_thinking');
    setVoice('thinking');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: questionText }] }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody?.error ?? `HTTP ${response.status}`);
      }
      if (!response.body) {
        throw new Error('응답 body 없음 — 스트림 불가');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantStarted = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let payload;
          try {
            payload = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          if (payload.type === 'token' && typeof payload.content === 'string') {
            if (!assistantStarted) {
              assistantStarted = true;
              setPhase('answer');
              setVoice('idle');
              setStreaming(true);
            }
            setAnswer((previous) => previous + payload.content);
          } else if (payload.type === 'done') {
            const hits = payload.rag?.hits;
            if (Array.isArray(hits) && hits.length > 0) {
              const topHit = hits[0];
              setCite({
                page: formatWikiPath(topHit.path),
                score: typeof topHit.score === 'number' ? topHit.score.toFixed(2) : '',
              });
            }
            setStreaming(false);
            setShowCite(true);
            console.log('[/api/chat] usage:', payload.usage);
            console.log('[/api/chat] rag:', payload.rag);
          } else if (payload.type === 'error') {
            throw new Error(payload.error ?? 'unknown stream error');
          }
        }
      }
    } catch (error) {
      setStreaming(false);
      setShowCite(false);
      setPhase('answer');
      setVoice('idle');
      setAnswer(`(에러) ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }, [clearTimers]);

  const enterVoice = useCallback(() => {
    if (busyVoice()) return;
    clearTimers();
    setSrc('voice'); setQuestion(Q_VOICE); setAnswer(''); setShowCite(false);
    setPhase('v_listening'); setVoice('listening');
    reveal(setTranscript, Q_VOICE, 42, () => {
      t(() => {
        setPhase('v_thinking'); setVoice('thinking');
        t(() => {
          setPhase('v_speaking'); setVoice('speaking');
          setCite({ page: 'STT/Whisper-설정', score: '0.92' });
          const dur = Math.min(A_VOICE.length * 42, 6500);
          t(() => {
            setAnswer(A_VOICE); setStreaming(false); setShowCite(true);
            setPhase('answer'); setVoice('idle');
          }, dur);
        }, 1600);
      }, 600);
    });
  }, [busyVoice, clearTimers, reveal]);

  const exitVoice = useCallback(() => {
    clearTimers();
    setStreaming(false); setVoice('idle');
    setPhase((p) => (answer ? 'answer' : 'empty'));
  }, [answer, clearTimers]);

  // ⌘⇧Space toggle + ESC (Electron: 메인 globalShortcut → 이 콜백 호출로 대체 가능)
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.code === 'Space' || e.key === ' ')) {
        e.preventDefault();
        busyVoice() ? exitVoice() : enterVoice();
      } else if (e.key === 'Escape' && busyVoice()) {
        exitVoice();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busyVoice, enterVoice, exitVoice]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const hue = HUES[voice];
  const docked = phase === 'answer';
  const isThinking = phase === 'v_thinking' || phase === 't_thinking';
  const ease = 'cubic-bezier(.2,.8,.2,1)';

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#05080d] p-10 font-[IBM_Plex_Sans,sans-serif] antialiased">
      <div
        className="relative flex h-[740px] w-[1100px] flex-col overflow-hidden rounded-2xl border border-[#1a2230]"
        style={{
          background: 'radial-gradient(900px 600px at 50% 30%, #0c141d, #06090e 72%)',
          boxShadow: '0 40px 120px rgba(0,0,0,.65)',
        }}
      >
        {/* TITLE BAR */}
        <div className="z-[5] flex h-[42px] flex-none items-center gap-3.5 border-b border-[#121a24] px-[18px]">
          <div className="flex gap-2">
            <span className="h-[11px] w-[11px] rounded-full bg-[#3a4456]" />
            <span className="h-[11px] w-[11px] rounded-full bg-[#3a4456]" />
            <span className="h-[11px] w-[11px] rounded-full bg-[#3a4456]" />
          </div>
          <div className="flex-1 text-center font-[IBM_Plex_Mono,monospace] text-[11px] tracking-[.34em] text-[#5d6e82]">
            JARVIS · CONSOLE
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 font-[IBM_Plex_Mono,monospace] text-[10px] text-[#3ee9e0]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#3ee9e0] shadow-[0_0_8px_#3ee9e0]" />
              1,284
            </span>
            <span className="rounded-[5px] border border-[#1c2636] px-[7px] py-[3px] font-[IBM_Plex_Mono,monospace] text-[10px] tracking-[.1em] text-[#3a4456]">
              ⌘⇧Space
            </span>
          </div>
        </div>

        {/* STAGE */}
        <div className="relative min-h-0 flex-1">
          {/* ORB (morphs big center <-> docked top) */}
          <div
            className="absolute left-1/2 z-[2]"
            style={{
              top: docked ? '8px' : '64px',
              transform: `translateX(-50%) scale(${docked ? 0.42 : 1})`,
              transformOrigin: 'top center',
              pointerEvents: 'none',
              transition: `top .6s ${ease}, transform .6s ${ease}`,
            }}
          >
            <div
              className="absolute left-1/2 top-1/2 z-0 h-[620px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ background: `radial-gradient(circle, ${hue}1f, transparent 60%)`, transition: 'background .6s ease', pointerEvents: 'none' }}
            />
            <canvas ref={canvasRef} className="relative z-[1] block h-[300px] w-[300px]" />
          </div>

          {/* BIG-MODE CAPTION BAND */}
          {(phase === 'empty' || phase === 'v_listening' || phase === 'v_speaking' || isThinking) && (
            <div className="absolute left-0 right-0 top-[392px] z-[3] flex flex-col items-center gap-3.5 px-[60px] text-center">
              <div className="font-[IBM_Plex_Mono,monospace] text-[12px] tracking-[.34em]" style={{ color: hue }}>
                {LABELS[voice]}
              </div>

              {phase === 'empty' && (
                <div className="text-[21px] font-light text-[#9fb0c3]">무엇이든 물어보세요</div>
              )}

              {phase === 'v_listening' && (
                <div className="max-w-[600px] text-[24px] font-light leading-[1.5] text-[#cdd8e4]">
                  <span className="font-[IBM_Plex_Mono,monospace] text-[12px] tracking-[.1em] text-[#5d6e82]">YOU&nbsp;&nbsp;</span>
                  {transcript}
                  <span className="ml-[3px] inline-block h-[21px] w-[9px] animate-[jcursor_1s_steps(1)_infinite] align-text-bottom bg-[#3ee9e0]" />
                </div>
              )}

              {isThinking && (
                <div className="flex items-center gap-2 font-[IBM_Plex_Mono,monospace] text-[14px] tracking-[.04em] text-[#9682f5]">
                  위키에서 근거 탐색 중<span className="inline-flex gap-[3px]">···</span>
                </div>
              )}

              {phase === 'v_speaking' && (
                <div className="flex flex-col items-center gap-3.5">
                  <div className="font-[IBM_Plex_Mono,monospace] text-[13px] tracking-[.1em] text-[#f5b25a]">음성 응답 중…</div>
                  <span className="inline-flex items-center gap-2 rounded-lg border border-[#f5b25a]/45 bg-[#f5b25a]/[.14] px-[15px] py-[7px] font-[IBM_Plex_Mono,monospace] text-[14px] text-[#f7cd93] shadow-[0_0_22px_rgba(245,178,90,.2)]">
                    <span className="h-[5px] w-[5px] rounded-full bg-[#f5b25a] shadow-[0_0_8px_#f5b25a]" />
                    {cite.page} · {cite.score}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ANSWER COLUMN (docked / readable) */}
          {phase === 'answer' && (
            <div className="absolute bottom-[104px] left-0 right-0 top-[150px] z-[3] overflow-y-auto px-12">
              <div className="mx-auto flex max-w-[600px] flex-col gap-[18px]">
                <div className="flex items-center gap-2.5">
                  <span
                    className="font-[IBM_Plex_Mono,monospace] text-[11px] tracking-[.16em]"
                    style={{ color: src === 'voice' ? '#f5b25a' : '#3ee9e0' }}
                  >
                    {src === 'voice' ? 'VOICE · 음성 대화' : 'TEXT · 질의'}
                  </span>
                  <div className="h-px flex-1 bg-[#1a2230]" />
                </div>
                <div className="font-[IBM_Plex_Mono,monospace] text-[13px] leading-[1.5] tracking-[.02em] text-[#6b7d92]">
                  {question}
                </div>
                <div className="text-left text-[17px] leading-[1.75] text-[#cdd8e4]">
                  {answer}
                  {streaming && (
                    <span className="ml-[2px] inline-block h-[18px] w-2 animate-[jcursor_1s_steps(1)_infinite] align-text-bottom bg-[#3ee9e0]" />
                  )}
                </div>
                {showCite && (
                  <div className="flex flex-wrap items-center gap-2.5 pt-1">
                    <span className="font-[IBM_Plex_Mono,monospace] text-[11px] tracking-[.14em] text-[#5d6e82]">근거</span>
                    <button className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#3ee9e0]/[.32] bg-[#3ee9e0]/10 px-[13px] py-1.5 font-[IBM_Plex_Mono,monospace] text-[13.5px] text-[#7ef0e9]">
                      <span className="h-[5px] w-[5px] rounded-full bg-[#3ee9e0] shadow-[0_0_8px_#3ee9e0]" />
                      {cite.page}
                    </button>
                    <span className="font-[IBM_Plex_Mono,monospace] text-[11px] text-[#5d6e82]">{cite.score}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* COMMAND BAR */}
          <div className="absolute bottom-0 left-0 right-0 z-[4] flex justify-center pb-[30px]">
            <div
              className="flex w-[660px] items-center gap-3.5 rounded-2xl py-[13px] pl-[22px] pr-3.5 backdrop-blur-lg"
              style={{
                background: 'rgba(15,20,28,.9)',
                border: `1px solid ${voice === 'idle' ? '#233044' : hue + '66'}`,
                boxShadow: `0 8px 40px rgba(0,0,0,.45), 0 0 0 ${voice === 'idle' ? '0px' : '3px'} ${voice === 'idle' ? 'transparent' : hue + '22'}`,
              }}
            >
              <input
                value={input}
                disabled={busyVoice()}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitText(input); }}
                placeholder="자비스에게 물어보기…"
                className="flex-1 border-none bg-transparent text-[17px] text-[#e8eef6] outline-none placeholder:text-[#5d6e82]"
              />
              <span className="rounded-[5px] border border-[#233044] px-2 py-1 font-[IBM_Plex_Mono,monospace] text-[11px] text-[#5d6e82]">↵</span>
              <button
                onClick={enterVoice}
                title="음성 모드"
                className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] border border-[#3ee9e0]/40 bg-[#3ee9e0]/[.12]"
              >
                <span className="flex items-center gap-[2.5px]">
                  <span className="h-[9px] w-[3px] rounded-[2px] bg-[#3ee9e0]" />
                  <span className="h-[15px] w-[3px] rounded-[2px] bg-[#3ee9e0]" />
                  <span className="h-[9px] w-[3px] rounded-[2px] bg-[#3ee9e0]" />
                </span>
              </button>
            </div>
          </div>

          {busyVoice() && (
            <div className="absolute bottom-[9px] left-0 right-0 z-[4] text-center font-[IBM_Plex_Mono,monospace] text-[10px] tracking-[.16em] text-[#3a4456]">
              ESC 종료 · ⌘⇧SPACE 토글
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
