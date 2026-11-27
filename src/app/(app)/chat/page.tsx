"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, type StudentOverview } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/AppShell";

type Citation = { index: number; sectionId?: string; documentTitle: string; page: number | null };
type Msg = { role: "user" | "assistant"; content: string; citations?: Citation[] };
type Session = { id: string; title: string };
type PreviewSource = {
  index: number;
  documentTitle: string;
  pageFrom: number | null;
  pageTo: number | null;
  content: string;
};

export default function ChatPage() {
  const supabase = createClient();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewSource | null>(null);
  const [overview, setOverview] = useState<StudentOverview | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const [{ data }] = await Promise.all([
        supabase
          .from("chat_sessions")
          .select("id, title")
          .order("created_at", { ascending: false })
          .limit(20),
        apiFetch<StudentOverview>("/api/student/overview")
          .then(setOverview)
          .catch(() => {}),
      ]);
      setSessions(data ?? []);
      if (data?.length) await openSession(data[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function openSession(id: string) {
    setActiveId(id);
    setPreview(null);
    const { data } = await supabase
      .from("chat_messages")
      .select("role, content, citations")
      .eq("session_id", id)
      .order("created_at", { ascending: true });
    setMessages((data as Msg[]) ?? []);
  }

  async function newSession(): Promise<string | null> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from("chat_sessions")
      .insert({ user_id: user.id, title: "Cuộc trò chuyện mới" })
      .select("id, title")
      .single();
    if (error || !data) return null;
    setSessions((prev) => [data, ...prev]);
    setActiveId(data.id);
    setMessages([]);
    setPreview(null);
    return data.id;
  }

  async function inspectCitation(c: Citation) {
    if (!c.sectionId) return;
    const { data, error } = await supabase
      .from("document_sections")
      .select("content, page_from, page_to")
      .eq("id", c.sectionId)
      .maybeSingle();
    if (error || !data) {
      setPreview({
        index: c.index,
        documentTitle: c.documentTitle,
        pageFrom: c.page,
        pageTo: null,
        content: "Không tải được nội dung đoạn trích nguồn này.",
      });
      return;
    }
    setPreview({
      index: c.index,
      documentTitle: c.documentTitle,
      pageFrom: data.page_from ?? c.page,
      pageTo: data.page_to ?? null,
      content: data.content,
    });
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || busy) return;
    let sid = activeId;
    if (!sid) {
      sid = await newSession();
      if (!sid) {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: "Lỗi: Không thể tạo phiên trò chuyện mới. Vui lòng đăng nhập lại." },
        ]);
        return;
      }
    }
    setInput("");
    setMessages((m) => [...m, { role: "user", content: q }]);
    setBusy(true);
    try {
      const data = await apiFetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({ sessionId: sid, question: q }),
      });
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.answer, citations: data.citations },
      ]);
      if (data.title) {
        setSessions((prev) =>
          prev.map((s) => (s.id === sid ? { ...s, title: data.title } : s))
        );
      }
    } catch (err: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Lỗi: ${err.message}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Trợ lý học thuật"
        description="Hỏi đáp chuyên sâu theo tài liệu môn học đã được giảng viên duyệt. Mọi câu trả lời đều kèm trích nguồn."
      />
      {overview && (
        <div className="card" style={{ marginBottom: 16, padding: "10px 14px", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", fontSize: 12.5 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ color: "var(--color-muted)", fontWeight: 500 }}>Lớp đang học:</span>
            {overview.classes.length === 0 ? (
              <span className="pill pill-neutral">Chưa ghi danh lớp</span>
            ) : (
              overview.classes.map((c) => (
                <span key={c.id} className="pill pill-neutral">
                  {c.name}{c.course?.code ? ` (${c.course.code})` : ""}
                </span>
              ))
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ color: "var(--color-muted)", fontWeight: 500 }}>Tài liệu có thể hỏi:</span>
            {overview.documents.length === 0 ? (
              <span className="pill pill-warn">Chưa có tài liệu nào</span>
            ) : (
              overview.documents.map((d) => (
                <span
                  key={d.id}
                  className={`pill ${d.lessonSections > 0 ? "pill-accent" : "pill-warn"} tnum`}
                >
                  {d.title} · {d.lessonSections} mục
                </span>
              ))
            )}
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 20, alignItems: "start" }}>
        <div className="card">
          <div className="card-h">
            <span className="card-title" style={{ fontSize: 13 }}>Cuộc trò chuyện</span>
            <button className="btn btn-sm btn-primary" onClick={() => void newSession()}>+ Mới</button>
          </div>
          <div style={{ padding: 8 }}>
            {sessions.length === 0 && (
              <div style={{ padding: "8px 12px", fontSize: 13, color: "var(--color-muted)" }}>
                Chưa có cuộc trò chuyện nào.
              </div>
            )}
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => void openSession(s.id)}
                className="btn"
                style={{
                  display: "block", width: "100%", textAlign: "left", border: "none",
                  background: s.id === activeId ? "var(--color-accent-tint)" : "transparent",
                  color: s.id === activeId ? "var(--color-accent)" : "var(--color-ink)",
                  fontWeight: s.id === activeId ? 600 : 400,
                  marginBottom: 2,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}
              >
                {s.title}
              </button>
            ))}
          </div>
        </div>

        <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: 560 }}>
          <div className="card-h">
            <span className="card-title">Hội thoại</span>
            <span className="pill pill-accent">Có trích nguồn</span>
          </div>

          <div style={{ flex: 1, padding: 20, overflowY: "auto", maxHeight: 520 }}>
            {messages.length === 0 && (
              <div style={{ color: "var(--color-muted)", fontSize: 13.5 }}>
                Hãy đặt câu hỏi đầu tiên. Mọi câu trả lời đều kèm trích nguồn tài liệu.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{ display: "flex", gap: 12, marginBottom: 20 }}>
                <div
                  style={{
                    width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                    display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700,
                    background: m.role === "user" ? "var(--color-recessed)" : "var(--color-accent)",
                    color: m.role === "user" ? "var(--color-muted)" : "#fff",
                  }}
                >
                  {m.role === "user" ? "SV" : "T"}
                </div>
                <div style={{ maxWidth: 620 }}>
                  <div
                    style={{
                      background: m.role === "user" ? "var(--color-recessed)" : "var(--color-surface)",
                      border: m.role === "user" ? "none" : "1px solid var(--color-line)",
                      borderRadius: 10, padding: "12px 16px", whiteSpace: "pre-wrap",
                    }}
                  >
                    {m.content}
                  </div>
                  {m.citations && m.citations.length > 0 && (
                    <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {m.citations.map((c) => (
                        <button
                          type="button"
                          key={`${c.sectionId ?? "cit"}-${c.index}`}
                          className="cite"
                          onClick={() => void inspectCitation(c)}
                          title="Nhấn để xem đoạn tài liệu nguồn"
                        >
                          [{c.index}] {c.documentTitle}
                          {c.page != null && <span className="tnum"> · tr. {c.page}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div style={{ color: "var(--color-muted)", fontSize: 13 }}>Đang tìm tài liệu và soạn câu trả lời...</div>
            )}
            <div ref={bottomRef} />
          </div>

          {preview && (
            <div style={{ borderTop: "1px solid var(--color-line)", background: "var(--color-recessed)", padding: "12px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                  Nguồn [{preview.index}] — {preview.documentTitle}
                  {preview.pageFrom != null && (
                    <span className="tnum" style={{ color: "var(--color-muted)", fontWeight: 400 }}>
                      {" "}· tr. {preview.pageFrom}
                      {preview.pageTo && preview.pageTo !== preview.pageFrom ? `–${preview.pageTo}` : ""}
                    </span>
                  )}
                </div>
                <button type="button" className="btn btn-sm" onClick={() => setPreview(null)}>Đóng</button>
              </div>
              <div style={{ fontSize: 13, whiteSpace: "pre-wrap", maxHeight: 140, overflowY: "auto", color: "var(--color-ink)" }}>
                {preview.content}
              </div>
            </div>
          )}

          <form onSubmit={send} style={{ borderTop: "1px solid var(--color-line)", padding: 12, display: "flex", gap: 10 }}>
            <textarea
              className="input"
              placeholder="Nhập câu hỏi học thuật của bạn..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(e); }
              }}
              style={{ flex: 1, resize: "none", minHeight: 40 }}
              rows={2}
            />
            <button className="btn btn-primary" disabled={busy || !input.trim()}>Gửi</button>
          </form>
        </div>
      </div>
    </div>
  );
}
