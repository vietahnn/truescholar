"use client";

import { useEffect, useState } from "react";
import { apiFetch, type StudentOverview } from "@/lib/api";
import { PageHeader } from "@/components/AppShell";

type Result = {
  id: string; content: string; page_from: number | null; page_to: number | null;
  document_title: string; rank: number;
};

export default function KnowledgePage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [overview, setOverview] = useState<StudentOverview>({ classes: [], documents: [] });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<StudentOverview>("/api/student/overview")
      .then(setOverview)
      .catch(() => {});
  }, []);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setError("");
    try {
      const data = await apiFetch<{ results: Result[] }>(
        `/api/student/search?q=${encodeURIComponent(query.trim())}&limit=10`
      );
      setResults(data.results ?? []);
    } catch (err: any) {
      setError(err.message || "Không tìm kiếm được.");
      setResults([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Kho tri thức"
        description="Tra cứu trực tiếp trong các tài liệu đã duyệt của môn học và tài liệu chung của Trung tâm."
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <div className="card">
          <div className="card-h">
            <span className="card-title">Lớp đang theo học</span>
            <span className="pill pill-neutral tnum">{overview.classes.length} lớp</span>
          </div>
          <div className="card-b">
            {overview.classes.length === 0 ? (
              <div style={{ color: "var(--color-muted)", fontSize: 13.5 }}>
                Bạn chưa được ghi danh vào lớp nào. Bạn vẫn xem được các tài liệu chung của Trung tâm (nếu có).
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {overview.classes.map((c) => (
                  <span key={c.id} className="pill pill-neutral">
                    <b>{c.name}</b>
                    {c.course && ` · ${c.course.code} — ${c.course.title}`}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <span className="card-title">Tài liệu bạn có quyền truy cập</span>
            <span className="pill pill-neutral tnum">{overview.documents.length} tài liệu</span>
          </div>
          <div className="card-b">
            {overview.documents.length === 0 ? (
              <div style={{ color: "var(--color-muted)", fontSize: 13.5 }}>
                Chưa có tài liệu đã xuất bản nào dành cho lớp của bạn hoặc Trung tâm.
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {overview.documents.map((d) => (
                  <span
                    key={d.id}
                    className={`pill ${d.lessonSections > 0 ? "pill-accent" : "pill-warn"} tnum`}
                  >
                    {d.title}
                    {d.visibility === "center"
                      ? " · Trung tâm"
                      : d.course?.code
                        ? ` · ${d.course.code}`
                        : ""}
                    {` (${d.lessonSections} mục)`}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <span className="card-title">Tìm kiếm tài liệu</span>
          <span className="pill pill-neutral">Tra cứu trực tiếp, không qua LLM</span>
        </div>
        <div className="card-b">
          <form onSubmit={search} style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Ví dụ: định luật II Newton, con lắc đơn..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Đang tìm..." : "Tìm kiếm"}
            </button>
          </form>

          {error && (
            <div style={{ background: "var(--color-sealed-bg)", color: "var(--color-sealed-fg)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 14 }}>
              Lỗi tìm kiếm: {error}
            </div>
          )}

          {results === null && (
            <div style={{ color: "var(--color-muted)", fontSize: 13.5 }}>
              Nhập từ khóa để tra cứu trực tiếp trong kho tài liệu.
            </div>
          )}
          {results?.length === 0 && !error && (
            <div style={{ color: "var(--color-muted)", fontSize: 13.5 }}>
              Không tìm thấy đoạn tài liệu phù hợp.
            </div>
          )}
          {results && results.length > 0 && (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: "55%" }}>Đoạn tài liệu</th>
                  <th>Nguồn</th>
                  <th>Độ khớp</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const pct = Math.min(100, Math.max(0, Math.round(r.rank * 100)));
                  const expanded = expandedId === r.id;
                  const long = r.content.length > 220;
                  return (
                    <tr key={r.id}>
                      <td style={{ color: "var(--color-ink)", whiteSpace: "pre-wrap" }}>
                        {expanded || !long ? r.content : `${r.content.slice(0, 220)}...`}
                        {long && (
                          <div>
                            <button
                              type="button"
                              className="btn btn-sm"
                              style={{ marginTop: 6 }}
                              onClick={() => setExpandedId(expanded ? null : r.id)}
                            >
                              {expanded ? "Thu gọn" : "Xem đầy đủ"}
                            </button>
                          </div>
                        )}
                      </td>
                      <td>
                        <b>{r.document_title}</b>
                        <div style={{ fontSize: 12, color: "var(--color-muted)" }} className="tnum">
                          {r.page_from && `tr. ${r.page_from}${r.page_to && r.page_to !== r.page_from ? `–${r.page_to}` : ""}`}
                        </div>
                      </td>
                      <td className="tnum" style={{ width: 90 }}>
                        {pct}%
                        <div className="bar" style={{ width: 70, marginTop: 4 }}>
                          <div style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
