import OpenAI from "openai";

const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Whisper STT 라우트 (Block 26).
 *
 * 클라이언트(JarvisConsole)에서 multipart/form-data 로 'audio' 필드에 Blob/File 보냄.
 * 서버는 OpenAI Whisper API 로 전달해 텍스트 반환.
 *
 * 응답:
 *   200: { text: string }
 *   400: { error: string }
 *   500: { error: string }
 *
 * 모델 선택: whisper-1 (OpenAI Hosted, 가성비 좋음).
 * 언어: auto-detect (사용자가 한국어/영어 섞을 가능성). 정확도 떨어지면 language: 'ko' 명시.
 *
 * 비용: $0.006/min. 시연용 한 번에 1분 이하 → 무시 가능 수준.
 */
export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "multipart 파싱 실패" }, { status: 400 });
  }

  const audioField = formData.get("audio");
  if (!(audioField instanceof File)) {
    return Response.json(
      { error: "'audio' 필드에 파일 필요" },
      { status: 400 }
    );
  }

  try {
    const transcription = await openaiClient.audio.transcriptions.create({
      file: audioField,
      model: "whisper-1",
    });

    return Response.json({ text: transcription.text });
  } catch (error) {
    console.error("[/api/transcribe] error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "unknown" },
      { status: 500 }
    );
  }
}
