// Shared, client-safe helpers (no secrets, no server imports).

export type Emotion = "action" | "emotional" | "suspense" | "informational";

export type Scene = {
  id: string;
  heading: string; // INT./EXT. line, or "Untitled scene"
  body: string; // full scene text including heading
  emotion: Emotion;
  wordCount: number;
};

const ACTION_WORDS =
  /\b(runs?|ran|chase[sd]?|fights?|fought|punch(?:es|ed)?|kicks?|explod(?:es|ed)|crash(?:es|ed)|gun(?:s|fire)?|shoot(?:s|ing)?|blood|attack(?:s|ed)?|fast|sprint|leap[sd]?|breaks?|slam(?:s|med)?)\b/i;
const EMO_WORDS =
  /\b(tear[sy]?|cry(?:ing|ies|ed)?|love|miss(?:es|ed)?|sob[bs]?|smile[sd]?|hug(?:s|ged)?|whisper(?:s|ed)?|gentle|softly|heart(?:break|broken)?|memor(?:y|ies)|lonely|alone)\b/i;
const SUSPENSE_WORDS =
  /\b(silent|silence|shadow[sy]?|dark(?:ness)?|footstep[s]?|creak(?:s|ed)?|whisper(?:s|ed)?|breath(?:e|ing)?|slow(?:ly)?|stare[sd]?|behind|hidden|knock(?:s|ed)?|door)\b/i;

const SCENE_HEADING_RE = /^(INT\.|EXT\.|INT\/EXT\.|EXT\/INT\.)/i;

export function parseScenes(text: string): Scene[] {
  if (!text.trim()) return [];

  const lines = text.split("\n");
  const blocks: { heading: string; lines: string[] }[] = [];
  let current: { heading: string; lines: string[] } | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (SCENE_HEADING_RE.test(line.trim())) {
      if (current) blocks.push(current);
      current = { heading: line.trim(), lines: [line] };
    } else {
      if (!current) current = { heading: "Opening", lines: [] };
      current.lines.push(line);
    }
  }
  if (current) blocks.push(current);

  // If no scene headings detected, fall back to chunking by blank-line groups
  if (blocks.length <= 1 && !SCENE_HEADING_RE.test(blocks[0]?.heading ?? "")) {
    const chunks = text
      .split(/\n\s*\n\s*\n+/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (chunks.length > 1) {
      return chunks.map((body, i) => buildScene(`Scene ${i + 1}`, body, i));
    }
  }

  return blocks.map((b, i) =>
    buildScene(b.heading || `Scene ${i + 1}`, b.lines.join("\n").trim(), i),
  );
}

function buildScene(heading: string, body: string, idx: number): Scene {
  const wc = body.trim() ? body.trim().split(/\s+/).length : 0;
  return {
    id: `scene-${idx}`,
    heading,
    body,
    emotion: detectEmotion(body),
    wordCount: wc,
  };
}

export function detectEmotion(text: string): Emotion {
  const scores = {
    action: countMatches(text, ACTION_WORDS),
    emotional: countMatches(text, EMO_WORDS),
    suspense: countMatches(text, SUSPENSE_WORDS),
  };
  const max = Math.max(scores.action, scores.emotional, scores.suspense);
  if (max === 0) return "informational";
  if (scores.action === max) return "action";
  if (scores.emotional === max) return "emotional";
  return "suspense";
}

function countMatches(text: string, re: RegExp): number {
  const m = text.match(new RegExp(re.source, re.flags + "g"));
  return m ? m.length : 0;
}

export const EMOTION_VOICE_PRESETS: Record<
  Emotion,
  { stability: number; style: number; speed: number; label: string }
> = {
  action: { stability: 0.3, style: 0.75, speed: 1.08, label: "Intense" },
  emotional: { stability: 0.78, style: 0.25, speed: 0.92, label: "Soft" },
  suspense: { stability: 0.65, style: 0.55, speed: 0.88, label: "Deep" },
  informational: {
    stability: 0.55,
    style: 0.35,
    speed: 1.0,
    label: "Neutral",
  },
};

export const EMOTION_COLORS: Record<Emotion, string> = {
  action: "oklch(0.68 0.22 25)", // red
  emotional: "oklch(0.78 0.14 320)", // soft magenta
  suspense: "oklch(0.6 0.12 260)", // indigo
  informational: "oklch(0.78 0.165 70)", // amber (primary)
};
