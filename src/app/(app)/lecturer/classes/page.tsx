"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/AppShell";

type Course = { id: string; code: string; title: string };
type Cls = { id: string; name: string; course_id: string };
type Enroll = { id: string; user_id: string; class_id: string };
type Profile = { id: string; full_name: string; role: string };
type Doc = { id: string; title: string; course_id: string | null; visibility: string; status: string };

export default function ClassesPage() {
  const supabase = createClient();
  const [courses, setCourses] = useState<Course[]>([]);
  const [classes, setClasses] = useState<Cls[]>([]);
  const [enrolls, setEnrolls] = useState<Enroll[]>([]);
  const [students, setStudents] = useState<Profile[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);

  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [className, setClassName] = useState("");
  const [courseForClass, setCourseForClass] = useState("");
  const [enrollClass, setEnrollClass] = useState("");
  const [enrollStudent, setEnrollStudent] = useState("");
  const [docTargetClass, setDocTargetClass] = useState("");
  const [selectedDocId, setSelectedDocId] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [noticeMsg, setNoticeMsg] = useState("");

  async function load() {
    const [
      { data: cs, error: e1 },
      { data: cls, error: e2 },
      { data: en, error: e3 },
      { data: ds, error: e4 },
    ] = await Promise.all([
      supabase.from("courses").select("id, code, title").order("created_at", { ascending: false }),
      supabase.from("classes").select("id, name, course_id").order("created_at", { ascending: false }),
      supabase.from("enrollments").select("id, user_id, class_id"),
      supabase.from("documents").select("id, title, course_id, visibility, status").order("created_at", { ascending: false }),
    ]);
    if (e1 || e2 || e3 || e4) {
      setErrorMsg(e1?.message || e2?.message || e3?.message || e4?.message || "Lỗi tải dữ liệu.");
    }
    setCourses(cs ?? []);
    setClasses(cls ?? []);
    setEnrolls(en ?? []);
    setDocs(ds ?? []);
    setCourseForClass((prev) =>
      prev && cs?.some((c) => c.id === prev) ? prev : cs?.[0]?.id ?? ""
    );
    setEnrollClass((prev) =>
      prev && cls?.some((c) => c.id === prev) ? prev : cls?.[0]?.id ?? ""
    );
    setDocTargetClass((prev) =>
      prev && cls?.some((c) => c.id === prev) ? prev : cls?.[0]?.id ?? ""
    );
    setSelectedDocId((prev) =>
      prev && ds?.some((d) => d.id === prev) ? prev : ds?.[0]?.id ?? ""
    );
  }

  useEffect(() => {
    (async () => {
      await load();
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, role")
        .eq("role", "student");
      if (error) setErrorMsg(error.message);
      setStudents(data ?? []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createCourse() {
    if (!code.trim() || !title.trim()) return;
    setBusy(true);
    setErrorMsg("");
    setNoticeMsg("");
    const { data: me } = await supabase.auth.getUser();
    if (!me.user) { setBusy(false); setErrorMsg("Phiên đăng nhập đã hết hạn."); return; }
    const { error } = await supabase
      .from("courses")
      .insert({ code: code.trim(), title: title.trim(), created_by: me.user.id });
    setBusy(false);
    if (error) { setErrorMsg(error.message); return; }
    setCode(""); setTitle("");
    await load();
  }

  async function createClass() {
    if (!className.trim() || !courseForClass) return;
    setBusy(true);
    setErrorMsg("");
    setNoticeMsg("");
    const { data: me } = await supabase.auth.getUser();
    if (!me.user) { setBusy(false); setErrorMsg("Phiên đăng nhập đã hết hạn."); return; }
    const { error } = await supabase
      .from("classes")
      .insert({ name: className.trim(), course_id: courseForClass, created_by: me.user.id });
    setBusy(false);
    if (error) { setErrorMsg(error.message); return; }
    setClassName("");
    await load();
  }

  async function enroll() {
    if (!enrollClass || !enrollStudent) return;
    setBusy(true);
    setErrorMsg("");
    setNoticeMsg("");
    const { error } = await supabase
      .from("enrollments")
      .insert({ class_id: enrollClass, user_id: enrollStudent });
    setBusy(false);
    if (error) {
      setErrorMsg(
        error.code === "23505"
          ? "Sinh viên này đã được ghi danh vào lớp."
          : error.message
      );
      return;
    }
    setEnrollStudent("");
    await load();
  }

  async function unroll(id: string) {
    setErrorMsg("");
    setNoticeMsg("");
    const { data, error } = await supabase
      .from("enrollments")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    if (!data || data.length === 0) {
      setErrorMsg("Không xóa được ghi danh (kiểm tra lại policy DELETE trên bảng enrollments).");
      return;
    }
    await load();
  }

  async function attachDocToClass() {
    const targetCls = classes.find((c) => c.id === docTargetClass);
    const targetDoc = docs.find((d) => d.id === selectedDocId);
    if (!targetCls || !targetDoc) return;
    setBusy(true);
    setErrorMsg("");
    setNoticeMsg("");
    const { error } = await supabase
      .from("documents")
      .update({ course_id: targetCls.course_id, visibility: "course" })
      .eq("id", targetDoc.id);
    setBusy(false);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    const crs = courseById[targetCls.course_id];
    setNoticeMsg(
      `Đã gắn tài liệu "${targetDoc.title}" vào môn ${crs?.code ?? ""} (áp dụng cho lớp ${targetCls.name}).`
    );
    await load();
  }

  const courseById = Object.fromEntries(courses.map((c) => [c.id, c]));

  return (
    <div>
      <PageHeader
        title="Môn học & Lớp"
        description="Tạo môn học, lớp, ghi danh sinh viên và gắn tài liệu theo môn học của lớp."
      />
      {errorMsg && (
        <div style={{ background: "var(--color-sealed-bg)", color: "var(--color-sealed-fg)", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          {errorMsg}
        </div>
      )}
      {noticeMsg && (
        <div style={{ background: "var(--color-success-bg)", color: "var(--color-success-fg)", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          {noticeMsg}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 20 }}>
          <div className="card">
            <div className="card-h"><span className="card-title">Tạo môn học</span></div>
            <div className="card-b">
              <div style={{ display: "flex", gap: 10 }}>
                <input className="input" style={{ width: 120 }} placeholder="Mã môn (PHY101)" value={code} onChange={(e) => setCode(e.target.value)} />
                <input className="input" style={{ flex: 1 }} placeholder="Tên môn (Vật lý 1)" value={title} onChange={(e) => setTitle(e.target.value)} />
                <button className="btn btn-primary" onClick={() => void createCourse()} disabled={busy}>Tạo</button>
              </div>
              {courses.length > 0 && (
                <table className="tbl" style={{ marginTop: 16 }}>
                  <thead><tr><th>Mã</th><th>Tên môn</th><th>Số lớp</th></tr></thead>
                  <tbody>
                    {courses.map((c) => (
                      <tr key={c.id}>
                        <td style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{c.code}</td>
                        <td style={{ fontWeight: 600 }}>{c.title}</td>
                        <td className="tnum">{classes.filter((cl) => cl.course_id === c.id).length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-h"><span className="card-title">Tạo lớp</span></div>
            <div className="card-b">
              <div style={{ display: "flex", gap: 10 }}>
                <select className="input" style={{ width: 200 }} value={courseForClass} onChange={(e) => setCourseForClass(e.target.value)}>
                  {courses.length === 0 && <option value="">— chưa có môn học —</option>}
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}
                </select>
                <input className="input" style={{ flex: 1 }} placeholder="Tên lớp (PHY101-01)" value={className} onChange={(e) => setClassName(e.target.value)} />
                <button className="btn btn-primary" onClick={() => void createClass()} disabled={busy || !courseForClass || !className.trim()}>Tạo</button>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 20 }}>
          <div className="card">
            <div className="card-h"><span className="card-title">Ghi danh sinh viên</span></div>
            <div className="card-b">
              <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                <select className="input" style={{ width: 200 }} value={enrollClass} onChange={(e) => setEnrollClass(e.target.value)}>
                  {classes.length === 0 && <option value="">— chưa có lớp —</option>}
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select className="input" style={{ flex: 1 }} value={enrollStudent} onChange={(e) => setEnrollStudent(e.target.value)}>
                  <option value="">— chọn sinh viên —</option>
                  {students.map((s) => <option key={s.id} value={s.id}>{s.full_name || s.id.slice(0, 8)}</option>)}
                </select>
                <button className="btn btn-primary" onClick={() => void enroll()} disabled={busy || !enrollClass || !enrollStudent}>Ghi danh</button>
              </div>
              {classes.length === 0 && (
                <div style={{ fontSize: 12.5, color: "var(--color-warn-fg)", background: "var(--color-warn-bg)", borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
                  Hiện chưa có lớp học nào. Hãy tạo ít nhất 1 lớp ở khung &quot;Tạo lớp&quot; bên trái rồi chọn lớp để ghi danh sinh viên.
                </div>
              )}

              {classes.length > 0 && (
                <table className="tbl">
                  <thead><tr><th>Lớp</th><th>Sinh viên</th><th></th></tr></thead>
                  <tbody>
                    {classes.map((cl) => {
                      const members = enrolls.filter((e) => e.class_id === cl.id);
                      return members.length === 0 ? (
                        <tr key={cl.id}>
                          <td style={{ fontWeight: 600 }}>{cl.name}</td>
                          <td colSpan={2} style={{ color: "var(--color-muted)" }}>Chưa có sinh viên</td>
                        </tr>
                      ) : members.map((m, i) => {
                        const s = students.find((x) => x.id === m.user_id);
                        return (
                          <tr key={m.id}>
                            {i === 0 && <td rowSpan={members.length} style={{ fontWeight: 600, verticalAlign: "top" }}>{cl.name}<div style={{ fontSize: 11, color: "var(--color-muted)" }}>{courseById[cl.course_id]?.code}</div></td>}
                            <td>{s?.full_name || m.user_id.slice(0, 8)}</td>
                            <td style={{ width: 70 }}>
                              <button className="btn btn-sm" onClick={() => void unroll(m.id)}>Xóa</button>
                            </td>
                          </tr>
                        );
                      });
                    })}
                  </tbody>
                </table>
              )}
              {students.length === 0 && (
                <div style={{ fontSize: 12.5, color: "var(--color-muted)" }}>
                  Danh sách sinh viên rỗng — policy đọc profiles chỉ cho thấy SV cùng lớp hoặc khi đã áp dụng policy cho giảng viên.
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-h">
              <span className="card-title">Tài liệu của lớp</span>
              <span className="pill pill-neutral">Liên kết theo Môn học</span>
            </div>
            <div className="card-b">
              <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                <select className="input" style={{ width: 180 }} value={docTargetClass} onChange={(e) => setDocTargetClass(e.target.value)}>
                  {classes.length === 0 && <option value="">— chưa có lớp —</option>}
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select className="input" style={{ flex: 1 }} value={selectedDocId} onChange={(e) => setSelectedDocId(e.target.value)}>
                  {docs.length === 0 && <option value="">— chưa có tài liệu —</option>}
                  {docs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                </select>
                <button
                  className="btn btn-primary"
                  onClick={() => void attachDocToClass()}
                  disabled={busy || !docTargetClass || !selectedDocId}
                >
                  Gắn vào lớp
                </button>
              </div>
              <div style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 12 }}>
                Tài liệu gắn với Môn học của lớp; mọi lớp thuộc cùng môn học sẽ tự động dùng chung tài liệu đó.
              </div>
              {classes.length > 0 && (
                <table className="tbl">
                  <thead><tr><th>Lớp</th><th>Tài liệu áp dụng</th></tr></thead>
                  <tbody>
                    {classes.map((cl) => {
                      const matched = docs.filter(
                        (d) => d.visibility === "center" || d.course_id === cl.course_id
                      );
                      return (
                        <tr key={cl.id}>
                          <td style={{ fontWeight: 600, verticalAlign: "top" }}>
                            {cl.name}
                            <div style={{ fontSize: 11, color: "var(--color-muted)" }}>
                              {courseById[cl.course_id]?.code}
                            </div>
                          </td>
                          <td>
                            {matched.length === 0 ? (
                              <span style={{ color: "var(--color-muted)" }}>Chưa có tài liệu nào</span>
                            ) : (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                {matched.map((d) => (
                                  <span
                                    key={d.id}
                                    className={`pill ${d.status === "published" ? "pill-success" : "pill-warn"}`}
                                  >
                                    {d.title}
                                    {d.visibility === "center" ? " (Trung tâm)" : ""}
                                    {d.status !== "published" ? " · chờ duyệt" : ""}
                                  </span>
                                ))}
                              </div>
                            )}
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
      </div>
    </div>
  );
}
