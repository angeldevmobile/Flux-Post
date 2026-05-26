import { useState } from "react";
import { Mail, Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import { FluxLogoBadge } from "@/components/FluxLogo";
import { supabase } from "@/lib/supabase";
import { useUserStore } from "@/stores/user";
import { saveSession, startOAuthCallback } from "@/lib/tauri";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";

function GithubIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

interface SignUpProps {
  onSignUp: () => void;
  onGoLogin: () => void;
}

function PasswordStrength({ password }: { password: string }) {
  const strength = password.length === 0 ? 0
    : password.length < 6 ? 1
    : password.length < 10 ? 2
    : /[A-Z]/.test(password) && /[0-9]/.test(password) ? 4 : 3;

  const colors = ["#27272A", "#EF4444", "#EAB308", "#3B82F6", "#22C55E"];
  const labels = ["", "Too short", "Weak", "Good", "Strong"];

  return (
    <div className="flex flex-col gap-1 mt-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="flex-1 h-1 rounded-full transition-colors"
            style={{ background: i <= strength ? colors[strength] : "#27272A" }} />
        ))}
      </div>
      {password.length > 0 && (
        <span className="text-[11px]" style={{ color: colors[strength] }}>{labels[strength]}</span>
      )}
    </div>
  );
}

export function SignUp({ onSignUp, onGoLogin }: SignUpProps) {
  const [showPass, setShowPass] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const setSession = useUserStore(s => s.setSession);

  async function persistSession(session: import("@supabase/supabase-js").Session) {
    setSession(session);
    await saveSession({
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_at,
      userId: session.user.id,
      userEmail: session.user.email,
      userName: session.user.user_metadata?.full_name ?? session.user.user_metadata?.name,
      userAvatar: session.user.user_metadata?.avatar_url,
    });
  }

  async function handleSignUp() {
    if (!email || !password) { setError("Complete todos los campos."); return; }
    if (password.length < 6) { setError("La contraseña debe tener al menos 6 caracteres."); return; }
    setError(null);
    setLoading(true);
    try {
      const displayName = [firstName, lastName].filter(Boolean).join(" ") || undefined;
      const { data, error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: displayName } },
      });
      if (err) { setError(err.message); return; }
      if (data.session) {
        await persistSession(data.session);
        onSignUp();
      } else {
        setSuccess(true);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleGitHub() {
    setError(null);
    setGithubLoading(true);
    try {
      await startOAuthCallback();
      const { data, error: err } = await supabase.auth.signInWithOAuth({
        provider: "github",
        options: {
          redirectTo: "http://127.0.0.1:42813",
          skipBrowserRedirect: true,
          scopes: "user:email",
        },
      });
      if (err || !data.url) { setError(err?.message ?? "Error al iniciar OAuth"); setGithubLoading(false); return; }
      await openUrl(data.url);
      const unlisten = await listen<string>("supabase-oauth-code", async (event) => {
        unlisten();
        const { data: d, error: e } = await supabase.auth.exchangeCodeForSession(event.payload);
        if (e || !d.session) { setError(e?.message ?? "Error al obtener sesión"); setGithubLoading(false); return; }
        await persistSession(d.session);
        setGithubLoading(false);
        onSignUp();
      });
      await listen<string>("supabase-oauth-error", (event) => {
        setError(event.payload);
        setGithubLoading(false);
      });
    } catch (e) {
      setError(String(e));
      setGithubLoading(false);
    }
  }

  if (success) {
    return (
      <div className="relative flex items-center justify-center w-full h-full bg-[#0A0A0A]">
        <div className="flex flex-col items-center gap-4 text-center max-w-[320px]">
          <FluxLogoBadge size={48} />
          <h2 className="text-[18px] font-semibold text-white">Check your email</h2>
          <p className="text-[13px] text-[#71717A]">
            We sent a confirmation link to <span className="text-white">{email}</span>.
            Click it to activate your account.
          </p>
          <button onClick={onGoLogin} className="text-[13px] text-[#A855F7] hover:opacity-80">
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex items-center justify-center w-full h-full bg-[#0A0A0A] overflow-hidden">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="w-[600px] h-[600px] rounded-full"
          style={{ background: "radial-gradient(circle, #A855F715 0%, transparent 70%)" }} />
      </div>

      <div className="relative z-10 flex flex-col items-center w-full max-w-[360px] px-4">
        <div className="flex flex-col items-center gap-2 mb-8">
          <FluxLogoBadge size={52} />
          <h1 className="text-[22px] font-semibold text-white" style={{ fontFamily: "Geist, Inter, sans-serif", letterSpacing: "-0.3px" }}>Flux</h1>
          <p className="text-[13px] text-[#71717A]">Create your free account</p>
        </div>

        <div className="w-full rounded-xl p-6 flex flex-col gap-4"
          style={{ background: "#111111", border: "1px solid #27272A" }}>

          {error && (
            <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: "#EF444415", border: "1px solid #EF444430", color: "#FCA5A5" }}>
              {error}
            </div>
          )}

          <button onClick={handleGitHub} disabled={githubLoading}
            className="w-full h-9 flex items-center justify-center gap-2 rounded-lg text-[13px] font-medium text-white transition-colors hover:bg-[#27272A] disabled:opacity-50"
            style={{ background: "#1A1A1A", border: "1px solid #27272A" }}>
            {githubLoading ? <Loader2 size={14} className="animate-spin" /> : <GithubIcon />}
            {githubLoading ? "Waiting for browser..." : "Sign up with GitHub"}
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-[#27272A]" />
            <span className="text-[11px] text-[#71717A]">or</span>
            <div className="flex-1 h-px bg-[#27272A]" />
          </div>

          <div className="flex gap-3">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[12px] text-[#A1A1AA]">First name</label>
              <input value={firstName} onChange={e => setFirstName(e.target.value)}
                placeholder="Alex"
                className="w-full h-9 px-3 rounded-lg text-[13px] text-white outline-none"
                style={{ background: "#1A1A1A", border: "1px solid #27272A" }} />
            </div>
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[12px] text-[#A1A1AA]">Last name</label>
              <input value={lastName} onChange={e => setLastName(e.target.value)}
                placeholder="Johnson"
                className="w-full h-9 px-3 rounded-lg text-[13px] text-white outline-none"
                style={{ background: "#1A1A1A", border: "1px solid #27272A" }} />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[12px] text-[#A1A1AA]">Email</label>
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#71717A]" />
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full h-9 pl-9 pr-3 rounded-lg text-[13px] text-white outline-none"
                style={{ background: "#1A1A1A", border: "1px solid #27272A" }} />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[12px] text-[#A1A1AA]">Password</label>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#71717A]" />
              <input type={showPass ? "text" : "password"} value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min. 6 characters"
                className="w-full h-9 pl-9 pr-9 rounded-lg text-[13px] text-white outline-none"
                style={{ background: "#1A1A1A", border: "1px solid #27272A" }} />
              <button onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#71717A] hover:text-[#A1A1AA]">
                {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <PasswordStrength password={password} />
          </div>

          <button onClick={handleSignUp} disabled={loading}
            className="w-full h-9 rounded-lg text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 mt-1"
            style={{ background: "#A855F7" }}>
            {loading ? <><Loader2 size={13} className="animate-spin" /> Creating account...</> : "Create free account"}
          </button>
        </div>

        <p className="mt-5 text-[12px] text-[#71717A]">
          Already have an account?{" "}
          <button onClick={onGoLogin} className="text-[#A855F7] hover:opacity-80">Sign in</button>
        </p>

        <div className="mt-6 flex gap-4">
          <button className="text-[11px] text-[#3F3F46] hover:text-[#71717A]">Terms of Service</button>
          <button className="text-[11px] text-[#3F3F46] hover:text-[#71717A]">Privacy Policy</button>
        </div>
      </div>
    </div>
  );
}
