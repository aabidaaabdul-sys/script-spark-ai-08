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

export function buildVisualPrompt(args: {
  frame: StoryFrame;
  chars: CharacterEntry[];
  loc?: LocationEntry;
  style: string;
  aspect: string;
  continuity: string;
}) {
  const { frame: f, chars, loc, style, aspect, continuity } = args;
  const present = chars.filter((c) => f.characters.includes(c.id));
  const parts = [
    `SUBJECT & ACTION: ${f.keyMoment || f.action}`,
    present.length
      ? `CHARACTERS (keep exactly as described, do not change gender, age or clothing): ${present.map(describeCharacter).join(" | ")}`
      : "CHARACTERS: none visible",
    `LOCATION: ${f.intExt ? f.intExt + ". " : ""}${loc ? `${loc.name} — ${loc.architecture}; ${loc.environment}` : f.heading}`,
    `TIME: ${f.timeOfDay || "unspecified"}${f.weather ? `; WEATHER: ${f.weather}` : ""}`,
    `LIGHTING: ${f.lighting || loc?.lighting || "motivated by the scene"}`,
    `IMPORTANT OBJECTS: ${[f.objects, loc?.objects].filter(Boolean).join(", ") || "none"}`,
    `MOOD: ${f.mood}`,
    `CAMERA: ${f.cameraShot}${f.cameraDirection ? `, ${f.cameraDirection}` : ""}; composition for ${aspect} frame`,
    loc?.palette ? `COLOR/TONE: ${loc.palette}` : "",
    `STORY CONTEXT: ${f.description}`,
    continuity ? `CONTINUITY: ${continuity}` : "",
    `STYLE: ${style}`,
    "No text, captions, subtitles, watermarks or logos in the image.",
  ];
  return parts.filter(Boolean).join("\n");
}
