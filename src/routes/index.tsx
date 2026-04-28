import { createFileRoute } from "@tanstack/react-router";
import { ScriptForgeWorkspace } from "@/components/ScriptForgeWorkspace";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title:
          "ScriptForge AI — Rough Hinglish to Professional English Scripts",
      },
      {
        name: "description",
        content:
          "Paste rough Hinglish or broken English. Get polished, professional, YouTube-ready English scripts instantly. No login required.",
      },
      { property: "og:title", content: "ScriptForge AI" },
      {
        property: "og:description",
        content:
          "Convert rough Hinglish into world-class English scripts in seconds.",
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
