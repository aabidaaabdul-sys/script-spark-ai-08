import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { synthesizeNarration } from "@/lib/scriptforge.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  EMOTION_COLORS,
  EMOTION_VOICE_PRESETS,
  parseScenes,
  type Scene,
  type Emotion,
} from "@/lib/scriptforge.shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
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
  StopCircle,
  Square,
  Pencil,
  Check,
  X,
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

function wordCount(t: string) {
  const trimmed = t.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

type Stage =
  | { kind: "idle" }
  | { kind: "thinking" }
  | { kind: "streaming"; receivedChars: number }
  | { kind: "done" }
  | { kind: "error"; message: string };

export function ScriptForgeWorkspace() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [mode, setMode] = useState<"cinematic" | "strict">("cinematic");
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef<number>(0);
  const [elapsed, setElapsed] = useState(0);

  const [voiceId, setVoiceId] = useState(VOICES[0].id);
  const [autoEmotion, setAutoEmotion] = useState(true);
  const [synthesizingId, setSynthesizingId] = useState<string | null>(null);
  const [sceneAudio, setSceneAudio] = useState<Record<string, string>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingSceneId, setPlayingSceneId] = useState<string | null>(null);
  const playQueueRef = useRef<string[]>([]);

  // Auto-save draft (client only)
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setInput(stored);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem(STORAGE_KEY, input), 400);
    return () => clearTimeout(t);
  }, [input]);

  // Elapsed timer while streaming
  useEffect(() => {
    if (stage.kind !== "thinking" && stage.kind !== "streaming") return;
    const id = setInterval(() => {
      setElapsed((Date.now() - startedAtRef.current) / 1000);
    }, 100);
    return () => clearInterval(id);
  }, [stage.kind]);

  const ttsFn = useServerFn(synthesizeNarration);
  const inWords = useMemo(() => wordCount(input), [input]);
  const outWords = useMemo(() => wordCount(output), [output]);
  const scenes = useMemo<Scene[]>(() => parseScenes(output), [output]);

  const handleConvert = useCallback(async () => {
    if (!input.trim()) {
      toast.error("Paste or type a script first.");
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setOutput("");
    setSceneAudio({});
    startedAtRef.current = Date.now();
    setElapsed(0);
    setStage({ kind: "thinking" });

    try {
      const res = await fetch("/api/convert", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: input, mode }),
      });
      if (!res.ok || !res.body) {
        let msg = "Conversion failed.";
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {}
        setStage({ kind: "error", message: msg });
        toast.error(msg);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta?.content as
              | string
              | undefined;
            if (delta) {
              acc += delta;
              setOutput(acc);
              setStage({ kind: "streaming", receivedChars: acc.length });
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      setStage({ kind: "done" });
      toast.success(
        `Forged in ${((Date.now() - startedAtRef.current) / 1000).toFixed(1)}s`,
      );
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AbortError") {
        setStage({ kind: "idle" });
        return;
      }
      console.error(err);
      const msg = "Conversion error. Please retry.";
      setStage({ kind: "error", message: msg });
      toast.error(msg);
    }
  }, [input, mode]);

  const cancelConvert = useCallback(() => {
    abortRef.current?.abort();
    setStage({ kind: "idle" });
  }, []);

  const saveDraft = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, input);
    toast.success("Draft saved.");
  }, [input]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key === "Enter") {
        e.preventDefault();
        handleConvert();
      } else if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveDraft();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleConvert, saveDraft]);

  async function narrateScene(scene: Scene, overrideEmotion?: Emotion) {
    if (!scene.body.trim()) return null;
    setSynthesizingId(scene.id);
    try {
      const preset =
        EMOTION_VOICE_PRESETS[
          autoEmotion ? scene.emotion : overrideEmotion ?? "informational"
        ];
      const res = await ttsFn({
        data: {
          text: scene.body.slice(0, 4800),
          voiceId,
          stability: preset.stability,
          similarity: 0.75,
          style: preset.style,
          speed: preset.speed,
        },
      });
      if (!res.ok) {
        toast.error(res.error);
        return null;
      }
      const url = `data:audio/mpeg;base64,${res.audioBase64}`;
      setSceneAudio((s) => ({ ...s, [scene.id]: url }));
      return url;
    } catch (e) {
      console.error(e);
      toast.error("Voice synthesis failed.");
      return null;
    } finally {
      setSynthesizingId(null);
    }
  }

  async function playScene(scene: Scene) {
    let url = sceneAudio[scene.id];
    if (!url) url = (await narrateScene(scene)) ?? "";
    if (!url) return;
    const a = audioRef.current;
    if (!a) return;
    a.src = url;
    setPlayingSceneId(scene.id);
    a.play().catch(() => {});
  }

  async function playAll() {
    if (scenes.length === 0) return;
    playQueueRef.current = scenes.map((s) => s.id);
    // Pre-generate any missing audio in parallel (limit 3)
    const missing = scenes.filter((s) => !sceneAudio[s.id]);
    if (missing.length) {
      toast.info(`Generating narration for ${missing.length} scene(s)…`);
      for (let i = 0; i < missing.length; i += 3) {
        await Promise.all(missing.slice(i, i + 3).map((s) => narrateScene(s)));
      }
    }
    const first = scenes[0];
    await playScene(first);
  }

  function onAudioEnded() {
    const queue = playQueueRef.current;
    if (queue.length === 0) {
      setPlayingSceneId(null);
      return;
    }
    const currentIdx = queue.indexOf(playingSceneId ?? "");
    const next = scenes[currentIdx + 1];
    if (!next) {
      setPlayingSceneId(null);
      playQueueRef.current = [];
      return;
    }
    playScene(next);
  }

  function stopPlayback() {
    audioRef.current?.pause();
    setPlayingSceneId(null);
    playQueueRef.current = [];
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

  function updateSceneText(sceneId: string, newBody: string) {
    // Splice the edited body back into the full output
    const idx = scenes.findIndex((s) => s.id === sceneId);
    if (idx === -1) return;
    const before = scenes
      .slice(0, idx)
      .map((s) => s.body)
      .join("\n\n");
    const after = scenes
      .slice(idx + 1)
      .map((s) => s.body)
      .join("\n\n");
    const next = [before, newBody.trim(), after].filter(Boolean).join("\n\n");
    setOutput(next);
    setSceneAudio((s) => {
      const { [sceneId]: _, ...rest } = s;
      return rest;
    });
  }

  const isBusy = stage.kind === "thinking" || stage.kind === "streaming";
  const progressPct =
    stage.kind === "streaming"
      ? Math.min(95, Math.round((stage.receivedChars / Math.max(input.length * 1.4, 400)) * 100))
      : stage.kind === "thinking"
        ? 8
        : stage.kind === "done"
          ? 100
          : 0;

  return (
    <div className="relative z-10 mx-auto flex min-h-screen max-w-[1500px] flex-col px-6 pb-40 pt-8">
      <Header
        mode={mode}
        setMode={setMode}
        isBusy={isBusy}
        onConvert={handleConvert}
        onCancel={cancelConvert}
        canConvert={!!input.trim()}
      />

      {(isBusy || stage.kind === "done") && (
        <div className="mt-5 flex items-center gap-4 rounded-lg border border-border bg-card/60 px-4 py-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10">
            {isBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            ) : (
              <Check className="h-3.5 w-3.5 text-primary" />
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">
                {stage.kind === "thinking"
                  ? "Extracting meaning…"
                  : stage.kind === "streaming"
                    ? "Forging cinematic screenplay…"
                    : "Complete"}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {elapsed.toFixed(1)}s · {scenes.length} scene
                {scenes.length === 1 ? "" : "s"}
              </span>
            </div>
            <Progress value={progressPct} className="mt-1.5 h-1" />
          </div>
        </div>
      )}

      <section className="mt-5 grid flex-1 gap-5 lg:grid-cols-2">
        <Panel
          title="Original"
          subtitle="Hindi · Hinglish · Broken English — paste anything"
          words={inWords}
          actions={
            input ? (
              <Button size="sm" variant="ghost" onClick={() => setInput("")}>
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
              ? `${scenes.length || "—"} scenes · auto emotion-tagged`
              : "Cleaned grammar, structure preserved"
          }
          words={outWords}
          accent
          actions={
            output ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => downloadText("scriptforge-screenplay.txt", output)}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" /> .txt
              </Button>
            ) : null
          }
        >
          {output ? (
            mode === "cinematic" && scenes.length > 0 ? (
              <div className="h-[58vh] space-y-3 overflow-auto pr-1">
                {scenes.map((scene) => (
                  <SceneCard
                    key={scene.id}
                    scene={scene}
                    isPlaying={playingSceneId === scene.id}
                    isSynth={synthesizingId === scene.id}
                    hasAudio={!!sceneAudio[scene.id]}
                    onPlay={() => playScene(scene)}
                    onSave={(body) => updateSceneText(scene.id, body)}
                  />
                ))}
                {isBusy && (
                  <div className="px-1 py-2 text-xs text-muted-foreground">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />{" "}
                    streaming…
                  </div>
                )}
              </div>
            ) : (
              <pre className="h-[58vh] overflow-auto whitespace-pre-wrap font-mono text-[13.5px] leading-relaxed">
                {output}
                {isBusy && <span className="animate-pulse">▍</span>}
              </pre>
            )
          ) : (
            <div className="flex h-[58vh] items-center justify-center text-center">
              <div className="max-w-xs space-y-2">
                <Clapperboard className="mx-auto h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  Your cinematic screenplay will appear here, scene by scene.
                </p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                  ⌘/Ctrl+Enter to convert · ⌘/Ctrl+S to save
                </p>
              </div>
            </div>
          )}
        </Panel>
      </section>

      <NarrationDock
        voiceId={voiceId}
        setVoiceId={setVoiceId}
        autoEmotion={autoEmotion}
        setAutoEmotion={setAutoEmotion}
        scenes={scenes}
        playingSceneId={playingSceneId}
        onPlayAll={playAll}
        onStop={stopPlayback}
      />

      <audio
        ref={audioRef}
        onEnded={onAudioEnded}
        onPause={() => {
          // Only clear when stopped externally, not during scene transitions
        }}
        hidden
      />
    </div>
  );
}

/* -------- Header -------- */

function Header({
  mode,
  setMode,
  isBusy,
  onConvert,
  onCancel,
  canConvert,
}: {
  mode: "cinematic" | "strict";
  setMode: (m: "cinematic" | "strict") => void;
  isBusy: boolean;
  onConvert: () => void;
  onCancel: () => void;
  canConvert: boolean;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-gradient-primary shadow-glow">
          <Clapperboard className="h-5 w-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            ScriptForge <span className="text-gradient-primary">AI</span>
          </h1>
          <p className="text-xs text-muted-foreground">
            Streaming pipeline · Scene intelligence · Emotion-aware narration
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
        {isBusy ? (
          <Button onClick={onCancel} size="lg" variant="secondary">
            <StopCircle className="mr-2 h-4 w-4" /> Stop
          </Button>
        ) : (
          <Button
            onClick={onConvert}
            disabled={!canConvert}
            size="lg"
            className="bg-gradient-primary text-primary-foreground shadow-glow hover:opacity-95"
          >
            <Sparkles className="mr-2 h-4 w-4" /> Convert
          </Button>
        )}
      </div>
    </header>
  );
}

/* -------- Scene Card -------- */

function SceneCard({
  scene,
  isPlaying,
  isSynth,
  hasAudio,
  onPlay,
  onSave,
}: {
  scene: Scene;
  isPlaying: boolean;
  isSynth: boolean;
  hasAudio: boolean;
  onPlay: () => void;
  onSave: (body: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(scene.body);

  useEffect(() => {
    if (!editing) setDraft(scene.body);
  }, [scene.body, editing]);

  const tagColor = EMOTION_COLORS[scene.emotion];

  return (
    <div
      className={`group rounded-lg border bg-background/50 transition-colors ${
        isPlaying ? "border-primary shadow-glow" : "border-border/60"
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-flex h-5 items-center rounded px-1.5 text-[10px] font-semibold uppercase tracking-wider"
            style={{
              color: tagColor,
              backgroundColor: `color-mix(in oklab, ${tagColor} 15%, transparent)`,
            }}
            title={`Detected emotion: ${scene.emotion}`}
          >
            {scene.emotion}
          </span>
          <span className="truncate font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            {scene.heading}
          </span>
        </div>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {scene.wordCount}w
          </span>
          {!editing ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              onClick={() => setEditing(true)}
              aria-label="Edit scene"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={() => {
                  onSave(draft);
                  setEditing(false);
                }}
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={() => {
                  setDraft(scene.body);
                  setEditing(false);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={onPlay}
            disabled={isSynth}
            aria-label="Play narration"
          >
            {isSynth ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isPlaying ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
      <div className="px-3 pb-3">
        {editing ? (
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-[120px] resize-y border-border/60 bg-input font-mono text-[13px] leading-relaxed"
          />
        ) : (
          <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed">
            {scene.body}
          </pre>
        )}
        {hasAudio && (
          <div className="mt-2 text-[10px] uppercase tracking-wider text-primary/70">
            ● narration ready
          </div>
        )}
      </div>
    </div>
  );
}

/* -------- Narration Dock -------- */

function NarrationDock({
  voiceId,
  setVoiceId,
  autoEmotion,
  setAutoEmotion,
  scenes,
  playingSceneId,
  onPlayAll,
  onStop,
}: {
  voiceId: string;
  setVoiceId: (v: string) => void;
  autoEmotion: boolean;
  setAutoEmotion: (b: boolean) => void;
  scenes: Scene[];
  playingSceneId: string | null;
  onPlayAll: () => void;
  onStop: () => void;
}) {
  const isPlaying = !!playingSceneId;
  const totalWords = scenes.reduce((sum, s) => sum + s.wordCount, 0);

  return (
    <section className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto grid max-w-[1500px] grid-cols-1 items-end gap-4 px-6 py-4 lg:grid-cols-[1fr_auto]">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
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
          <Field label="Auto emotion mapping">
            <Tabs
              value={autoEmotion ? "on" : "off"}
              onValueChange={(v) => setAutoEmotion(v === "on")}
            >
              <TabsList className="w-full bg-input">
                <TabsTrigger value="on" className="flex-1">
                  Auto
                </TabsTrigger>
                <TabsTrigger value="off" className="flex-1">
                  Neutral
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </Field>
          <Field label="Status">
            <div className="flex h-9 items-center rounded-md border border-border bg-input px-3 text-xs text-muted-foreground">
              {scenes.length} scene{scenes.length === 1 ? "" : "s"} · {totalWords} words
            </div>
          </Field>
        </div>
        <div className="flex items-center gap-2">
          {isPlaying && (
            <Button onClick={onStop} variant="secondary" size="lg">
              <Square className="mr-2 h-4 w-4" /> Stop
            </Button>
          )}
          <Button
            onClick={onPlayAll}
            disabled={scenes.length === 0 || isPlaying}
            size="lg"
            className="bg-gradient-primary text-primary-foreground shadow-glow hover:opacity-95"
          >
            <Volume2 className="mr-2 h-4 w-4" />
            {isPlaying ? "Narrating…" : "Narrate All Scenes"}
          </Button>
        </div>
      </div>
    </section>
  );
}

/* -------- Generic Panel & Field -------- */

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
