"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/AppShell";

type Doc = {
  id: string;
  title: string;
  course_id: string | null;
  visibility: string;
  status: string;
  created_at: string;
  courses: { code: string; title: string } | null;
  document_sections: { id: string; detection: string; decision: string | null }[];
};
type Course = { id: string; code: string; title: string };
type Cls = { id: string; name: string; course_id: string };

export default function DocumentsPage() {
  const supabase = createClient();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [classes, setClasses] = useState<Cls[]>([]);
  const [title, setTitle] = useState("");
  const [courseId, setCourseId] = useState("");
  const [visibility, setVisibility] = useState<"course" | "center">("course");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadDocs() {
    const [
      { data, error: docErr },
      { data: cs, error: csErr },
      { data: cls, error: clsErr },
    ] = await Promise.all([
      supabase
        .from("documents")
        .select("id, title, course_id, visibility, status, created_at, courses(code, title), document_sections(id, detection, decision)")
        .order("created_at", { ascending: false }),
      supabase.from("courses").select("id, code, title").order("created_at", { ascending: false }),
      supabase.from("classes").select("id, name, course_id"),
    ]);
    if (docErr) setError(docErr.message);
    if (csErr) setError(csErr.message);
    if (clsErr) setError(clsErr.message);
    setDocs((data as any) ?? []);
    setCourses(cs ?? []);
    setClasses(cls ?? []);
    if (cs?.length) setCourseId((prev) => prev || cs[0].id);
  }

  useEffect(() => {
    void loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !title.trim() || (visibility === "course" && !courseId)) {
      setError("Điền đủ tiêu đề, chọn môn học (nếu phạm vi môn) và chọn tệp.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.append("title", title.trim());
      form.append("visibility", visibility);
      form.append("courseId", courseId || "");
      form.append("file", file);

      const res = await apiFetch<{ sectionsCount: number; warning?: string | null }>(
        "/api/lecturer/documents",
        { method: "POST", body: form }
      );

      setTitle("");
      setFile(null);
      setNotice(
        res.warning
          ? `${res.warning} Đã đưa vào hàng chờ duyệt.`
          : `Đã tải lên và tách ${res.sectionsCount} mục vào hàng chờ. Hãy sang trang 'Duyệt tài liệu' để duyệt từng mục.`
      );
      await loadDocs();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function assignScope(doc: Doc, value: string) {
    setError("");
    setNotice("");
    const nextPayload =
      value === "__center__"
        ? { visibility: "center", course_id: doc.course_id }
        : { visibility: "course", course_id: value };

    const { error: upErr } = await supabase
      .from("documents")
      .update(nextPayload)
      .eq("id", doc.id);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    setNotice(
      value === "__center__"
        ? `Đã chuyển "${doc.title}" thành tài liệu chung Trung tâm.`
        : `Đã gắn "${doc.title}" vào môn học mới.`
    );
    await loadDocs();
  }

  return (
    <div>
      <PageHeader
        title="Tài liệu"
        description="Tải tài liệu lên kho và gắn với Môn học; mọi lớp thuộc môn học đó (cùng sinh viên đã ghi danh) sẽ tự động truy cập được sau khi duyệt."
      />
      <div style={{ display: "grid", gridTemplateColumns: "400px 1fr", gap: 20, alignItems: "start" }}>
        <div className="card">
          <div className="card-h"><span className="card-title">Tải tài liệu mới</span></div>
          <div className="card-b">
            <form onSubmit={upload}>
              <div style={{ marginBottom: 14 }}>
                <label className="label">Môn học {visibility === "center" && "(tùy chọn)"}</label>
                <select className="input" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                  <option value="">{courses.length === 0 ? "(chưa có môn học)" : "— không gắn môn cụ thể —"}</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label className="label">Tiêu đề tài liệu</label>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label className="label">Phạm vi hiển thị</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className={`btn btn-sm ${visibility === "course" ? "btn-primary" : ""}`}
                    onClick={() => setVisibility("course")}>Chỉ sinh viên của môn</button>
                  <button type="button" className={`btn btn-sm ${visibility === "center" ? "btn-primary" : ""}`}
                    onClick={() => setVisibility("center")}>Tài liệu chung Trung tâm</button>
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label className="label">Chọn tệp (.txt, .md, .pdf, .docx, .pptx)</label>
                <input className="input" type="file" accept=".txt,.md,.pdf,.docx,.pptx"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
              {error && (
                <div style={{ background: "var(--color-sealed-bg)", color: "var(--color-sealed-fg)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 14 }}>
                  {error}
                </div>
              )}
              {notice && (
                <div style={{ background: "var(--color-success-bg)", color: "var(--color-success-fg)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 14 }}>
                  {notice}
                </div>
              )}
              <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy}>
                {busy ? "Đang tải..." : "Tải lên và xác nhận"}
              </button>
            </form>
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <span className="card-title">Tài liệu của tôi</span>
            <span className="pill pill-neutral tnum">{docs.length} tài liệu</span>
          </div>
          <table className="tbl">
            <thead>
              <tr><th>Tài liệu</th><th>Gắn vào môn / lớp</th><th>Trạng thái</th><th>Nội dung</th><th></th></tr>
            </thead>
            <tbody>
              {docs.length === 0 && (
                <tr><td colSpan={5} style={{ color: "var(--color-muted)" }}>Chưa có tài liệu nào.</td></tr>
              )}
              {docs.map((d) => {
                const pending = d.document_sections.filter((s) => !s.decision).length;
                const lessons = d.document_sections.filter((s) => s.decision === "lesson").length;
                const answers = d.document_sections.filter((s) => s.decision === "answer").length;
                const suspected = d.document_sections.filter((s) => s.detection === "suspected_answer" && !s.decision).length;
                const linkedClasses = d.course_id
                  ? classes.filter((cl) => cl.course_id === d.course_id)
                  : [];
                const currentScopeValue = d.visibility === "center" ? "__center__" : (d.course_id ?? "");
                return (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 600 }}>{d.title}</td>
                    <td style={{ minWidth: 190 }}>
                      <select
                        className="input"
                        style={{ padding: "4px 8px", fontSize: 12.5 }}
                        value={currentScopeValue}
                        onChange={(e) => void assignScope(d, e.target.value)}
                      >
                        <option value="__center__">Chung Trung tâm (mọi lớp)</option>
                        {courses.map((c) => (
                          <option key={c.id} value={c.id}>
                            Môn: {c.code} — {c.title}
                          </option>
                        ))}
                      </select>
                      <div style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 4 }}>
                        {d.visibility === "center"
                          ? "Mọi sinh viên đều truy cập được"
                          : linkedClasses.length > 0
                            ? `Lớp: ${linkedClasses.map((cl) => cl.name).join(", ")}`
                            : "Chưa có lớp nào thuộc môn này"}
                      </div>
                    </td>
                    <td>
                      <span className={`pill ${d.status === "published" ? "pill-success" : d.status === "pending" ? "pill-warn" : "pill-neutral"}`}>
                        {d.status === "published" ? "Đã xuất bản" : d.status === "pending" ? "Chờ duyệt" : "Đã bỏ"}
                      </span>
                    </td>
                    <td className="tnum">
                      {pending > 0
                        ? `${pending} chờ duyệt`
                        : `${lessons} bài học · ${answers} đáp án`}
                      {suspected > 0 && <b style={{ color: "var(--color-warn-fg)" }}> · {suspected} nghi đáp án</b>}
                    </td>
                    <td>
                      {d.status !== "discarded" && (
                        <Link className="btn btn-sm" href={`/lecturer/review?docId=${d.id}`}>
                          {d.status === "pending" ? "Duyệt ngay" : "Sửa mục"}
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
