import { searchFiles, readFileContent } from "@/lib/drive/driveApi";
import { GmailAuthError } from "@/lib/gmail/client";

export interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export const DRIVE_TOOLS: ToolDef[] = [
  {
    name: "drive_search",
    description:
      "Search the founder's Google Drive for relevant .md docs, transcripts and notes. " +
      "Returns up to 20 files as {id, name}. Use specific keywords from the conversation.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "keywords; empty lists recent readable files" } },
    },
  },
  {
    name: "drive_read_file",
    description:
      "Read the full text of one Drive file by its id (from drive_search). Google Docs are returned as markdown.",
    input_schema: {
      type: "object",
      properties: { fileId: { type: "string", description: "the file id from drive_search" } },
      required: ["fileId"],
    },
  },
];

export const DRIVE_TOOL_NAMES = new Set(DRIVE_TOOLS.map((t) => t.name));

const MAX_FILE_CHARS = 40000;

/** Resolve a Drive tool call to a JSON string. Never throws — failures become
 *  a JSON `{ error }` the model can read and relay. */
export async function resolveBrainTool(
  name: string,
  input: Record<string, unknown>,
  driveAccountId: string | null,
): Promise<string> {
  if (!driveAccountId) {
    return JSON.stringify({ error: "Google Drive is not connected. Ask the founder to connect Drive." });
  }
  try {
    if (name === "drive_search") {
      const files = await searchFiles(driveAccountId, String(input.query ?? ""));
      return JSON.stringify({ files: files.map((f) => ({ id: f.id, name: f.name })) });
    }
    if (name === "drive_read_file") {
      const text = await readFileContent(driveAccountId, String(input.fileId ?? ""));
      const clipped = text.length > MAX_FILE_CHARS ? `${text.slice(0, MAX_FILE_CHARS)}\n[truncated]` : text;
      return JSON.stringify({ content: clipped });
    }
    return JSON.stringify({ error: `unknown tool: ${name}` });
  } catch (e) {
    if (e instanceof GmailAuthError) {
      return JSON.stringify({ error: "Google Drive needs reconnecting (token expired)." });
    }
    return JSON.stringify({ error: (e as Error).message });
  }
}
