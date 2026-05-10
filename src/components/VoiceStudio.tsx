import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Mic2,
  Play,
  Pause,
  Square,
  Download,
  Loader2,
  Wand2,
  Volume2,
} from "lucide-react";

/* --------------------------- voice catalog --------------------------- */

type VoicePreset = {
  id: string;
  voiceId: string;
  label: string;
  desc: string;
  vibe: "standard" | "horror" | "trailer" | "documentary" | "drama";
};

const NARRATOR_PRESETS: VoicePreset[] = [
  {
    id: "deep-cinematic",
    voiceId: "JBFqnCBsd6RMkjVDRZzb", // George
    label: "Deep Cinematic Narrator",
    desc: "Rich, authoritative, film-trailer presence",
    vibe: "trailer",
  },
  {
    id: "documentary",
    voiceId: "nPczCjzI2devNBz1zQrb", // Brian
    label: "Documentary Narrator",
    desc: "Calm, professional, observational",
    vibe: "documentary",
  },
  {
    id: "emotional",
    voiceId: "TX3LPaxmHKxFdv7VOQHJ", // Liam
    label: "Emotional Storyteller",
    desc: "Warm, intimate, character-driven",
    vibe: "drama",
  },
  {
    id: "horror-whisper",
    voiceId: "onwK4e9ZLuTAKqWW03F9", // Daniel
    label: "Horror Whisper Voice",
    desc: "Dark, breathy, unsettling pacing",
    vibe: "horror",
  },
  {
    id: "trailer",
    voiceId: "bIHbv24MWmeRgasZH58o", // Will
    label: "Trailer Voice",
    desc: "Punchy, intense, hard cuts",
    vibe: "trailer",
  },
  {
    id: "podcast",
    voiceId: "cjVigY5qzO86Huf0OWal", // Eric
    label: "Calm Podcast Voice",
    desc: "Conversational, relaxed, clear",
    vibe: "standard",
  },
  {
    id: "motivational",
    voiceId: "iP95p4xoKVk53GoZ742B", // Chris
    label: "Motivational Speaker",
    desc: "Energetic, uplifting, confident",
    vibe: "standard",
  },
  {
    id: "news",
    voiceId: "CwhRBWXzGAHq8TQ4Fs17", // Roger
    label: "News Reporter",
    desc: "Crisp, neutral, informative",
    vibe: "documentary",
  },
  {
    id: "futuristic",
    voiceId: "kPtEHAvRnjUJFv7SK9WI", // Glitch
    label: "AI Futuristic Voice",
    desc: "Synthetic edge, cyber tone",
    vibe: "trailer",
  },
];

const MALE_CHARACTER_VOICES = [
  { voiceId: "TX3LPaxmHKxFdv7VOQHJ", label: "Liam — young male" },
  { voiceId: "IKne3meq5aSn9XLyUdCD", label: "Charlie — natural male" },
  { voiceId: "N2lVS1w4EtoT3dr4eOWO", label: "Callum — gritty male" },
  { voiceId: "iP95p4xoKVk53GoZ742B", label: "Chris — confident male" },
  { voiceId: "onwK4e9ZLuTAKqWW03F9", label: "Daniel — deep male" },
  { voiceId: "cjVigY5qzO86Huf0OWal", label: "Eric — calm male" },
  { voiceId: "bIHbv24MWmeRgasZH58o", label: "Will — intense male" },
  { voiceId: "pqHfZKP75CvOlQylNhV4", label: "Bill — older male" },
];
const FEMALE_CHARACTER_VOICES = [
  { voiceId: "EXAVITQu4vr4xnSDxMaL", label: "Sarah — young female" },
  { voiceId: "FGY2WhTYpPnrIDTdsKH5", label: "Laura — warm female" },
  { voiceId: "Xb7hH8MSUJpSbSDYk0k2", label: "Alice — natural female" },
  { voiceId: "XrExE9yKIg1WjnnlVkGX", label: "Matilda — soft female" },
  { voiceId: "cgSgspJ2msm6clMCkdW9", label: "Jessica — bright female" },
  { voiceId: "pFZP5JQG7iQjIQuC4Bku", label: "Lily — gentle female" },
];

const ALL_CHARACTER_VOICES = [...MALE_CHARACTER_VOICES, ...FEMALE_CHARACTER_VOICES];

/* --------------------------- character extraction --------------------------- */

function extractCharacters(script: string): string[] {
  if (!script) return [];
  const lines = script.replace(/\r\n/g, "\n").split("\n");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (!l || l.length > 40) continue;
    if (/^(INT\.|EXT\.|FADE|CUT TO|DISSOLVE)/i.test(l)) continue;
    const stripped = l.replace(/\(.*?\)\s*$/, "").trim();
    if (!stripped) continue;
    const letters = stripped.replace(/[^A-Za-z]/g, "");
    if (letters.length < 2) continue;
    if (letters !== letters.toUpperCase()) continue;
    const key = stripped.toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
    if (out.length >= 12) break;
  }
  return out;
}

/* --------------------------- component --------------------------- */

export function VoiceStudio({
  englishScript,
  meaningScript,
  meaningLang,
}: {
  englishScript: string;
  meaningScript: string;
  meaningLang: string;
}) {
  const [source, setSource] = useState<"english" | "meaning">("english");
  const [presetId, setPresetId] = useState<string>("deep-cinematic");
  const [speed, setSpeed] = useState(1.0);
  const [stability, setStability] = useState(0.45);
  const [style, setStyle] = useState(0.4);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const preset = useMemo(
    () => NARRATOR_PRESETS.find((p) => p.id === presetId) ?? NARRATOR_PRESETS[0],
    [presetId],
  );

  const activeScript = source === "english" ? englishScript : meaningScript;
  const characters = useMemo(() => extractCharacters(activeScript), [activeScript]);

  // Clean up object URL.
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const generate = useCallback(async () => {
    if (!activeScript.trim()) {
      toast.error("Generate or paste a script first.");
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setProgress(8);

    // Fake progressive feedback while ElevenLabs synthesizes.
    const tick = setInterval(() => {
      setProgress((p) => Math.min(92, p + 3));
    }, 600);

    try {
      const overridesPayload = Object.entries(overrides).map(([character, voiceId]) => ({
        character,
        voiceId,
      }));

      const res = await fetch("/api/voice", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: activeScript.slice(0, 12_000),
          narratorVoiceId: preset.voiceId,
          overrides: overridesPayload,
          speed,
          stability,
          similarity: 0.8,
          style,
          model: "eleven_multilingual_v2",
          vibe: preset.vibe,
        }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      if (blob.size === 0) throw new Error("Empty audio response.");
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      setProgress(100);
      toast.success("Voiceover ready.");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      console.error(e);
      toast.error((e as Error).message || "Voice generation failed.");
    } finally {
      clearInterval(tick);
      setBusy(false);
      setTimeout(() => setProgress(0), 800);
    }
  }, [activeScript, preset, speed, stability, style, overrides, audioUrl]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setBusy(false);
    setProgress(0);
  }, []);

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play();
      setPlaying(true);
    } else {
      a.pause();
      setPlaying(false);
    }
  }, []);

  const download = useCallback(() => {
    if (!audioUrl) return;
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = `voiceover-${Date.now()}.mp3`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [audioUrl]);

  return (
    <section className="mt-10 rounded-2xl border border-border/60 bg-gradient-to-br from-card via-card to-card/60 p-5 shadow-elevated">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            <Mic2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">AI Voice Studio</h2>
            <p className="text-xs text-muted-foreground">
              Cinematic narration, multi-character casting, multilingual delivery.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="rounded-full border border-border/50 px-2.5 py-1">
            {characters.length} characters
          </span>
          <span className="rounded-full border border-border/50 px-2.5 py-1">
            {activeScript.length.toLocaleString()} chars
          </span>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Left — voice + tuning */}
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Source
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                size="sm"
                variant={source === "english" ? "default" : "outline"}
                onClick={() => setSource("english")}
                disabled={!englishScript.trim()}
              >
                English Script
              </Button>
              <Button
                type="button"
                size="sm"
                variant={source === "meaning" ? "default" : "outline"}
                onClick={() => setSource("meaning")}
                disabled={!meaningScript.trim()}
              >
                {meaningLang ? `Meaning (${meaningLang})` : "Meaning Version"}
              </Button>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Narrator preset
            </label>
            <Select value={presetId} onValueChange={setPresetId}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Choose a voice" />
              </SelectTrigger>
              <SelectContent>
                {NARRATOR_PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <div className="flex flex-col">
                      <span className="font-medium">{p.label}</span>
                      <span className="text-[11px] text-muted-foreground">{p.desc}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Tuning
              label="Speed"
              value={speed}
              min={0.7}
              max={1.2}
              step={0.05}
              onChange={setSpeed}
              format={(v) => `${v.toFixed(2)}x`}
            />
            <Tuning
              label="Stability"
              value={stability}
              min={0}
              max={1}
              step={0.05}
              onChange={setStability}
              format={(v) => v.toFixed(2)}
            />
            <Tuning
              label="Emotion"
              value={style}
              min={0}
              max={1}
              step={0.05}
              onChange={setStyle}
              format={(v) => v.toFixed(2)}
            />
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {!busy ? (
              <Button onClick={generate} className="gap-2">
                <Wand2 className="h-4 w-4" />
                Generate Voiceover
              </Button>
            ) : (
              <Button onClick={cancel} variant="destructive" className="gap-2">
                <Square className="h-4 w-4" />
                Cancel
              </Button>
            )}
            {audioUrl && !busy && (
              <>
                <Button onClick={togglePlay} variant="secondary" className="gap-2">
                  {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {playing ? "Pause" : "Play"}
                </Button>
                <Button onClick={download} variant="outline" className="gap-2">
                  <Download className="h-4 w-4" />
                  MP3
                </Button>
              </>
            )}
          </div>

          {busy && (
            <div className="space-y-2 rounded-lg border border-border/50 bg-muted/30 p-3 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Synthesizing cinematic audio… {progress}%
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-gradient-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {audioUrl && (
            <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Volume2 className="h-3.5 w-3.5" /> Live preview
              </div>
              <audio
                ref={audioRef}
                src={audioUrl}
                controls
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                className="w-full"
              />
            </div>
          )}
        </div>

        {/* Right — character casting */}
        <div className="rounded-xl border border-border/50 bg-muted/20 p-4">
          <h3 className="mb-2 text-sm font-semibold">Character Cast</h3>
          <p className="mb-3 text-[11px] text-muted-foreground">
            Detected from your screenplay. Auto-cast applies if you leave any blank.
          </p>
          {characters.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
              No characters detected yet. Generate a script with dialogue cues
              (e.g. <code className="rounded bg-background px-1">RAHUL</code>) and they'll
              appear here.
            </div>
          ) : (
            <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
              {characters.map((c) => (
                <div
                  key={c}
                  className="flex flex-col gap-2 rounded-lg border border-border/40 bg-background/60 p-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="text-xs font-semibold tracking-wide">{c}</span>
                  <Select
                    value={overrides[c] ?? "auto"}
                    onValueChange={(v) =>
                      setOverrides((prev) => {
                        const next = { ...prev };
                        if (v === "auto") delete next[c];
                        else next[c] = v;
                        return next;
                      })
                    }
                  >
                    <SelectTrigger className="h-8 w-full sm:w-[220px]">
                      <SelectValue placeholder="Auto-cast" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto-cast</SelectItem>
                      {ALL_CHARACTER_VOICES.map((v) => (
                        <SelectItem key={v.voiceId} value={v.voiceId}>
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Tuning({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono text-foreground/80">{format(value)}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
      />
    </div>
  );
}
