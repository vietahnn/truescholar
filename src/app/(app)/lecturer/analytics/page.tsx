"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/AppShell";

type Row = { id: string; title: string; attempts: number; correct: number; avg: number };

export default function AnalyticsPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState({ attempts: 0, avgScore: 0 });
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data: at, error: err } = await supabase
        .from("attempts")
        .select("score, graded, questions(prompt, max_score, assignment_id, assignments(id, title))");
      if (err) {
        setError(err.message);
        return;
      }

      const map: Record<string, { title: string; n: number; scored: number; correct: number; sum: number }> = {};
      let totalSum = 0;
      let totalScored = 0;
      let totalAttempts = 0;

      (at ?? []).forEach((x: any) => {
        const asgId = x.questions?.assignment_id ?? x.questions?.assignments?.id ?? "unknown";
        const title = x.questions?.assignments?.title ?? "?";
        map[asgId] ??= { title, n: 0, scored: 0, correct: 0, sum: 0 };
        map[asgId].n += 1;
        totalAttempts += 1;
        if (x.score != null) {
          map[asgId].sum += Number(x.score);
          map[asgId].scored += 1;
          totalSum += Number(x.score);
          totalScored += 1;
          if (x.graded?.correct) map[asgId].correct += 1;
        }
      });

      setRows(
        Object.entries(map).map(([id, v]) => ({
          id,
          title: v.title,
          attempts: v.n,
          correct: v.correct,
          avg: v.scored ? Math.round((v.sum / v.scored) * 10) / 10 : 0,
        }))
      );
      setTotals({
        attempts: totalAttempts,
        avgScore: totalScored ? Math.round((totalSum / totalScored) * 10) / 10 : 0,
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <PageHeader
        title="Phân tích lớp"
        description="Kết quả làm bài của sinh viên theo bài tập."
      />
      {error && (
        <div style={{ background: "var(--color-sealed-bg)", color: "var(--color-sealed-fg)", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 220px)", gap: 16, marginBottom: 24 }}>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontSize: 12, color: "var(--color-muted)" }}>Tổng lượt nộp</div>
          <div style={{ fontSize: 26, fontWeight: 700 }} className="tnum">{totals.attempts}</div>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontSize: 12, color: "var(--color-muted)" }}>Điểm trung bình</div>
          <div style={{ fontSize: 26, fontWeight: 700 }} className="tnum">{totals.avgScore}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-h"><span className="card-title">Theo bài tập</span></div>
        <table className="tbl">
          <thead><tr><th>Bài tập</th><th>Lượt nộp</th><th>Số câu đúng</th><th>Điểm TB</th><th>Tỉ lệ đúng</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} style={{ color: "var(--color-muted)" }}>Chưa có dữ liệu nộp bài.</td></tr>}
            {rows.map((r) => {
              const pct = r.attempts ? Math.round((r.correct / r.attempts) * 100) : 0;
              return (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.title}</td>
                  <td className="tnum">{r.attempts}</td>
                  <td className="tnum">{r.correct}</td>
                  <td className="tnum">{r.avg}</td>
                  <td style={{ width: 220 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div className="bar" style={{ flex: 1 }}><div style={{ width: `${pct}%` }} /></div>
                      <span className="tnum" style={{ width: 44, textAlign: "right", fontWeight: 600 }}>{pct}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
