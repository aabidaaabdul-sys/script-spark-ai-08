import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  convertScript,
  synthesizeNarration,
} from "@/lib/scriptforge.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Clapperboard,
  Loader2,
  Play,
  Pause,
  Download,
  Sparkles,
  FileText,
  Volume2,
} from "lucide-react";

const STORAGE_KEY = "scriptforge.draft.v1";

const VOICES = [
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George — Narrator (M)" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel — Deep (M)" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian — Cinematic (M)" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah — Warm (F)" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda — Soft (F)" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice — Clear (F)" },
];

const TONES = {
  calm: { stability: 0.75, style: 0.2, speed: 0.95 },
  neutral: { stability: 0.5, style: 0.4, speed: 1.0 },
  intense: { stability: 0.3, style: 0.7, speed: 1.05 },
  suspense: { stability: 0.65, style: 0.55, speed: 0.9 },
} as const;

type Tone = keyof typeof TONES;

function wordCount(t: string) {
  const trimmed = t.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function ScriptForgeWorkspace() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [mode, setMode] = useState<"cinematic" | "strict">("cinematic");
  const [converting, setConverting] = useState(false);

  const [voiceId, setVoiceId] = useState(VOICES[0].id);
  const [tone, setTone] = useState<Tone>("neutral");
  const [speed, setSpeed] = useState(1.0);
  const [synthesizing, setSynthesizing] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const convertFn = useServerFn(convertScript);
  const ttsFn = useServerFn(synthesizeNarration);

  // Auto-save draft
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setInput(stored);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem(STORAGE_KEY, input), 400);
    return () => clearTimeout(t);
  }, [input]);

  const inWords = useMemo(() => wordCount(input), [input]);
  const outWords = useMemo(() => wordCount(output), [output]);

  async function handleConvert() {
    if (!input.trim()) {
      toast.error("Paste or type a script first.");
      return;
    }
    setConverting(true);
    setOutput("");
    try {
      const res = await convertFn({ data: { script: input, mode } });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setOutput(res.output);
      toast.success("Script converted.");
    } catch (e) {
      console.error(e);
      toast.error("Something went wrong. Please retry.");
    } finally {
      setConverting(false);
    }
  }

  async function handleNarrate() {
    if (!output.trim()) {
      toast.error("Convert a script first to generate narration.");
      return;
    }
    setSynthesizing(true);
    try {
      const preset = TONES[tone];
      const res = await ttsFn({
        data: {
          text: output.slice(0, 4800),
          voiceId,
          stability: preset.stability,
          similarity: 0.75,
          style: preset.style,
          speed,
        },
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      const url = `data:audio/mpeg;base64,${res.audioBase64}`;
      setAudioUrl(url);
      toast.success("Narration ready.");
      // Auto-play
      setTimeout(() => audioRef.current?.play().catch(() => {}), 50);
    } catch (e) {
      console.error(e);
      toast.error("Voice synthesis failed.");
    } finally {
      setSynthesizing(false);
    }
  }

  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play();
    else a.pause();
  }

  function downloadText(filename: string, text: string) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="relative z-10 mx-auto flex min-h-screen max-w-[1500px] flex-col px-6 pb-32 pt-8">
      {/* Top bar */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-gradient-primary shadow-glow">
            <Clapperboard className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              ScriptForge <span className="text-gradient-primary">AI</span>
            </h1>
            <p className="text-xs text-muted-foreground">
              Rough draft → cinematic screenplay → emotion-aware narration
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <TabsList className="bg-surface-elevated">
              <TabsTrigger value="cinematic" className="gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> Cinematic
              </TabsTrigger>
              <TabsTrigger value="strict" className="gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Strict
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Button
            onClick={handleConvert}
            disabled={converting || !input.trim()}
            size="lg"
            className="bg-gradient-primary text-primary-foreground shadow-glow hover:opacity-95"
          >
            {converting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Forging…
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Convert
              </>
            )}
          </Button>
        </div>
      </header>

      {/* Split editor */}
      <section className="mt-8 grid flex-1 gap-5 lg:grid-cols-2">
        <Panel
          title="Original"
          subtitle="Hindi · Hinglish · Broken English — paste anything"
          words={inWords}
          actions={
            input ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setInput("")}
              >
                Clear
              </Button>
            ) : null
          }
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Yahaan apna rough script paste karo...\n\nE.g.\nRaat ka time hai. Aman akela bench pe baitha hai. Usko purani yaadein aati hain...`}
            className="h-[58vh] resize-none border-0 bg-transparent font-mono text-[13.5px] leading-relaxed focus-visible:ring-0"
          />
        </Panel>

        <Panel
          title="Cinematic Output"
          subtitle={
            mode === "cinematic"
              ? "Industry-standard screenplay format"
              : "Cleaned grammar, structure preserved"
          }
          words={outWords}
          accent
          actions={
            output ? (
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    downloadText("scriptforge-screenplay.txt", output)
                  }
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" /> .txt
                </Button>
              </div>
            ) : null
          }
        >
          {output ? (
            <pre className="h-[58vh] overflow-auto whitespace-pre-wrap font-mono text-[13.5px] leading-relaxed text-foreground">
              {output}
            </pre>
          ) : (
            <div className="flex h-[58vh] items-center justify-center text-center">
              <div className="max-w-xs space-y-2">
                <Clapperboard className="mx-auto h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  Your cinematic screenplay will appear here.
                </p>
              </div>
            </div>
          )}
        </Panel>
      </section>

      {/* Voice dock */}
      <section className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto grid max-w-[1500px] grid-cols-1 items-center gap-4 px-6 py-4 lg:grid-cols-[1fr_auto]">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Field label="Voice">
              <Select value={voiceId} onValueChange={setVoiceId}>
                <SelectTrigger className="bg-input">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VOICES.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Tone">
              <Select
                value={tone}
                onValueChange={(v) => setTone(v as Tone)}
              >
                <SelectTrigger className="bg-input">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="calm">Calm — emotional</SelectItem>
                  <SelectItem value="neutral">Neutral — narrator</SelectItem>
                  <SelectItem value="intense">Intense — action</SelectItem>
                  <SelectItem value="suspense">Suspense — slow & deep</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={`Speed · ${speed.toFixed(2)}x`}>
              <Slider
                value={[speed]}
                min={0.7}
                max={1.2}
                step={0.05}
                onValueChange={([v]) => setSpeed(v)}
              />
            </Field>
            <div className="flex items-end gap-2">
              {audioUrl && (
                <>
                  <Button
                    variant="secondary"
                    onClick={togglePlay}
                    className="flex-1"
                  >
                    {playing ? (
                      <Pause className="mr-2 h-4 w-4" />
                    ) : (
                      <Play className="mr-2 h-4 w-4" />
                    )}
                    {playing ? "Pause" : "Play"}
                  </Button>
                  <Button asChild variant="outline" size="icon">
                    <a
                      href={audioUrl}
                      download="scriptforge-narration.mp3"
                      aria-label="Download MP3"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                  </Button>
                </>
              )}
            </div>
          </div>

          <Button
            onClick={handleNarrate}
            disabled={synthesizing || !output.trim()}
            size="lg"
            className="bg-gradient-primary text-primary-foreground shadow-glow hover:opacity-95"
          >
            {synthesizing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Synthesizing…
              </>
            ) : (
              <>
                <Volume2 className="mr-2 h-4 w-4" />
                Generate Narration
              </>
            )}
          </Button>
        </div>

        {audioUrl && (
          <audio
            ref={audioRef}
            src={audioUrl}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            hidden
          />
        )}
      </section>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  words,
  children,
  actions,
  accent,
}: {
  title: string;
  subtitle: string;
  words: number;
  children: React.ReactNode;
  actions?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex flex-col rounded-xl border bg-card p-4 shadow-elevated ${
        accent ? "bg-spotlight" : ""
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg leading-none">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs tabular-nums text-muted-foreground">
            {words} words
          </span>
          {actions}
        </div>
      </div>
      <div className="flex-1 rounded-lg border border-border/60 bg-background/40 p-3">
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
