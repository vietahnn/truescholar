"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/AppShell";

type Cls = { id: string; name: string; course_id: string };
type Asg = { id: string; title: string; due_at: string | null; status: string };
type Q = {
  id: string; position: number; prompt: string; kind: string;
  options: { key: string; label: string }[]; variant_params: any; max_score: number;
};
type KeyRow = { question_id: string; encrypted?: string; locked?: boolean; hint_ladder: any[]; public_criteria: string };

const KINDS = [
  { v: "mcq", label: "Trắc nghiệm (MCQ)" },
  { v: "numeric", label: "Số có dung sai & đơn vị" },
  { v: "expression", label: "Biểu thức" },
  { v: "essay", label: "Tự luận (Rubric + Judge)" },
];

export default function LecturerAssignmentsPage() {
  const supabase = createClient();
  const [classes, setClasses] = useState<Cls[]>([]);
  const [classId, setClassId] = useState("");
  const [assignments, setAssignments] = useState<Asg[]>([]);
  const [active, setActive] = useState<Asg | null>(null);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [keys, setKeys] = useState<Record<string, KeyRow>>({});

  // form câu hỏi mới
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState("numeric");
  const [options, setOptions] = useState("A. \nB. ");
  const [answerKey, setAnswerKey] = useState("");
  const [hints, setHints] = useState("[]");
  const [criteria, setCriteria] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // form bài tập mới
  const [newTitle, setNewTitle] = useState("");
  const [due, setDue] = useState("");

  useEffect(() => {
    (async () => {
      const { data: cs, error } = await supabase.from("classes").select("id, name, course_id");
      if (error) { setErrorMsg(error.message); return; }
      setClasses(cs ?? []);
      if (cs?.length) setClassId(cs[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!classId) return;
    (async () => {
      const { data, error } = await supabase
        .from("assignments").select("id, title, due_at, status")
        .eq("class_id", classId).order("created_at", { ascending: false });
      if (error) { setErrorMsg(error.message); return; }
      setAssignments(data ?? []);
      setActive(null);
      setQuestions([]);
      setKeys({});
    })();
  }, [classId, supabase]);

  async function open(a: Asg) {
    setActive(a);
    setErrorMsg("");
    const [{ data: qs, error: qErr }, { data: ks, error: kErr }] = await Promise.all([
      supabase.from("questions").select("*").eq("assignment_id", a.id).order("position"),
      supabase.from("answer_keys").select("question_id, encrypted, hint_ladder, public_criteria"),
    ]);
    if (qErr) { setErrorMsg(qErr.message); return; }
    if (kErr) { setErrorMsg(kErr.message); }
    setQuestions(qs ?? []);
    const map: Record<string, KeyRow> = {};
    (ks ?? []).forEach((k: any) => {
      if (qs?.some((q) => q.id === k.question_id)) {
        map[k.question_id] = { ...k, locked: Boolean(k.encrypted) };
      }
    });
    setKeys(map);
  }

  async function createAssignment() {
    if (!newTitle.trim() || !classId) return;
    setBusy(true);
    setErrorMsg("");
    const { data: me } = await supabase.auth.getUser();
    if (!me.user) { setBusy(false); setErrorMsg("Phiên đăng nhập đã hết hạn."); return; }
    const { data, error } = await supabase
      .from("assignments")
      .insert({
        class_id: classId, title: newTitle.trim(),
        due_at: due ? new Date(due).toISOString() : null,
        created_by: me.user.id,
      })
      .select("id, title, due_at, status").single();
    setBusy(false);
    if (error) { setErrorMsg(error.message); return; }
    setNewTitle(""); setDue("");
    if (data) { setAssignments((prev) => [data, ...prev]); void open(data); }
  }

  async function publish(a: Asg) {
    setBusy(true);
    setErrorMsg("");
    const { error } = await supabase.from("assignments").update({ status: "published" }).eq("id", a.id);
    setBusy(false);
    if (error) { setErrorMsg(error.message); return; }
    setAssignments((list) => list.map((x) => (x.id === a.id ? { ...x, status: "published" } : x)));
    if (active?.id === a.id) setActive({ ...a, status: "published" });
    alert("Đã phát hành bài tập cho sinh viên.");
  }

  async function saveQuestion() {
    if (!active || !prompt.trim()) {
      setErrorMsg("Cần nhập đề bài.");
      return;
    }
    if (kind !== "essay" && !answerKey.trim()) {
      setErrorMsg("Cần nhập đáp án đúng cho câu hỏi này.");
      return;
    }
    if (kind === "essay" && !answerKey.trim() && !criteria.trim()) {
      setErrorMsg("Câu tự luận cần ít nhất đáp án mẫu hoặc tiêu chí công khai.");
      return;
    }

    let parsedOptions: { key: string; label: string }[] = [];
    if (kind === "mcq") {
      parsedOptions = options
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [k, ...rest] = line.split(".");
          return { key: k.trim(), label: rest.join(".").trim() };
        })
        .filter((o) => o.key && o.label);
      if (parsedOptions.length < 2) {
        setErrorMsg("Câu trắc nghiệm cần ít nhất 2 lựa chọn hợp lệ (VD: A. Nội dung).");
        return;
      }
    }

    let parsedHints: any[] = [];
    try {
      const parsed = JSON.parse(hints);
      if (!Array.isArray(parsed)) throw new Error();
      parsedHints = parsed;
    } catch {
      setErrorMsg("Bậc gợi ý phải là mảng JSON hợp lệ.");
      return;
    }

    setBusy(true);
    setErrorMsg("");
    try {
      const data = await apiFetch("/api/lecturer/questions", {
        method: "POST",
        body: JSON.stringify({
          assignmentId: active.id,
          prompt: prompt.trim(),
          kind,
          options: parsedOptions,
          answerKey: answerKey.trim(),
          hintLadder: parsedHints,
          publicCriteria: criteria.trim(),
          maxScore: 10,
        }),
      });
      setQuestions((prev) => [...prev, data.question]);
      setKeys((prev) => ({ ...prev, [data.question.id]: data.keyMeta }));
      setPrompt("");
      setAnswerKey("");
      setCriteria("");
      setHints("[]");
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Bài tập"
        description="Tạo bài tập nháp, thêm câu hỏi, khóa đáp án vào vùng kín và phát hành cho lớp."
      />
      {errorMsg && (
        <div style={{ background: "var(--color-sealed-bg)", color: "var(--color-sealed-fg)", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          {errorMsg}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
        <select className="input" style={{ width: 280 }} value={classId} onChange={(e) => setClassId(e.target.value)}>
          {classes.length === 0 && <option value="">(chưa có lớp)</option>}
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input className="input" style={{ width: 260 }} placeholder="Tên bài tập mới" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
        <input className="input" style={{ width: 170 }} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        <button className="btn btn-primary" onClick={() => void createAssignment()} disabled={busy || !newTitle.trim() || !classId}>+ Tạo bài tập</button>
      </div>

      <table className="tbl" style={{ background: "var(--color-surface)", border: "1px solid var(--color-line)", borderRadius: 10, overflow: "hidden", marginBottom: 24 }}>
        <thead><tr><th>Bài tập</th><th>Hạn nộp</th><th>Trạng thái</th><th></th></tr></thead>
        <tbody>
          {assignments.length === 0 && <tr><td colSpan={4} style={{ color: "var(--color-muted)" }}>Lớp này chưa có bài tập nào.</td></tr>}
          {assignments.map((a) => (
            <tr key={a.id} style={{ cursor: "pointer" }} onClick={() => void open(a)}>
              <td style={{ fontWeight: a.id === active?.id ? 600 : 400 }}>{a.title}</td>
              <td className="tnum">{a.due_at ? new Date(a.due_at).toLocaleString("vi-VN") : "—"}</td>
              <td>
                <span className={`pill ${a.status === "published" ? "pill-success" : "pill-neutral"}`}>
                  {a.status === "published" ? "Đã phát hành" : "Nháp"}
                </span>
              </td>
              <td>
                {a.status === "draft" && (
                  <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); void publish(a); }}>Phát hành</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {active && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 20, alignItems: "start" }}>
          <div className="card">
            <div className="card-h">
              <span className="card-title">Câu hỏi — {active.title}</span>
              <span className="pill pill-sealed">Đáp án khóa vùng kín</span>
            </div>
            <div className="card-b">
              <div style={{ marginBottom: 14 }}>
                <label className="label">Đề bài (hỗ trợ biến thể {"{{v0}}"} và LaTeX)</label>
                <textarea className="input" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <div>
                  <label className="label">Chế độ chấm</label>
                  <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
                    {KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}
                  </select>
                </div>
                {kind === "mcq" && (
                  <div>
                    <label className="label">Các lựa chọn (mỗi dòng &quot;A. nội dung&quot;)</label>
                    <textarea className="input" rows={2} value={options} onChange={(e) => setOptions(e.target.value)} />
                  </div>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <div>
                  <label className="label">
                    {kind === "essay" ? "Đáp án mẫu (tuỳ chọn, mã hóa AES)" : "Đáp án đúng (mã hóa AES trên server)"}
                  </label>
                  <input className="input" value={answerKey} onChange={(e) => setAnswerKey(e.target.value)} placeholder="VD: A hoặc 6.96 s" />
                </div>
                <div>
                  <label className="label">Tiêu chí công khai (cho tự luận)</label>
                  <input className="input" value={criteria} onChange={(e) => setCriteria(e.target.value)} />
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label className="label">Bậc gợi ý (JSON: [{"{level, content, unlock_after, penalty}"}])</label>
                <textarea className="input" rows={2} value={hints} onChange={(e) => setHints(e.target.value)}
                  placeholder='[{"level":1,"content":"Chu kỳ phụ thuộc đại lượng nào?","unlock_after":1,"penalty":0}]' />
              </div>
              <button className="btn btn-primary" onClick={() => void saveQuestion()} disabled={busy}>
                {busy ? "Đang lưu..." : "Lưu câu hỏi"}
              </button>

              {questions.length > 0 && (
                <table className="tbl" style={{ marginTop: 20 }}>
                  <thead><tr><th>#</th><th>Đề bài</th><th>Chế độ</th><th>Đáp án</th></tr></thead>
                  <tbody>
                    {questions.map((q) => {
                      const k = keys[q.id];
                      const locked = Boolean(k?.locked || k?.encrypted);
                      return (
                        <tr key={q.id}>
                          <td className="tnum">{q.position}</td>
                          <td>{q.prompt.length > 60 ? `${q.prompt.slice(0, 60)}...` : q.prompt}</td>
                          <td>{KINDS.find((x) => x.v === q.kind)?.label}</td>
                          <td>{locked ? "Đã khóa" : k ? "Theo tiêu chí" : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-h"><span className="card-title">Nhắc lại quy tắc</span></div>
            <div className="card-b" style={{ fontSize: 13, color: "var(--color-muted)" }}>
              <p style={{ marginBottom: 8 }}>Đáp án được mã hóa AES-256-GCM phía server trước khi lưu; chỉ API chấm bài phía server giải mã.</p>
              <p style={{ marginBottom: 8 }}>Sinh viên không bao giờ nhận được đáp án — kể cả qua feedback của LLM.</p>
              <p>Các mục tài liệu đánh dấu &quot;Đáp án&quot; khi duyệt cũng nằm ngoài tầm với của sinh viên.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
