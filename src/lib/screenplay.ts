/**
 * Deterministic screenplay parser. Produces a structured representation
 * without modifying the original script text.
 */

export type ElementType =
  | "transition"
  | "heading"
  | "action"
  | "character"
  | "parenthetical"
  | "dialogue"
  | "shot"
  | "montage";

export type ScreenplayElement = { type: ElementType; text: string; line: number };

export type ParsedScene = {
  id: string;
  number: number;
  heading: string;
  intExt: "INT" | "EXT" | "INT/EXT" | "";
  location: string;
  timeOfDay: string;
  characters: string[];
  action: string;
  dialogue: { character: string; parenthetical?: string; text: string }[];
  elements: ScreenplayElement[];
};

const HEADING_RE = /^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|INT\.|EXT\.|INT |EXT )\s*(.*)$/i;
const TRANSITION_RE =
  /^(FADE IN:?|FADE OUT\.?|FADE TO BLACK\.?|CUT TO:|SMASH CUT TO:|MATCH CUT TO:|DISSOLVE TO:|JUMP CUT TO:|WIPE TO:|[A-Z ]+ TO:)$/;
const SHOT_RE = /^(CLOSE ON|CLOSE-UP|ANGLE ON|WIDE ON|POV|INSERT|BACK TO SCENE|EXTREME CLOSE)/i;
const MONTAGE_RE = /^(MONTAGE|BEGIN MONTAGE|END MONTAGE|SERIES OF SHOTS|INTERCUT)/i;

function isCue(l: string) {
  if (l.length > 42 || l.length < 2) return false;
  if (HEADING_RE.test(l) || TRANSITION_RE.test(l) || SHOT_RE.test(l) || MONTAGE_RE.test(l))
    return false;
  const stripped = l.replace(/\(.*?\)\s*$/, "").replace(/[:]$/, "").trim();
  const letters = stripped.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2) return false;
  if (/[.!?]$/.test(stripped)) return false;
  return letters === letters.toUpperCase();
}

export function cleanCharacter(cue: string) {
  return cue
    .replace(/\(.*?\)/g, "")
    .replace(/[:]$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function parseElements(script: string): ScreenplayElement[] {
  const lines = script.replace(/\r\n/g, "\n").split("\n");
  const out: ScreenplayElement[] = [];
  let inDialogue = false;
  lines.forEach((raw, i) => {
    const l = raw.trim();
    if (!l) {
      inDialogue = false;
      return;
    }
    if (HEADING_RE.test(l) && /^(INT|EXT|I\/E)/i.test(l)) {
      out.push({ type: "heading", text: l, line: i });
      inDialogue = false;
    } else if (TRANSITION_RE.test(l)) {
      out.push({ type: "transition", text: l, line: i });
      inDialogue = false;
    } else if (MONTAGE_RE.test(l)) {
      out.push({ type: "montage", text: l, line: i });
      inDialogue = false;
    } else if (SHOT_RE.test(l)) {
      out.push({ type: "shot", text: l, line: i });
      inDialogue = false;
    } else if (!inDialogue && isCue(l)) {
      out.push({ type: "character", text: l, line: i });
      inDialogue = true;
    } else if (inDialogue && /^\(.*\)$/.test(l)) {
      out.push({ type: "parenthetical", text: l, line: i });
    } else if (inDialogue) {
      out.push({ type: "dialogue", text: l, line: i });
    } else {
      out.push({ type: "action", text: l, line: i });
    }
  });
  return out;
}

function splitHeading(h: string) {
  const m = h.match(HEADING_RE);
  const prefix = (m?.[1] ?? "").toUpperCase().replace(/\s/g, "");
  const intExt: ParsedScene["intExt"] = /INT.*EXT|EXT.*INT|I\/E/.test(prefix)
    ? "INT/EXT"
    : prefix.startsWith("INT")
      ? "INT"
      : prefix.startsWith("EXT")
        ? "EXT"
        : "";
  const rest = (m?.[2] ?? h).trim();
  const parts = rest.split(/\s+[-–—]\s+/);
  const location = (parts.length > 1 ? parts.slice(0, -1).join(" - ") : rest).trim();
  const timeOfDay = parts.length > 1 ? parts[parts.length - 1].trim() : "";
  return { intExt, location, timeOfDay };
}

/** Split script into scenes. Scripts with no headings become one scene per paragraph block. */
export function parseScenes(script: string): ParsedScene[] {
  const els = parseElements(script);
  const scenes: ParsedScene[] = [];
  let cur: ParsedScene | null = null;
  const start = (heading: string) => {
    const { intExt, location, timeOfDay } = splitHeading(heading);
    cur = {
      id: "",
      number: scenes.length + 1,
      heading,
      intExt,
      location,
      timeOfDay,
      characters: [],
      action: "",
      dialogue: [],
      elements: [],
    };
    scenes.push(cur);
  };
  let lastChar = "";
  let lastParen: string | undefined;
  for (const e of els) {
    if (e.type === "heading") {
      start(e.text);
      continue;
    }
    if (!cur) {
      if (e.type === "transition") continue;
      start("UNTITLED SCENE");
    }
    const c = cur!;
    c.elements.push(e);
    if (e.type === "action" || e.type === "shot" || e.type === "montage")
      c.action += (c.action ? " " : "") + e.text;
    if (e.type === "character") {
      lastChar = cleanCharacter(e.text);
      lastParen = undefined;
      if (!c.characters.includes(lastChar)) c.characters.push(lastChar);
    }
    if (e.type === "parenthetical") lastParen = e.text.replace(/^\(|\)$/g, "");
    if (e.type === "dialogue") {
      const prev = c.dialogue[c.dialogue.length - 1];
      if (prev && prev.character === lastChar && c.elements[c.elements.length - 2]?.type === "dialogue")
        prev.text += " " + e.text;
      else c.dialogue.push({ character: lastChar, parenthetical: lastParen, text: e.text });
    }
  }
  // Stable-ish ids from content so re-parsing the same script keeps ids.
  scenes.forEach((s, i) => {
    s.number = i + 1;
    s.id = `sc-${i + 1}-${hash(s.heading + s.action.slice(0, 80))}`;
  });
  return scenes.filter((s) => s.action || s.dialogue.length || s.heading !== "UNTITLED SCENE");
}

export function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
