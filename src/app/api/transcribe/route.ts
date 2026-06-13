import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";

/** Reports whether voice transcription is available (OpenAI key present). */
export async function GET() {
  return NextResponse.json({ configured: !!process.env.OPENAI_API_KEY, model: MODEL });
}

/** Accepts an audio blob (multipart field "audio") and returns the transcript. */
export async function POST(req: Request) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ error: "no_key" }, { status: 503 });

  let audio: Blob | null = null;
  try {
    const form = await req.formData();
    const f = form.get("audio");
    if (f instanceof Blob) audio = f;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!audio || audio.size === 0) {
    return NextResponse.json({ error: "no_audio" }, { status: 400 });
  }

  const out = new FormData();
  out.append("file", audio, "audio.webm");
  out.append("model", MODEL);
  out.append("response_format", "text");

  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: out,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `transcribe_${res.status}`, detail: detail.slice(0, 300) },
        { status: 502 },
      );
    }
    // response_format=text returns the transcript as a plain string body.
    const text = (await res.text()).trim();
    return NextResponse.json({ text });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
