"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/AppShell";

type Assignment = { id: string; title: string; description: string; due_at: string | null; max_attempts: number };
type HintItem = { level: number; content: string; unlock_after: number; penalty: number };
type Question = {
  id: string; position: number; prompt: string; kind: string;
  options: { key: string; label: string }[]; max_score: number;
  hint_ladder?: HintItem[];
  public_criteria?: string;
};
type Attempt = { question_id: string; score: number | null; graded: any; answer: string };

export default function AssignmentsPage() {
  const supabase = createClient();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [active, setActive] = useState<Assignment | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [attempts, setAttempts] = useState<Record<string, Attempt[]>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [unlockedHints, setUnlockedHints] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [result, setResult] = useState<Record<string, any>>({});

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("assignments")
        .select("id, title, description, due_at, max_attempts")
        .eq("status", "published")
        .order("due_at", { ascending: true });
      if (error) {
        setLoadError(error.message);
        return;
      }
      setAssignments(data ?? []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function open(a: Assignment) {
    setActive(a);
    setLoadError("");
    try {
      const [qJson, authRes] = await Promise.all([
        apiFetch(`/api/assignments/questions?assignmentId=${encodeURIComponent(a.id)}`),
        supabase.auth.getUser(),
      ]);

      const qs: Question[] = (qJson.questions ?? []).map((q: Question) => ({
        ...q,
        hint_ladder: [...(q.hint_ladder ?? [])].sort((x, y) => x.level - y.level),
      }));
      setQuestions(qs);

      const userId = authRes.data.user?.id;
      const questionIds = qs.map((q) => q.id);
      if (!userId || questionIds.length === 0) {
        setAttempts({});
        setResult({});
        return;
      }

      const { data: at, error: atErr } = await supabase
        .from("attempts")
        .select("question_id, score, graded, answer")
        .eq("user_id", userId)
        .in("question_id", questionIds)
        .order("created_at", { ascending: true });

      if (atErr) throw atErr;

      const byQ: Record<string, Attempt[]> = {};
      const latestResult: Record<string, any> = {};
      (at ?? []).forEach((x: Attempt) => {
        (byQ[x.question_id] ??= []).push(x);
        latestResult[x.question_id] = {
          score: x.score,
          correct: x.graded?.correct,
          feedback: x.graded?.feedback,
        };
      });
      setAttempts(byQ);
      setResult(latestResult);
    } catch (err: any) {
      setLoadError(err.message || "Không thể mở bài tập.");
      setQuestions([]);
    }
  }

  async function submit(q: Question) {
    const answer = answers[q.id]?.trim();
    if (!answer) return;
    setBusy(q.id);
    try {
      const data = await apiFetch("/api/submit", {
        method: "POST",
        body: JSON.stringify({ questionId: q.id, answer }),
      });
      setResult((r) => ({ ...r, [q.id]: data }));
      setAttempts((prev) => ({
        ...prev,
        [q.id]: [...(prev[q.id] ?? []), { question_id: q.id, score: data.score, graded: data, answer }],
      }));
    } catch (err: any) {
      setResult((r) => ({ ...r, [q.id]: { error: err.message } }));
    } finally {
      setBusy(null);
    }
  }

  function unlockHint(q: Question) {
    const ladder = q.hint_ladder ?? [];
    const cur = unlockedHints[q.id] ?? 0;
    if (cur < ladder.length) setUnlockedHints((h) => ({ ...h, [q.id]: cur + 1 }));
  }

  return (
    <div>
      <PageHeader
        title="Bài tập của tôi"
        description="Xem đề bài, mở gợi ý theo bậc, nộp bài chính thức và theo dõi kết quả chấm."
      />
      {loadError && (
        <div style={{ background: "var(--color-sealed-bg)", color: "var(--color-sealed-fg)", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          {loadError}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20, alignItems: "start" }}>
        <div className="card">
          <div className="card-h"><span className="card-title" style={{ fontSize: 13 }}>Danh sách bài tập</span></div>
          <div style={{ padding: 8 }}>
            {assignments.length === 0 && (
              <div style={{ padding: 12, fontSize: 13, color: "var(--color-muted)" }}>
                Chưa có bài tập nào được giao.
              </div>
            )}
            {assignments.map((a) => (
              <button
                key={a.id}
                onClick={() => void open(a)}
                className="btn"
                style={{
                  display: "block", width: "100%", textAlign: "left", border: "none",
                  background: a.id === active?.id ? "var(--color-accent-tint)" : "transparent",
                  color: a.id === active?.id ? "var(--color-accent)" : "var(--color-ink)",
                  fontWeight: a.id === active?.id ? 600 : 400, marginBottom: 2,
                }}
              >
                {a.title}
                <div style={{ fontSize: 11, color: "var(--color-muted)", fontWeight: 400 }}>
                  {a.due_at && <span className="tnum">Hạn: {new Date(a.due_at).toLocaleDateString("vi-VN")}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          {!active && (
            <div className="card card-b" style={{ color: "var(--color-muted)" }}>
              Chọn một bài tập ở danh sách để bắt đầu làm bài.
            </div>
          )}
          {active && questions.length === 0 && !loadError && (
            <div className="card card-b" style={{ color: "var(--color-muted)" }}>
              Bài tập này chưa có câu hỏi nào.
            </div>
          )}
          {active && questions.map((q) => {
            const used = attempts[q.id]?.length ?? 0;
            const r = result[q.id];
            const hints = q.hint_ladder ?? [];
            const unlocked = unlockedHints[q.id] ?? 0;
            return (
              <div className="card" key={q.id} style={{ marginBottom: 16 }}>
                <div className="card-h">
                  <div>
                    <span className="card-title">Câu {q.position}</span>
                    <div style={{ fontSize: 12, color: "var(--color-muted)" }} className="tnum">
                      Đã nộp {used}/{active.max_attempts} lượt · Điểm tối đa: {q.max_score}
                      {q.kind === "mcq" && " · Trắc nghiệm"}
                    </div>
                  </div>
                  {used > 0 && r?.correct != null && (
                    <span className={`pill ${r.correct ? "pill-success" : "pill-sealed"}`}>
                      {r.correct ? "Chính xác" : "Chưa chính xác"}
                    </span>
                  )}
                </div>
                <div className="card-b">
                  <div style={{ whiteSpace: "pre-wrap", marginBottom: 14 }}>{q.prompt}</div>
                  {q.public_criteria && (
                    <div style={{ fontSize: 12.5, color: "var(--color-muted)", marginBottom: 12 }}>
                      <b>Tiêu chí:</b> {q.public_criteria}
                    </div>
                  )}

                  {q.kind === "mcq" ? (
                    <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
                      {(q.options ?? []).map((o) => (
                        <button
                          key={o.key}
                          onClick={() => setAnswers((a) => ({ ...a, [q.id]: o.key }))}
                          style={{
                            textAlign: "left", padding: "10px 14px", borderRadius: 8,
                            border: answers[q.id] === o.key ? "2px solid var(--color-accent)" : "1px solid var(--color-line)",
                            background: answers[q.id] === o.key ? "var(--color-accent-tint)" : "var(--color-surface)",
                            font: "inherit", cursor: "pointer",
                          }}
                        >
                          {o.key}. {o.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <textarea
                      className="input"
                      rows={2}
                      placeholder="Nhập câu trả lời (số kèm đơn vị, biểu thức...)"
                      value={answers[q.id] ?? ""}
                      onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                      style={{ marginBottom: 14 }}
                    />
                  )}

                  {hints.length > 0 && (
                    <div style={{ background: "var(--color-recessed)", borderRadius: 8, padding: 14, marginBottom: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                        <b style={{ fontSize: 13 }}>Gợi ý theo bậc</b>
                        <span style={{ fontSize: 12, color: "var(--color-muted)" }} className="tnum">
                          Đã mở {unlocked}/{hints.length} bậc
                        </span>
                      </div>
                      {hints.slice(0, unlocked).map((h) => (
                        <div key={h.level} style={{ fontSize: 13, color: "var(--color-muted)", marginBottom: 8 }}>
                          <span className="pill pill-neutral">Bậc {h.level}</span> · {h.content}
                          {h.penalty > 0 && <span style={{ color: "var(--color-warn-fg)" }}> (trừ {h.penalty} điểm)</span>}
                        </div>
                      ))}
                      {unlocked < hints.length && (
                        <button className="btn btn-sm" onClick={() => unlockHint(q)}>
                          Mở gợi ý tiếp theo
                          {hints[unlocked].penalty > 0 && (
                            <span style={{ color: "var(--color-warn-fg)" }}> (trừ {hints[unlocked].penalty} điểm)</span>
                          )}
                        </button>
                      )}
                    </div>
                  )}

                  {r?.feedback && (
                    <div style={{ background: "var(--color-accent-tint)", borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 13.5 }}>
                      <b>Kết quả chấm:</b> {r.score != null && <span className="tnum">{r.score}/{q.max_score} · </span>}{r.feedback}
                    </div>
                  )}
                  {r?.error && (
                    <div style={{ background: "var(--color-sealed-bg)", color: "var(--color-sealed-fg)", borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 13 }}>
                      {r.error}
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: "var(--color-muted)" }}>
                      Mỗi lần nộp tính vào giới hạn lượt của bài tập.
                    </span>
                    <button
                      className="btn btn-primary"
                      disabled={busy === q.id || used >= active.max_attempts || !answers[q.id]?.trim()}
                      onClick={() => void submit(q)}
                    >
                      {busy === q.id ? "Đang nộp..." : "Nộp bài chính thức"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
