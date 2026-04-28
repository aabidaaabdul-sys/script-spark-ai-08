import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Clapperboard, LogOut } from "lucide-react";

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setSubmitting(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo:
              typeof window !== "undefined" ? window.location.origin : undefined,
          },
        });
        if (error) throw error;
        toast.success("Check your email to confirm your account.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo:
          typeof window !== "undefined" ? window.location.origin : undefined,
      },
    });
    if (error) toast.error(error.message);
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="relative min-h-screen bg-spotlight flex items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card/80 p-6 shadow-lg backdrop-blur">
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Clapperboard className="h-5 w-5 text-primary" />
            </div>
            <h1 className="mt-3 text-lg font-semibold">ScriptForge AI</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {mode === "signin"
                ? "Sign in to forge cinematic scripts."
                : "Create an account to get started."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={
                  mode === "signin" ? "current-password" : "new-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <div className="my-4 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
          </div>

          <Button variant="outline" className="w-full" onClick={handleGoogle}>
            Continue with Google
          </Button>

          <button
            type="button"
            className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin"
              ? "No account? Sign up"
              : "Have an account? Sign in"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {children}
      <div className="fixed bottom-3 right-3 z-50 flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1.5 text-xs shadow backdrop-blur">
        <span className="text-muted-foreground">{session.user.email}</span>
        <button
          onClick={() => supabase.auth.signOut()}
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          title="Sign out"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    </>
  );
}
