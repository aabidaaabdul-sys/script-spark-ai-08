/** Shared storyboard types + deterministic visual prompt builder (browser + server). */

export type CharacterEntry = {
  id: string;
  name: string;
  ageRange: string;
  gender: string;
  appearance: string;
  hair: string;
  clothing: string;
  accessories: string;
  visualCues: string;
  referenceImage?: string; // data URL (stored locally)
};

export type LocationEntry = {
  id: string;
  name: string;
  architecture: string;
  environment: string;
  objects: string;
  lighting: string;
  palette: string;
  referenceImage?: string;
};

export type SceneAnalysis = {
  sceneId: string;
  title: string;
  description: string;
  locationId: string;
  characters: string[]; // character ids
  action: string;
  objects: string;
  weather: string;
  mood: string;
  cameraShot: string;
  cameraDirection: string;
  lighting: string;
  keyMoment: string;
  // Deeper staging fields (optional for older saved projects)
  season?: string;
  positions?: string;
  expressions?: string;
  bodyLanguage?: string;
  foreground?: string;
  midground?: string;
  background?: string;
  materials?: string;
  continuityNotes?: string;
};

export type QualityMode = "fast" | "cinematic" | "max";
export const QUALITY_MODES: { id: QualityMode; label: string; hint: string; corrections: number; inspect: boolean }[] = [
  { id: "fast", label: "Fast", hint: "Quickest. No automatic inspection.", corrections: 0, inspect: false },
  { id: "cinematic", label: "Cinematic", hint: "High quality, inspected, up to 1 automatic fix.", corrections: 1, inspect: true },
  { id: "max", label: "Maximum Detail", hint: "Highest quality, inspected, up to 2 automatic fixes.", corrections: 2, inspect: true },
];

export type InspectCheck = { name: string; result: "pass" | "issue" | "unclear"; note: string };
export type InspectReport = {
  status: "approved" | "needs_fix" | "unresolved";
  checks: InspectCheck[];
  issues: string[];
  correction: string; // targeted edit instruction, "" if none
  fixType: "none" | "edit" | "regenerate";
  model: string;
  at: number;
};

export type FrameVersion = {
  key: string; // IndexedDB asset key
  kind: "generated" | "corrected" | "uploaded";
  createdAt: number;
  prompt?: string;
  quality?: QualityMode;
  report?: InspectReport;
  hash?: string;
};

export type FrameStatus = "idle" | "queued" | "processing" | "completed" | "failed" | "cancelled";

export type StoryFrame = SceneAnalysis & {
  id: string;
  number: number;
  heading: string;
  timeOfDay: string;
  intExt: string;
  dialogueExcerpt: string;
  originalPrompt: string;
  editedPrompt?: string;
  status: FrameStatus;
  error?: string;
  imageKey?: string; // IndexedDB key
  imageUpdatedAt?: number;
  promptUsed?: string;
  versions?: FrameVersion[];
  report?: InspectReport;
  genHash?: string; // hash of prompt+refs+settings used for current image
  stage?: string; // live pipeline stage label
  styleOverride?: string;
  aspectOverride?: Aspect;
};

export const SHOT_TYPES = [
  "Extreme Wide Shot",
  "Wide Shot",
  "Full Shot",
  "Medium Shot",
  "Medium Close-Up",
  "Close-Up",
  "Extreme Close-Up",
  "Over-the-Shoulder",
  "Two-Shot",
  "Low Angle",
  "High Angle",
  "Bird's-Eye",
  "Dutch Angle",
];

export const VISUAL_STYLES: { id: string; label: string; hint: string }[] = [
  { id: "cinematic", label: "Cinematic", hint: "cinematic film still, anamorphic lens character, motivated dramatic lighting, rich color grade, shallow depth of field" },
  { id: "realistic", label: "Realistic", hint: "photorealistic, natural lighting, true-to-life textures and skin tones" },
  { id: "3d", label: "3D Animation", hint: "polished 3D animated feature look, soft global illumination, stylized but believable materials" },
  { id: "2d", label: "2D Animation", hint: "clean 2D animation frame, flat cel shading, painted backgrounds" },
  { id: "anime", label: "Anime-inspired", hint: "anime-inspired key frame, expressive lighting, painterly backgrounds, crisp line art" },
  { id: "comic", label: "Comic Book", hint: "comic book panel, bold inks, halftone shading, dynamic composition" },
  { id: "illustrative", label: "Illustrative", hint: "storyboard illustration, expressive brushwork, clear staging" },
  { id: "documentary", label: "Documentary", hint: "observational documentary photography, available light, handheld realism" },
  { id: "thriller", label: "Dark Thriller", hint: "dark thriller cinematography, low-key lighting, deep shadows, desaturated cold grade" },
  { id: "fantasy", label: "Fantasy", hint: "epic fantasy concept art, atmospheric depth, luminous light" },
  { id: "scifi", label: "Sci-Fi", hint: "science-fiction concept frame, sleek technology, practical and neon lighting" },
  { id: "custom", label: "Custom Style", hint: "" },
];

export const ASPECTS = ["16:9", "9:16", "4:3", "1:1", "21:9"] as const;
export type Aspect = (typeof ASPECTS)[number];

export function styleHint(styleId: string, custom: string) {
  if (styleId === "custom") return custom.trim().slice(0, 300) || "cinematic film still";
  return VISUAL_STYLES.find((s) => s.id === styleId)?.hint ?? VISUAL_STYLES[0].hint;
}

export function describeCharacter(c: CharacterEntry) {
  return [
    c.name,
    [c.gender, c.ageRange].filter(Boolean).join(", "),
    c.appearance,
    c.hair && `hair: ${c.hair}`,
    c.clothing && `wearing ${c.clothing}`,
    c.accessories && `accessories: ${c.accessories}`,
  ]
    .filter(Boolean)
    .join("; ");
}

/** Compact continuity context — only what this scene needs. */
export function buildContinuity(
  frame: StoryFrame,
  all: StoryFrame[],
  chars: CharacterEntry[],
  locs: LocationEntry[],
) {
  const idx = all.findIndex((f) => f.id === frame.id);
  const prior = all.slice(0, Math.max(0, idx));
  const sameLoc = prior.filter((f) => f.locationId === frame.locationId).slice(-2);
  const lines: string[] = [];
  for (const f of sameLoc) lines.push(`Earlier in this location (scene ${f.number}): ${f.description}`);
  const prev = prior[prior.length - 1];
  if (prev && !sameLoc.includes(prev)) lines.push(`Previous scene: ${prev.description}`);
  void chars;
  void locs;
  return lines.join(" ").slice(0, 600);
}

const QUALITY_TECH: Record<QualityMode, string> = {
  fast: "Clean, readable composition; natural proportions; consistent perspective.",
  cinematic: "High visual fidelity, detailed textures, natural anatomy and hands, coherent faces, consistent perspective and motivated lighting, professional cinematic finish.",
  max: "Maximum fine detail: crisp micro-textures in fabric, skin pores, wood grain, stone and metal; physically plausible light falloff, reflections and shadow direction; anatomically correct hands and faces; precise perspective; professional cinematic finish.",
};

/** Cinematic Prompt Compiler: structured scene data -> sectioned image instructions. */
export function buildVisualPrompt(args: {
  frame: StoryFrame;
  chars: CharacterEntry[];
  loc?: LocationEntry;
  style: string;
  aspect: string;
  continuity: string;
  quality?: QualityMode;
}) {
  const { frame: f, chars, loc, style, aspect, continuity, quality = "cinematic" } = args;
  const present = chars.filter((c) => f.characters.includes(c.id));
  const j = (...xs: (string | undefined | false)[]) => xs.filter(Boolean).join("; ");
  const count = present.length
    ? `Exactly ${present.length} named character${present.length > 1 ? "s" : ""} visible (${present.map((c) => c.name).join(", ")}); no extra people unless the scene states a crowd.`
    : "No named characters visible.";
  const parts = [
    `SUBJECT: ${f.keyMoment || f.action}. ${count}${f.positions ? ` Positions: ${f.positions}.` : ""}${f.objects ? ` Key objects: ${f.objects}.` : ""}`,
    `ENVIRONMENT: ${j(f.intExt, loc ? `${loc.name} — ${loc.architecture}` : f.heading, loc?.environment, loc?.objects && `recurring details: ${loc.objects}`, f.weather && `weather: ${f.weather}`, f.season && `season: ${f.season}`, `time: ${f.timeOfDay || "as implied by the scene"}`)}`,
    f.foreground || f.midground || f.background
      ? `DEPTH LAYERS: ${j(f.foreground && `foreground: ${f.foreground}`, f.midground && `midground: ${f.midground}`, f.background && `background: ${f.background}`)}`
      : "",
    present.length
      ? `CHARACTER DETAIL (canonical — keep identity, gender, age and clothing exactly; each character visually distinct): ${present.map(describeCharacter).join(" | ")}${f.expressions ? `. Expressions: ${f.expressions}` : ""}${f.bodyLanguage ? `. Body language: ${f.bodyLanguage}` : ""}`
      : "",
    `CINEMATOGRAPHY: ${f.cameraShot}${f.cameraDirection ? `, ${f.cameraDirection}` : ""}; composed for a ${aspect} frame with a clear focal point and visual hierarchy.`,
    `LIGHTING: ${f.lighting || loc?.lighting || "motivated by the scene's light sources"}; consistent shadow direction and color temperature.`,
    f.materials ? `MATERIALS & TEXTURES: ${f.materials}` : "",
    `MOOD & ATMOSPHERE: ${f.mood || "as the scene implies"}${loc?.palette ? `; palette: ${loc.palette}` : ""}. Story context: ${f.description}`,
    continuity ? `CONTINUITY: ${continuity}${f.continuityNotes ? ` ${f.continuityNotes}` : ""}` : f.continuityNotes ? `CONTINUITY: ${f.continuityNotes}` : "",
    `STYLE: ${style}`,
    `TECHNICAL QUALITY: ${QUALITY_TECH[quality]}`,
    "STRICT: follow the screenplay exactly — do not add people, change the location, time of day, clothing or props. No text, captions, subtitles, watermarks or logos.",
  ];
  return parts.filter(Boolean).join("\n");
}

/** Small stable hash for cache validation. */
export function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
