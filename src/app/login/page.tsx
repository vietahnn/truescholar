"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [role, setRole] = useState<"student" | "lecturer">("student");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "signup") {
        const cleanName = name.trim();
        if (!cleanName) {
          throw new Error("Vui lòng nhập họ tên.");
        }
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: cleanName, role } },
        });
        if (error) throw error;
        // Nếu Supabase tắt confirm email → có session ngay, vào thẳng app
        if (data.session) {
          router.push("/");
          router.refresh();
          return;
        }
        setError("Đã gửi email xác nhận. Sau khi xác nhận hãy đăng nhập.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push("/");
        router.refresh();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <div style={{ width: 400 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28, justifyContent: "center" }}>
          <div
            style={{
              width: 36, height: 36, borderRadius: 8,
              background: "var(--color-accent)", color: "#fff",
              display: "grid", placeItems: "center", fontWeight: 700, fontSize: 17,
            }}
          >
            T
          </div>
          <span style={{ fontSize: 18, fontWeight: 600 }}>TrueScholar</span>
        </div>

        <div className="card">
          <div className="card-h">
            <span className="card-title">{mode === "signin" ? "Đăng nhập" : "Đăng ký"}</span>
            <button
              className="btn btn-sm"
              onClick={() => {
                setError("");
                setMode(mode === "signin" ? "signup" : "signin");
              }}
            >
              {mode === "signin" ? "Chưa có tài khoản" : "Đã có tài khoản"}
            </button>
          </div>
          <div className="card-b">
            <form onSubmit={submit}>
              {mode === "signup" && (
                <>
                  <div className="field" style={{ marginBottom: 14 }}>
                    <label className="label">Họ tên</label>
                    <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label className="label">Vai trò</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" className={`btn btn-sm ${role === "student" ? "btn-primary" : ""}`}
                        onClick={() => setRole("student")}>Sinh viên</button>
                      <button type="button" className={`btn btn-sm ${role === "lecturer" ? "btn-primary" : ""}`}
                        onClick={() => setRole("lecturer")}>Giảng viên</button>
                    </div>
                  </div>
                </>
              )}
              <div style={{ marginBottom: 14 }}>
                <label className="label">Email</label>
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label className="label">Mật khẩu</label>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
              </div>
              {error && (
                <div style={{
                  background: "var(--color-sealed-bg)", color: "var(--color-sealed-fg)",
                  borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 14,
                }}>
                  {error}
                </div>
              )}
              <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy}>
                {busy ? "Đang xử lý..." : mode === "signin" ? "Đăng nhập" : "Đăng ký"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
