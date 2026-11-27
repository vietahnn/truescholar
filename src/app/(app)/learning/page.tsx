"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/AppShell";

type SkillRow = { id: string; skill: string; attempts: number; avg_score: number; mastery: number };

export default function LearningPage() {
  const supabase = createClient();
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [error, setError] = useState("");

  // MVP: mastery suy ra từ attempts — avg_score/max_score, làm tròn.
  // Đầy đủ BKT (p_init, p_learn, p_slip, p_guess) sẽ thêm khi có bảng skills.
  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: at, error: err } = await supabase
        .from("attempts")
        .select("question_id, score, graded, questions(max_score, prompt)")
        .eq("user_id", user.id);

      if (err) {
        setError(err.message);
        return;
      }

      // MVP rút gọn: nhóm theo question_id để tránh trùng tiền tố đề bài
      const map: Record<string, { label: string; sum: number; n: number; max: number }> = {};
      (at ?? []).forEach((x: any) => {
        if (x.score == null || !x.question_id) return;
        const prompt = String(x.questions?.prompt ?? "?");
        const label = prompt.length > 60 ? `${prompt.slice(0, 60)}...` : prompt;
        map[x.question_id] ??= { label, sum: 0, n: 0, max: Number(x.questions?.max_score ?? 10) };
        map[x.question_id].sum += Number(x.score);
        map[x.question_id].n += 1;
      });
      setSkills(
        Object.entries(map).map(([id, v]) => ({
          id,
          skill: v.label,
          attempts: v.n,
          avg_score: Math.round((v.sum / v.n) * 10) / 10,
          mastery: v.max > 0 ? Math.min(1, Math.max(0, v.sum / (v.n * v.max))) : 0,
        }))
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <PageHeader
        title="Học tập"
        description="Theo dõi mức nắm vững từng câu hỏi đã luyện và kết quả chấm."
      />
      {error && (
        <div style={{ background: "var(--color-sealed-bg)", color: "var(--color-sealed-fg)", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}
      <div className="card">
        <div className="card-h">
          <span className="card-title">Tiến độ luyện tập</span>
          <span className="pill pill-neutral">Phiên bản rút gọn của BKT</span>
        </div>
        <div className="card-b">
          {skills.length === 0 && (
            <div style={{ color: "var(--color-muted)", fontSize: 13.5 }}>
              Chưa có dữ liệu. Hãy làm bài tập trước để xem tiến độ.
            </div>
          )}
          {skills.map((s, idx) => (
            <div
              key={s.id}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16,
                padding: "12px 0",
                borderBottom: idx === skills.length - 1 ? "none" : "1px solid var(--color-line)",
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{s.skill}</div>
                <div style={{ fontSize: 12, color: "var(--color-muted)" }} className="tnum">
                  {s.attempts} lượt · điểm TB {s.avg_score}
                </div>
              </div>
              <div style={{ width: 200 }}>
                <div className="bar"><div style={{ width: `${Math.round(s.mastery * 100)}%` }} /></div>
                <div style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 3 }} className="tnum">
                  {Math.round(s.mastery * 100)}% nắm vững
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
