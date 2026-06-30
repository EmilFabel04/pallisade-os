/**
 * Maps a MediaRecorder MIME type to the file extension OpenAI Whisper expects.
 *
 * Whisper detects the audio format from the upload's filename extension, so we
 * must label the blob to match what the browser actually recorded — not assume
 * webm. Chrome records `audio/webm`, but Safari records `audio/mp4` and Firefox
 * can record `audio/ogg`; labeling those `.webm` makes Whisper reject them with
 * "Invalid file format". Supported by Whisper: flac, m4a, mp3, mp4, mpeg, mpga,
 * oga, ogg, wav, webm.
 */
const EXT_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/flac": "flac",
};

/** Extension (no dot) for a recorder MIME type; falls back to "webm". */
export function audioExtension(mimeType: string | null | undefined): string {
  if (!mimeType) return "webm";
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return EXT_BY_MIME[base] ?? "webm";
}
