"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/AppShell";

type Section = {
  id: string; section_index: number; content: string;
  page_from: number | null; page_to: number | null;
  detection: string; decision: string | null;
};
type Doc = { id: string; title: string; status: string; document_sections: Section[] };

export default function ReviewPage() {
  const supabase = createClient();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [active, setActive] = useState<Doc | null>(null);
  const [filter, setFilter] = useState<"pending" | "published">("pending");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadQueue(preferredDocId?: string | null) {
    setError("");
    const { data, error: qErr } = await supabase
      .from("documents")
      .select("id, title, status, document_sections(*)")
      .in("status", ["pending", "published"])
      .order("created_at", { ascending: false });

    if (qErr) {
      setError(qErr.message);
      return;
    }

    const list: Doc[] = ((data as Doc[]) ?? []).map((d) => ({
      ...d,
      document_sections: [...(d.document_sections ?? [])].sort(
        (a, b) => a.section_index - b.section_index
      ),
    }));
    setDocs(list);
    if (list.length === 0) {
      setActive(null);
      return;
    }
    if (preferredDocId) {
      const target = list.find((d) => d.id === preferredDocId);
      if (target) {
        setFilter(target.status === "published" ? "published" : "pending");
        setActive(target);
        return;
      }
    }
    const matching = list.filter((d) => d.status === filter);
    if (matching.length > 0) {
      setActive(matching[0]);
    } else {
      const firstStatus = list[0].status === "published" ? "published" : "pending";
      setFilter(firstStatus);
      setActive(list[0]);
    }
  }

  useEffect(() => {
    const docId =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("docId")
        : null;
    void loadQueue(docId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(s: Section, decision: "lesson" | "answer" | "discard") {
    setError("");
    const { error: upErr } = await supabase
      .from("document_sections")
      .update({ decision })
      .eq("id", s.id);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    if (!active) return;
    const updated = {
      ...active,
      document_sections: active.document_sections.map((x) =>
        x.id === s.id ? { ...x, decision } : x
      ),
    };
    setActive(updated);
    setDocs((ds) => ds.map((d) => (d.id === active.id ? updated : d)));
  }

  async function bulkApproveSafeAsLesson() {
    if (!active) return;
    const targets = active.document_sections.filter(
      (s) => s.detection !== "suspected_answer" && s.decision !== "lesson" && s.decision !== "discard"
    );
    if (targets.length === 0) {
      setNotice("Không còn mục nào cần chuyển sang Bài học.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const targetIds = targets.map((s) => s.id);
      const { error: upErr } = await supabase
        .from("document_sections")
        .update({ decision: "lesson" })
        .in("id", targetIds);
      if (upErr) throw upErr;

      const idSet = new Set(targetIds);
      const updated = {
        ...active,
        document_sections: active.document_sections.map((x) =>
          idSet.has(x.id) ? { ...x, decision: "lesson" } : x
        ),
      };
      setActive(updated);
      setDocs((ds) => ds.map((d) => (d.id === active.id ? updated : d)));
      setNotice(`Đã duyệt ${targets.length} mục không nghi đáp án thành 'Bài học'.`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!active) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      // Đánh dấu các mục chưa quyết định thành 'answer' (an toàn mặc định — vùng kín)
      const undecided = active.document_sections.filter((s) => !s.decision);
      if (undecided.length) {
        const { error: secErr } = await supabase
          .from("document_sections")
          .update({ decision: "answer" })
          .in("id", undecided.map((s) => s.id));
        if (secErr) throw secErr;
      }
      const { error: docErr } = await supabase
        .from("documents")
        .update({ status: "published" })
        .eq("id", active.id);
      if (docErr) throw docErr;

      setNotice("Đã duyệt và xuất bản. Các mục 'Bài học' giờ xuất hiện trong Kho tri thức và chat của sinh viên.");
      await loadQueue();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function discardDoc() {
    if (!active) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { error: docErr } = await supabase
        .from("documents")
        .update({ status: "discarded" })
        .eq("id", active.id);
      if (docErr) throw docErr;
      setNotice(`Đã bỏ tài liệu "${active.title}".`);
      await loadQueue();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const filteredDocs = docs.filter((d) => d.status === filter);
  const pending = active?.document_sections.filter((s) => !s.decision) ?? [];
  const lessonCount = active?.document_sections.filter((s) => s.decision === "lesson").length ?? 0;
  const answerCount = active?.document_sections.filter((s) => s.decision === "answer").length ?? 0;
  const current = pending[0] ?? null;

  return (
    <div>
      <PageHeader
        title="Duyệt tài liệu (HITL)"
        description="Xác nhận từng mục là Bài học (cho phép sinh viên tra cứu), Đáp án (giữ vùng kín, không tra cứu được) hoặc Bỏ trước khi xuất bản."
      />
      {error && (
        <div style={{ background: "var(--color-sealed-bg)", color: "var(--color-sealed-fg)", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}
      {notice && (
        <div style={{ background: "var(--color-success-bg)", color: "var(--color-success-fg)", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          {notice}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 20, alignItems: "start" }}>
        <div className="card">
          <div className="card-h">
            <span className="card-title" style={{ fontSize: 13 }}>Tài liệu</span>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                type="button"
                className={`btn btn-sm ${filter === "pending" ? "btn-primary" : ""}`}
                onClick={() => {
                  setFilter("pending");
                  const first = docs.find((d) => d.status === "pending") ?? null;
                  setActive(first);
                }}
              >
                Chờ duyệt ({docs.filter((d) => d.status === "pending").length})
              </button>
              <button
                type="button"
                className={`btn btn-sm ${filter === "published" ? "btn-primary" : ""}`}
                onClick={() => {
                  setFilter("published");
                  const first = docs.find((d) => d.status === "published") ?? null;
                  setActive(first);
                }}
              >
                Đã xuất bản ({docs.filter((d) => d.status === "published").length})
              </button>
            </div>
          </div>
          <div style={{ padding: 8 }}>
            {filteredDocs.length === 0 && (
              <div style={{ padding: 12, fontSize: 13, color: "var(--color-muted)" }}>
                {filter === "pending" ? "Không có tài liệu nào đang chờ duyệt." : "Chưa có tài liệu nào đã xuất bản."}
              </div>
            )}
            {filteredDocs.map((d) => {
              const left = d.document_sections.filter((s) => !s.decision).length;
              const lessons = d.document_sections.filter((s) => s.decision === "lesson").length;
              return (
                <button key={d.id} onClick={() => setActive(d)} className="btn"
                  style={{
                    display: "block", width: "100%", textAlign: "left", border: "none",
                    background: d.id === active?.id ? "var(--color-accent-tint)" : "transparent",
                    color: d.id === active?.id ? "var(--color-accent)" : "var(--color-ink)",
                    fontWeight: d.id === active?.id ? 600 : 400, marginBottom: 2,
                  }}>
                  {d.title}
                  <div style={{ fontWeight: 400, marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {left > 0 && <span className="pill pill-warn tnum">Còn {left} mục</span>}
                    <span className="pill pill-success tnum">{lessons} bài học</span>
                    {d.document_sections.some((s) => s.detection === "suspected_answer" && !s.decision) && (
                      <span className="pill pill-sealed">Có mục nghi đáp án</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="card">
          {!active ? (
            <div className="card-b" style={{ color: "var(--color-muted)" }}>
              Chọn một tài liệu ở cột bên trái để duyệt hoặc chỉnh sửa phân loại các mục.
            </div>
          ) : current ? (
            <>
              <div className="card-h">
                <div>
                  <span className="card-title">Mục {current.section_index + 1}</span>
                  <div style={{ fontSize: 12, color: "var(--color-muted)" }} className="tnum">
                    {active.title}
                    {current.page_from && ` · tr. ${current.page_from}${current.page_to && current.page_to !== current.page_from ? `–${current.page_to}` : ""}`}
                  </div>
                </div>
                <span className={`pill ${current.detection === "suspected_answer" ? "pill-sealed" : current.detection === "lesson" ? "pill-success" : "pill-neutral"}`}>
                  {current.detection === "suspected_answer" ? "Phát hiện: nghi là đáp án" : current.detection === "lesson" ? "Phát hiện: Bài học" : "Phát hiện: khác"}
                </span>
              </div>
              <div className="card-b">
                <div style={{
                  background: "var(--color-recessed)", border: "1px solid var(--color-line)",
                  borderRadius: 8, padding: 16, fontSize: 13.5, whiteSpace: "pre-wrap",
                  maxHeight: 300, overflowY: "auto", marginBottom: 18,
                }}>
                  {current.content}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn btn-primary" onClick={() => void decide(current, "lesson")}>Duyệt: Bài học</button>
                  <button className="btn btn-sealed" onClick={() => void decide(current, "answer")}>Đánh dấu: Đáp án (vùng kín)</button>
                  <button className="btn" style={{ color: "var(--color-sealed-fg)" }} onClick={() => void decide(current, "discard")}>Bỏ mục này</button>
                  <button className="btn" onClick={() => void bulkApproveSafeAsLesson()} disabled={busy}>
                    Duyệt nhanh mục an toàn → Bài học
                  </button>
                </div>
                <div style={{ borderTop: "1px solid var(--color-line)", marginTop: 18, paddingTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 12.5, color: "var(--color-muted)" }} className="tnum">
                    Còn {pending.length} mục chưa quyết định (hiện có {lessonCount} bài học, {answerCount} đáp án). Mục chưa quyết định sẽ tự thành Đáp án khi xuất bản.
                  </span>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <button className="btn" style={{ color: "var(--color-sealed-fg)" }} onClick={() => void discardDoc()} disabled={busy}>
                      Bỏ tài liệu
                    </button>
                    <button className="btn btn-primary" onClick={() => void publish()} disabled={busy}>
                      {busy ? "Đang duyệt..." : "Duyệt và xuất bản tài liệu"}
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="card-b">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontSize: 13, color: "var(--color-muted)" }} className="tnum">
                  Đã phân loại toàn bộ {active.document_sections.length} mục:{" "}
                  <b>{lessonCount} Bài học</b> · <b>{answerCount} Đáp án (vùng kín)</b>.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {active.document_sections.some((s) => s.detection !== "suspected_answer" && s.decision === "answer") && (
                    <button className="btn btn-sm" onClick={() => void bulkApproveSafeAsLesson()} disabled={busy}>
                      Chuyển mục an toàn → Bài học
                    </button>
                  )}
                  {active.status === "pending" && (
                    <button className="btn btn-sm btn-primary" onClick={() => void publish()} disabled={busy}>
                      {busy ? "Đang duyệt..." : "Duyệt và xuất bản tài liệu"}
                    </button>
                  )}
                  <button className="btn btn-sm" style={{ color: "var(--color-sealed-fg)" }} onClick={() => void discardDoc()} disabled={busy}>
                    Bỏ tài liệu
                  </button>
                </div>
              </div>
              {active.document_sections.length === 0 ? (
                <div style={{ color: "var(--color-muted)", fontSize: 13 }}>
                  Tài liệu này chưa có đoạn nội dung nào được trích xuất.
                </div>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr><th>#</th><th>Nội dung</th><th>Phân loại</th><th>Đổi nhanh</th></tr>
                  </thead>
                  <tbody>
                    {active.document_sections.map((s) => (
                      <tr key={s.id}>
                        <td className="tnum">{s.section_index + 1}</td>
                        <td style={{ fontSize: 13 }}>
                          {s.content.length > 140 ? `${s.content.slice(0, 140)}...` : s.content}
                        </td>
                        <td>
                          <span className={`pill ${s.decision === "lesson" ? "pill-success" : s.decision === "answer" ? "pill-sealed" : "pill-neutral"}`}>
                            {s.decision === "lesson" ? "Bài học" : s.decision === "answer" ? "Đáp án" : "Đã bỏ"}
                          </span>
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", gap: 4 }}>
                            {s.decision !== "lesson" && (
                              <button className="btn btn-sm btn-primary" onClick={() => void decide(s, "lesson")}>Bài học</button>
                            )}
                            {s.decision !== "answer" && (
                              <button className="btn btn-sm btn-sealed" onClick={() => void decide(s, "answer")}>Đáp án</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
