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

// 데모 상수(A_VOICE/A_RAG/Q_VOICE) 는 Block 25 (LLM) + Block 26 (Whisper) 실연결 후 제거.
// 시안의 reveal 타이밍 시연용이었음.

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

  // Block 26 — Whisper recording refs.
  // MediaRecorder 인스턴스, 모이는 audio chunk 배열, 마이크 stream, 취소 플래그.
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioStreamRef = useRef(null);
  const recordingCancelledRef = useRef(false);

  // Block 27 — TTS (Web Speech) refs.
  // 토큰을 문장 단위로 묶어서 utterance 로 queue. ttsQueueRef = 아직 utterance 안 박힌 누적,
  // ttsVoiceRef = 선택된 voice(한국어 우선), ttsPollIntervalRef = speechSynthesis 끝남 감지.
  const ttsQueueRef = useRef('');
  const ttsVoiceRef = useRef(null);
  const ttsPollIntervalRef = useRef(null);

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
  // 동시 실행 가드용 ref: 한글 IME에서 Enter가 두 번 발화되는 등으로 submitText가
  // 두 번 불리면 두 스트림이 같은 answer 버퍼에 토큰을 쏟아 답변이 섞인다.
  const inFlightRef = useRef(false);

  const submitText = useCallback(async (questionText) => {
    if (!questionText || !questionText.trim()) return;
    if (inFlightRef.current) return; // 진행 중인 요청 있으면 두 번째 호출 무시
    inFlightRef.current = true;
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
                path: topHit.path, // Block 28 — 칩 클릭 시 Obsidian URI 에 박힐 원본 경로
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
    } finally {
      inFlightRef.current = false; // 스트림 종료/에러 후 락 해제
    }
  }, [clearTimers]);

  /**
   * Block 26 — Whisper 실연결.
   *
   * 흐름:
   *   1) enterVoice — 마이크 권한 받고 MediaRecorder 시작. phase = v_listening.
   *   2) 사용자가 다시 트리거(마이크 버튼/⌘⇧Space) → finishRecording → MediaRecorder.stop()
   *   3) onstop 안: audio blob → /api/transcribe → text → setTranscript
   *      → /api/chat 호출 (Block 25 패턴 재사용) → 토큰 누적 + cite 매핑
   *   4) ESC = exitVoice (취소, transcribe 안 함, recording 폐기)
   *
   * TTS (Block 27 자리): 첫 토큰 도착 시 phase='answer' 로 박힘. Block 27 에서
   * 첫 토큰 즈음 phase='v_speaking' + TTS 재생 박을 거.
   */
  const stopMicrophoneStream = useCallback(() => {
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
    }
  }, []);

  // Block 27 — TTS 헬퍼들.
  // pickVoice: 마운트 시 voice 한 번 + 'voiceschanged' 이벤트(macOS 가 비동기 로드).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    function pickVoice() {
      const voices = window.speechSynthesis.getVoices();
      if (!voices || voices.length === 0) return;
      // 한국어 우선, 그 다음 영어, 마지막 fallback 첫 번째.
      const koreanVoice = voices.find((voice) => voice.lang?.toLowerCase().startsWith('ko'));
      const englishVoice = voices.find((voice) => voice.lang?.toLowerCase().startsWith('en'));
      ttsVoiceRef.current = koreanVoice ?? englishVoice ?? voices[0];
    }
    pickVoice();
    window.speechSynthesis.onvoiceschanged = pickVoice;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const speakUtterance = useCallback((text) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    if (!text || !text.trim()) return;
    const utterance = new SpeechSynthesisUtterance(text);
    if (ttsVoiceRef.current) utterance.voice = ttsVoiceRef.current;
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  }, []);

  // 토큰 chunk 가 도착할 때 호출. ttsQueueRef 에 누적하다가 문장 끝 만나면 utterance enqueue.
  const enqueueTokenForTts = useCallback((chunk) => {
    if (!chunk) return;
    ttsQueueRef.current += chunk;
    // 한국어/영어 문장 끝 부호 포함. 줄바꿈도 분할 트리거.
    const SENTENCE_END = /[.!?。！？\n]/;
    if (SENTENCE_END.test(chunk)) {
      const buffered = ttsQueueRef.current;
      ttsQueueRef.current = '';
      speakUtterance(buffered);
    }
  }, [speakUtterance]);

  // done 청크 도착 시 남은 버퍼를 마저 enqueue.
  const flushTtsQueue = useCallback(() => {
    if (ttsQueueRef.current) {
      const remaining = ttsQueueRef.current;
      ttsQueueRef.current = '';
      speakUtterance(remaining);
    }
  }, [speakUtterance]);

  // 진행 중인 TTS 전부 정지 + 큐 비움. exitVoice / 새 enterVoice 시 호출.
  const cancelTts = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    ttsQueueRef.current = '';
    if (ttsPollIntervalRef.current) {
      clearInterval(ttsPollIntervalRef.current);
      ttsPollIntervalRef.current = null;
    }
  }, []);

  // 200ms 폴링 — speechSynthesis 가 다 읽으면 phase='answer' 로 dock.
  // 안전망: 60s 후 강제 종료 (응답 길어도 그 안에 끝나야).
  const waitForTtsCompletion = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setPhase('answer');
      setVoice('idle');
      return;
    }
    if (ttsPollIntervalRef.current) {
      clearInterval(ttsPollIntervalRef.current);
    }
    const startedAt = Date.now();
    ttsPollIntervalRef.current = setInterval(() => {
      const stillSpeaking =
        window.speechSynthesis.speaking || window.speechSynthesis.pending;
      const timedOut = Date.now() - startedAt > 60000;
      if (!stillSpeaking || timedOut) {
        clearInterval(ttsPollIntervalRef.current);
        ttsPollIntervalRef.current = null;
        setPhase('answer');
        setVoice('idle');
      }
    }, 200);
  }, []);

  const enterVoice = useCallback(async () => {
    if (busyVoice()) return;
    clearTimers();
    cancelTts(); // Block 27 — 이전 답변 음성 진행 중이면 정지
    setSrc('voice');
    setQuestion('');
    setAnswer('');
    setShowCite(false);
    setCite({});
    setTranscript('');
    setPhase('v_listening');
    setVoice('listening');
    recordingCancelledRef.current = false;

    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = audioStream;
      const mediaRecorder = new MediaRecorder(audioStream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (chunkEvent) => {
        if (chunkEvent.data && chunkEvent.data.size > 0) {
          audioChunksRef.current.push(chunkEvent.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stopMicrophoneStream();
        if (recordingCancelledRef.current) {
          audioChunksRef.current = [];
          return;
        }
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioChunksRef.current = [];

        setPhase('v_thinking');
        setVoice('thinking');

        try {
          // 1) STT
          const formData = new FormData();
          formData.append('audio', audioBlob, 'recording.webm');
          const transcribeResponse = await fetch('/api/transcribe', {
            method: 'POST',
            body: formData,
          });
          if (!transcribeResponse.ok) {
            const errorBody = await transcribeResponse.json().catch(() => ({}));
            throw new Error(errorBody?.error ?? `transcribe HTTP ${transcribeResponse.status}`);
          }
          const transcribeData = await transcribeResponse.json();
          const recognisedText = transcribeData.text?.trim();
          if (!recognisedText) {
            throw new Error('인식된 텍스트 없음 (무음?)');
          }
          setQuestion(recognisedText);
          setTranscript(recognisedText);

          // 2) LLM (Block 25 패턴 재사용)
          const chatResponse = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'user', content: recognisedText }] }),
          });
          if (!chatResponse.ok) {
            const errorBody = await chatResponse.json().catch(() => ({}));
            throw new Error(errorBody?.error ?? `chat HTTP ${chatResponse.status}`);
          }
          if (!chatResponse.body) {
            throw new Error('chat 응답 body 없음');
          }

          const reader = chatResponse.body.getReader();
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
                  // Block 27 — 음성 모드는 phase='v_speaking' 유지 (답변 본문 안 보이고 "음성 응답 중" 박스).
                  // TTS 끝나면 폴링이 phase='answer' 로 dock.
                  setPhase('v_speaking');
                  setVoice('speaking');
                  setStreaming(true);
                }
                setAnswer((previous) => previous + payload.content);
                enqueueTokenForTts(payload.content);
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
                // 남은 토큰 버퍼를 마저 utterance enqueue. 그리고 speechSynthesis 끝남 폴링 시작.
                flushTtsQueue();
                waitForTtsCompletion();
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
          setAnswer(`(에러) ${error instanceof Error ? error.message : 'unknown'}`);
        }
      };

      mediaRecorder.start();
    } catch (error) {
      stopMicrophoneStream();
      setPhase('answer');
      setVoice('idle');
      setAnswer(`(마이크 에러) ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }, [
    busyVoice,
    clearTimers,
    stopMicrophoneStream,
    cancelTts,
    enqueueTokenForTts,
    flushTtsQueue,
    waitForTtsCompletion,
  ]);

  const finishRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recordingCancelledRef.current = false;
      recorder.stop();
    }
  }, []);

  const exitVoice = useCallback(() => {
    // ESC 또는 명시 취소: recording 폐기 + TTS 정지 + 답변 없음.
    recordingCancelledRef.current = true;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
    }
    stopMicrophoneStream();
    cancelTts();
    clearTimers();
    setStreaming(false);
    setVoice('idle');
    setPhase((p) => (answer ? 'answer' : 'empty'));
  }, [answer, clearTimers, stopMicrophoneStream, cancelTts]);

  // ⌘⇧Space toggle + ESC (Electron 메인 globalShortcut → Block 29 에서 IPC 합칠 거).
  // Block 26 — 토글 의미:
  //   - v_listening 중 ⌘⇧Space: finishRecording (transcribe → LLM)
  //   - thinking/speaking 중 ⌘⇧Space: 무시 (작업 끝까지 둠)
  //   - idle ⌘⇧Space: enterVoice (recording 시작)
  //   - ESC: 항상 exitVoice (취소, 폐기)
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.code === 'Space' || e.key === ' ')) {
        e.preventDefault();
        if (phase === 'v_listening') {
          finishRecording();
        } else if (!busyVoice()) {
          enterVoice();
        }
      } else if (e.key === 'Escape' && busyVoice()) {
        exitVoice();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busyVoice, enterVoice, exitVoice, finishRecording, phase]);

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
                    <button
                      onClick={async () => {
                        // Block 28 — Electron 환경이면 Obsidian 으로 열기. 아니면 noop.
                        if (typeof window === 'undefined' || !window.electronAPI?.openWikiPage) {
                          console.warn('Electron API not available — wiki open skipped');
                          return;
                        }
                        if (!cite.path) {
                          console.warn('cite.path missing — wiki open skipped');
                          return;
                        }
                        const result = await window.electronAPI.openWikiPage(cite.path);
                        if (!result?.ok) {
                          console.warn('open-wiki-page failed:', result?.error);
                        }
                      }}
                      title={cite.path ? `Obsidian 에서 ${cite.path} 열기` : '경로 없음'}
                      className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#3ee9e0]/[.32] bg-[#3ee9e0]/10 px-[13px] py-1.5 font-[IBM_Plex_Mono,monospace] text-[13.5px] text-[#7ef0e9] hover:bg-[#3ee9e0]/20"
                    >
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
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitText(input); }}
                placeholder="자비스에게 물어보기…"
                className="flex-1 border-none bg-transparent text-[17px] text-[#e8eef6] outline-none placeholder:text-[#5d6e82]"
              />
              <span className="rounded-[5px] border border-[#233044] px-2 py-1 font-[IBM_Plex_Mono,monospace] text-[11px] text-[#5d6e82]">↵</span>
              <button
                onClick={() => {
                  // Block 26 — 토글: 녹음 중이면 finish, 아니면 enter.
                  if (phase === 'v_listening') {
                    finishRecording();
                  } else if (!busyVoice()) {
                    enterVoice();
                  }
                }}
                title={phase === 'v_listening' ? '녹음 정지 + 전송' : '음성 모드'}
                className={`flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] border ${
                  phase === 'v_listening'
                    ? 'border-[#3ee9e0] bg-[#3ee9e0]/[.28] shadow-[0_0_18px_rgba(62,233,224,.4)]'
                    : 'border-[#3ee9e0]/40 bg-[#3ee9e0]/[.12]'
                }`}
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
