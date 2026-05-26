import { useState, useRef, useEffect } from "react";
import { Radio, Square, Trash2, Plus, X, ChevronDown, ChevronRight } from "lucide-react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { sseConnect, sseDisconnect } from "@/lib/tauri";

type Status = "disconnected" | "connecting" | "connected" | "closed";

interface SseMessage {
  id: string;
  type: "open" | "message" | "error" | "closed";
  event: string;
  data: string;
  eventId?: string;
  time: string;
}

interface Header {
  key: string;
  value: string;
}

function now() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function tryPrettyJson(raw: string): { pretty: string; isJson: boolean } {
  try {
    return { pretty: JSON.stringify(JSON.parse(raw), null, 2), isJson: true };
  } catch {
    return { pretty: raw, isJson: false };
  }
}

function EventRow({ msg }: { msg: SseMessage }) {
  const [expanded, setExpanded] = useState(false);
  const { pretty, isJson } = tryPrettyJson(msg.data);
  const hasData = !!msg.data;

  const dataColor =
    msg.type === "error"  ? "var(--color-red)"  :
    msg.type === "closed" ? "var(--color-fg-3)" :
    msg.type === "open"   ? "var(--color-green)" :
    "var(--color-fg-2)";

  const eventColor =
    msg.event === "error"   ? "var(--color-red)"    :
    msg.event === "message" ? "var(--color-accent)"  :
    "var(--color-fg-3)";

  return (
    <div
      className="flex flex-col gap-1 px-4 py-2 border-b"
      style={{ borderColor: "var(--color-border)", cursor: hasData ? "pointer" : "default" }}
      onClick={() => hasData && setExpanded(v => !v)}
    >
      <div className="flex items-center gap-2 min-w-0">
        {hasData && (
          <span style={{ color: "var(--color-fg-4)", flexShrink: 0 }}>
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
        )}

        <span className="text-[10px] tabular-nums shrink-0" style={{ color: "var(--color-fg-4)", fontFamily: "var(--font-mono)" }}>
          {msg.time}
        </span>

        {msg.type === "message" && (
          <span
            className="px-1.5 py-px rounded text-[10px] shrink-0"
            style={{ background: "var(--color-accent-10)", color: eventColor, fontFamily: "var(--font-mono)" }}
          >
            {msg.event}
          </span>
        )}
        {msg.type === "open"   && <span className="text-[11px] shrink-0" style={{ color: "var(--color-green)" }}>connected</span>}
        {msg.type === "closed" && <span className="text-[11px] shrink-0" style={{ color: "var(--color-fg-3)" }}>disconnected</span>}
        {msg.type === "error"  && <span className="text-[11px] shrink-0" style={{ color: "var(--color-red)" }}>error</span>}

        {msg.eventId && (
          <span className="text-[10px] shrink-0" style={{ color: "var(--color-fg-4)", fontFamily: "var(--font-mono)" }}>
            #{msg.eventId}
          </span>
        )}

        {!expanded && hasData && (
          <span className="text-[11px] truncate min-w-0" style={{ color: dataColor, fontFamily: "var(--font-mono)" }}>
            {msg.data}
          </span>
        )}
      </div>

      {expanded && hasData && (
        <pre
          className="text-[11px] rounded px-3 py-2 overflow-x-auto whitespace-pre-wrap break-all ml-4"
          style={{
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
            color: isJson ? "var(--color-green)" : "var(--color-fg-2)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {pretty}
        </pre>
      )}
    </div>
  );
}

export function SseRoute() {
  const [url, setUrl] = useState("http://localhost:8080");
  const [status, setStatus] = useState<Status>("disconnected");
  const [messages, setMessages] = useState<SseMessage[]>([]);
  const [connId, setConnId] = useState<string | null>(null);
  const [headers, setHeaders] = useState<Header[]>([{ key: "", value: "" }]);
  const [headersOpen, setHeadersOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const unlistenRef = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => {
      unlistenRef.current.forEach(fn => fn());
      if (connId) sseDisconnect(connId).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function push(msg: Omit<SseMessage, "id" | "time">) {
    setMessages(prev => [...prev, { ...msg, id: crypto.randomUUID(), time: now() }]);
  }

  async function connect() {
    if (status === "connected" || status === "connecting") return;
    setStatus("connecting");
    setMessages([]);

    const headerMap: Record<string, string> = {};
    for (const h of headers) {
      if (h.key.trim()) headerMap[h.key.trim()] = h.value;
    }

    try {
      const id = await sseConnect(url, headerMap);
      setConnId(id);

      const unlisten = await Promise.all([
        listen<{ connectionId: string; data: string }>("sse-open", e => {
          if (e.payload.connectionId !== id) return;
          setStatus("connected");
          push({ type: "open", event: "open", data: `HTTP ${e.payload.data}` });
        }),
        listen<{ connectionId: string; event: string; data: string; id?: string }>("sse-message", e => {
          if (e.payload.connectionId !== id) return;
          push({ type: "message", event: e.payload.event, data: e.payload.data, eventId: e.payload.id });
        }),
        listen<{ connectionId: string; data: string }>("sse-error", e => {
          if (e.payload.connectionId !== id) return;
          setStatus("closed");
          push({ type: "error", event: "error", data: e.payload.data });
        }),
        listen<{ connectionId: string }>("sse-closed", e => {
          if (e.payload.connectionId !== id) return;
          setStatus("closed");
          push({ type: "closed", event: "closed", data: "" });
        }),
      ]);

      unlistenRef.current.forEach(fn => fn());
      unlistenRef.current = unlisten;
    } catch (e) {
      setStatus("disconnected");
      push({ type: "error", event: "error", data: String(e) });
    }
  }

  async function disconnect() {
    if (connId) {
      await sseDisconnect(connId).catch(() => {});
      setConnId(null);
    }
    setStatus("disconnected");
  }

  const isConnected = status === "connected" || status === "connecting";
  const statusColor =
    status === "connected"  ? "var(--color-green)"  :
    status === "connecting" ? "var(--color-yellow)"  :
    status === "closed"     ? "var(--color-red)"     :
    "var(--color-fg-4)";
  const statusLabel =
    status === "connected"  ? "Connected"    :
    status === "connecting" ? "Connecting…"  :
    status === "closed"     ? "Closed"       :
    "Disconnected";

  const eventCount = messages.filter(m => m.type === "message").length;

  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden" style={{ background: "var(--color-bg)" }}>

      {/* URL bar */}
      <div className="flex items-center gap-2 shrink-0 px-4" style={{ height: 52, borderBottom: "1px solid var(--color-border)" }}>
        <div className="flex-1 flex items-center px-3 rounded-md" style={{ height: 32, background: "var(--color-input)", border: "1px solid var(--color-border)" }}>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !isConnected && connect()}
            disabled={isConnected}
            placeholder="https://api.example.com/stream"
            className="flex-1 text-[12px] bg-transparent disabled:opacity-40"
            style={{ fontFamily: "var(--font-mono)", color: "var(--color-fg)" }}
          />
        </div>

        {status === "connected" ? (
          <button
            onClick={disconnect}
            className="flex items-center gap-1.5 px-4 rounded-md font-semibold transition-opacity hover:opacity-90 shrink-0"
            style={{ height: 32, fontSize: 13, background: "var(--color-card)", border: "1px solid var(--color-border)", color: "var(--color-red)" }}
          >
            <Square size={13} />
            Disconnect
          </button>
        ) : status === "connecting" ? (
          <button
            disabled
            className="flex items-center gap-1.5 px-4 rounded-md font-semibold text-white opacity-70 shrink-0"
            style={{ height: 32, fontSize: 13, background: "var(--color-accent)" }}
          >
            <span className="animate-spin text-[14px]">⟳</span>
            Connecting…
          </button>
        ) : (
          <button
            onClick={connect}
            className="flex items-center gap-1.5 px-4 rounded-md font-semibold text-white transition-opacity hover:opacity-90 shrink-0"
            style={{ height: 32, fontSize: 13, background: "var(--color-accent)" }}
          >
            <Radio size={13} />
            Connect
          </button>
        )}
      </div>

      {/* Status + stats bar */}
      <div className="flex items-center justify-between shrink-0 px-4" style={{ height: 36, borderBottom: "1px solid var(--color-border)", background: "var(--color-sidebar)" }}>
        <div className="flex items-center gap-2">
          <span className="rounded-full shrink-0" style={{ width: 7, height: 7, background: statusColor }} />
          <span className="text-[11px]" style={{ color: statusColor }}>{statusLabel}</span>
          {eventCount > 0 && (
            <span className="text-[11px]" style={{ color: "var(--color-fg-4)" }}>· {eventCount} events</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              className="flex items-center gap-1 text-[11px] transition-colors hover:opacity-80"
              style={{ color: "var(--color-fg-3)" }}
            >
              <Trash2 size={11} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Headers collapsible */}
      <div className="shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <button
          className="flex items-center gap-2 w-full px-4 transition-colors hover:opacity-80"
          style={{ height: 32, background: "var(--color-sidebar)" }}
          onClick={() => setHeadersOpen(v => !v)}
        >
          {headersOpen ? <ChevronDown size={11} style={{ color: "var(--color-fg-4)" }} /> : <ChevronRight size={11} style={{ color: "var(--color-fg-4)" }} />}
          <span className="text-[11px]" style={{ color: "var(--color-fg-3)" }}>Headers</span>
          {headers.some(h => h.key.trim()) && (
            <span className="text-[10px] px-1 rounded" style={{ background: "var(--color-accent-10)", color: "var(--color-accent)" }}>
              {headers.filter(h => h.key.trim()).length}
            </span>
          )}
        </button>

        {headersOpen && (
          <div className="px-4 py-2 flex flex-col gap-1.5" style={{ background: "var(--color-bg)" }}>
            {headers.map((h, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex-1 flex items-center px-2 rounded" style={{ height: 28, background: "var(--color-input)", border: "1px solid var(--color-border)" }}>
                  <input
                    className="flex-1 text-[11px] bg-transparent"
                    style={{ fontFamily: "var(--font-mono)", color: "var(--color-fg)" }}
                    placeholder="Key"
                    value={h.key}
                    onChange={e => setHeaders(prev => prev.map((r, idx) => idx === i ? { ...r, key: e.target.value } : r))}
                    disabled={isConnected}
                  />
                </div>
                <div className="flex-1 flex items-center px-2 rounded" style={{ height: 28, background: "var(--color-input)", border: "1px solid var(--color-border)" }}>
                  <input
                    className="flex-1 text-[11px] bg-transparent"
                    style={{ fontFamily: "var(--font-mono)", color: "var(--color-fg)" }}
                    placeholder="Value"
                    value={h.value}
                    onChange={e => setHeaders(prev => prev.map((r, idx) => idx === i ? { ...r, value: e.target.value } : r))}
                    disabled={isConnected}
                  />
                </div>
                <button onClick={() => setHeaders(prev => prev.filter((_, idx) => idx !== i))} disabled={isConnected} style={{ color: "var(--color-fg-4)" }}>
                  <X size={12} />
                </button>
              </div>
            ))}
            <button
              onClick={() => setHeaders(prev => [...prev, { key: "", value: "" }])}
              disabled={isConnected}
              className="flex items-center gap-1 text-[11px] mt-0.5 transition-colors hover:opacity-80 disabled:opacity-40"
              style={{ color: "var(--color-fg-3)" }}
            >
              <Plus size={11} /> Add header
            </button>
          </div>
        )}
      </div>

      {/* Event stream */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: "var(--color-fg-4)" }}>
            <Radio size={28} />
            <span className="text-[12px]">Connect to start receiving events</span>
          </div>
        ) : (
          <>
            {messages.map(msg => <EventRow key={msg.id} msg={msg} />)}
            <div ref={bottomRef} />
          </>
        )}
      </div>
    </div>
  );
}
