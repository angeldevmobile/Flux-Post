import { useState } from "react";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import { FluxLogoBadge } from "@/components/FluxLogo";

function GithubIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

interface LoginProps {
  onLogin: () => void;
  onGoSignUp: () => void;
}

export function Login({ onLogin, onGoSignUp }: LoginProps) {
  const [showPass, setShowPass] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className="relative flex items-center justify-center w-full h-full bg-[#0A0A0A] overflow-hidden">
      {/* Radial glow */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="w-[600px] h-[600px] rounded-full"
          style={{ background: "radial-gradient(circle, #A855F715 0%, transparent 70%)" }} />
      </div>

      <div className="relative z-10 flex flex-col items-center w-full max-w-[360px] px-4">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2 mb-8">
          <FluxLogoBadge size={52} />
          <h1 className="text-[22px] font-semibold text-white" style={{ fontFamily: "Geist, Inter, sans-serif", letterSpacing: "-0.3px" }}>Flux</h1>
          <p className="text-[13px] text-[#71717A]">The modern API client for developers.</p>
        </div>

        {/* Card */}
        <div className="w-full rounded-xl p-6 flex flex-col gap-4"
          style={{ background: "#111111", border: "1px solid #27272A" }}>
          <h2 className="text-[15px] font-semibold text-white text-center">Sign in to your account</h2>

          {/* GitHub */}
          <button onClick={onLogin}
            className="w-full h-9 flex items-center justify-center gap-2 rounded-lg text-[13px] font-medium text-white transition-colors hover:bg-[#27272A]"
            style={{ background: "#1A1A1A", border: "1px solid #27272A" }}>
            <GithubIcon />
            Continue with GitHub
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-[#27272A]" />
            <span className="text-[11px] text-[#71717A]">or</span>
            <div className="flex-1 h-px bg-[#27272A]" />
          </div>

          {/* Email */}
          <div className="flex flex-col gap-1">
            <label className="text-[12px] text-[#A1A1AA]">Email</label>
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#71717A]" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full h-9 pl-9 pr-3 rounded-lg text-[13px]"
                style={{ background: "#1A1A1A", border: "1px solid #27272A" }}
              />
            </div>
          </div>

          {/* Password */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-[12px] text-[#A1A1AA]">Password</label>
              <button className="text-[11px] text-[#A855F7] hover:opacity-80">Forgot password?</button>
            </div>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#71717A]" />
              <input
                type={showPass ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full h-9 pl-9 pr-9 rounded-lg text-[13px]"
                style={{ background: "#1A1A1A", border: "1px solid #27272A" }}
              />
              <button
                onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#71717A] hover:text-[#A1A1AA]">
                {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <button
            onClick={onLogin}
            className="w-full h-9 rounded-lg text-[13px] font-semibold text-white transition-opacity hover:opacity-90 mt-1"
            style={{ background: "#A855F7" }}>
            Sign in →
          </button>
        </div>

        <p className="mt-5 text-[12px] text-[#71717A]">
          Don't have an account?{" "}
          <button onClick={onGoSignUp} className="text-[#A855F7] hover:opacity-80">Sign up Free</button>
        </p>

        <div className="mt-6 flex gap-4">
          <button className="text-[11px] text-[#3F3F46] hover:text-[#71717A]">Terms of Service</button>
          <button className="text-[11px] text-[#3F3F46] hover:text-[#71717A]">Privacy Policy</button>
        </div>
      </div>
    </div>
  );
}
