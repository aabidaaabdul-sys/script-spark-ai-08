import { createFileRoute } from "@tanstack/react-router";
import { ScriptForgeWorkspace } from "@/components/ScriptForgeWorkspace";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ScriptForge AI — Cinematic Script Conversion & Narration" },
      {
        name: "description",
        content:
          "Convert rough Hindi, Hinglish, or broken English scripts into cinematic English screenplays with emotion-aware AI voice narration.",
      },
      { property: "og:title", content: "ScriptForge AI" },
      {
        property: "og:description",
        content:
          "Cinematic script conversion + AI voice narration powered by ElevenLabs.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <>
      <div className="relative min-h-screen bg-spotlight">
        <ScriptForgeWorkspace />
      </div>
      <Toaster theme="dark" position="top-center" />
    </>
  );
}
