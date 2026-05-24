import { useState, useEffect, useRef } from "react";
import { Wifi, WifiOff, Send, Trash2 } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { wsConnect, wsSend, wsDisconnect } from "@/lib/tauri";

type Status = "disconnected" | "connecting" | "connected";

interface WsMessage {
  id: string;
  direction: "in" | "out";
  data: string;
  time: string;
}

function now(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function statusMsg(text: string): WsMessage {
  return { id: crypto.randomUUID(), direction: "in", data: text, time: now() };
}

export function WebSocketRoute() {
  const [url, setUrl] = useState("wss://echo.websocket.org");
  const [status, setStatus] = useState<Status>("disconnected");
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [connId, setConnId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let unMsg: (() => void) | undefined;
    let unClosed: (() => void) | undefined;
    let unErr: (() => void) | undefined;

    (async () => {
      unMsg = await listen<{ connection_id: string; data: string }>("ws-message", e => {
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          direction: "in",
          data: e.payload.data,
          time: now(),
        }]);
      });

      unClosed = await listen<{ connection_id: string }>("ws-closed", () => {
        setStatus("disconnected");
        setConnId(null);
        setMessages(prev => [...prev, statusMsg("— Connection closed —")]);
      });

      unErr = await listen<{ connection_id: string; data: string }>("ws-error", e => {
        setError(e.payload.data);
        setStatus("disconnected");
        setConnId(null);
      });
    })();

    return () => { unMsg?.(); unClosed?.(); unErr?.(); };
  }, []);

  async function handleConnect() {
    if (!url.trim()) return;
    setStatus("connecting");
    setError(null);
    try {
      const id = await wsConnect(url.trim());
      setConnId(id);
      setStatus("connected");
      setMessages(prev => [...prev, statusMsg("— Connected —")]);
    } catch (e) {
      setError(String(e));
      setStatus("disconnected");
    }
  }

  async function handleDisconnect() {
    if (!connId) return;
    await wsDisconnect(connId);
    setConnId(null);
    setStatus("disconnected");
    setMessages(prev => [...prev, statusMsg("— Disconnected —")]);
  }

  async function handleSend() {
    if (!draft.trim() || !connId) return;
    const msg = draft.trim();
    setDraft("");
    setMessages(prev => [...prev, {
      id: crypto.randomUUID(),
      direction: "out",
      data: msg,
      time: now(),
    }]);
    try {
      await wsSend(connId, msg);
    } catch (e) {
      setError(String(e));
    }
  }

  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  const statusColor = isConnected ? "#22C55E" : isConnecting ? "#F59E0B" : "#3F3F46";
  const statusLabel = isConnected ? "Connected" : isConnecting ? "Connecting…" : "Disconnected";

  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden" style={{ background: "#0A0A0A" }}>

      {/* URL bar */}
      <div className="flex items-center gap-2 shrink-0 px-4" style={{ height: 52, borderBottom: "1px solid #27272A" }}>
        <div className="flex-1 flex items-center px-3 rounded-md" style={{ height: 32, background: "#141414", border: "1px solid #27272A" }}>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !isConnected && !isConnecting && handleConnect()}
            disabled={isConnected || isConnecting}
            placeholder="wss://echo.websocket.org"
            className="flex-1 text-[12px] bg-transparent disabled:opacity-40"
            style={{ fontFamily: "Geist Mono, monospace", color: "#E4E4E7" }}
          />
        </div>

        {!isConnected ? (
          <button
            onClick={handleConnect}
            disabled={!url.trim() || isConnecting}
            className="flex items-center gap-1.5 px-4 rounded-md font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 shrink-0"
            style={{ height: 32, fontSize: 13, background: "#A855F7" }}>
            {isConnecting
              ? <span className="animate-spin text-[14px]">⟳</span>
              : <Wifi size={13} />}
            {isConnecting ? "Connecting…" : "Connect"}
          </button>
        ) : (
          <button
            onClick={handleDisconnect}
            className="flex items-center gap-1.5 px-4 rounded-md font-semibold transition-opacity hover:opacity-90 shrink-0"
            style={{ height: 32, fontSize: 13, background: "#1A1A1A", border: "1px solid #27272A", color: "#EF4444" }}>
            <WifiOff size={13} />
            Disconnect
          </button>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between shrink-0 px-4"
        style={{ height: 36, borderBottom: "1px solid #27272A", background: "#0F0F0F" }}>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: statusColor }} />
          <span className="text-[11px]" style={{ color: statusColor }}>{statusLabel}</span>
          {error && (
            <span className="text-[11px]" style={{ color: "#EF4444" }}>— {error}</span>
          )}
        </div>
        {messages.length > 0 && (
          <button onClick={() => { setMessages([]); setError(null); }}
            className="flex items-center gap-1 text-[11px] transition-colors hover:text-[#A1A1AA]"
            style={{ color: "#71717A" }}>
            <Trash2 size={11} /> Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-1.5">
        {messages.length === 0 && (
          <p className="text-[12px] text-center mt-8" style={{ color: "#3F3F46" }}>
            Connect to a WebSocket server to start receiving messages
          </p>
        )}
        {messages.map(msg => (
          <div key={msg.id} className="flex items-start gap-3">
            <span className="text-[10px] shrink-0 mt-0.5"
              style={{ color: "#4A4A52", fontFamily: "Geist Mono, monospace" }}>
              {msg.time}
            </span>
            <span className="text-[12px] shrink-0 font-bold"
              style={{ color: msg.direction === "out" ? "#A855F7" : "#4A4A52", fontFamily: "Geist Mono, monospace" }}>
              {msg.direction === "out" ? "→" : "←"}
            </span>
            <span className="text-[12px] break-all"
              style={{ color: msg.direction === "out" ? "#C084FC" : "#A1A1AA", fontFamily: "Geist Mono, monospace", lineHeight: 1.6 }}>
              {msg.data}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Send bar */}
      <div className="flex items-center gap-2 shrink-0 px-4"
        style={{ height: 52, borderTop: "1px solid #27272A" }}>
        <div className="flex-1 flex items-center px-3 rounded-md"
          style={{ height: 36, background: "#141414", border: "1px solid #27272A" }}>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSend()}
            disabled={!isConnected}
            placeholder={isConnected ? "Type a message and press Enter…" : "Connect first"}
            className="flex-1 text-[12px] bg-transparent disabled:opacity-30"
            style={{ fontFamily: "Geist Mono, monospace", color: "#E4E4E7" }}
          />
        </div>
        <button
          onClick={handleSend}
          disabled={!isConnected || !draft.trim()}
          className="flex items-center justify-center rounded-md transition-opacity hover:opacity-90 disabled:opacity-40 shrink-0"
          style={{ width: 36, height: 36, background: "#A855F7" }}>
          <Send size={13} className="text-white" />
        </button>
      </div>
    </div>
  );
}
