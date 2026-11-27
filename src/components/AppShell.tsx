// App shell: sidebar trái 230px cố định theo DESIGN_SYSTEM.md
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { apiFetch, type StudentOverview } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";

const NAV = {
  student: [
    { href: "/chat", label: "Trợ lý học thuật" },
    { href: "/knowledge", label: "Kho tri thức" },
    { href: "/assignments", label: "Bài tập của tôi" },
    { href: "/learning", label: "Học tập" },
  ],
  lecturer: [
    { href: "/lecturer/documents", label: "Tài liệu" },
    { href: "/lecturer/review", label: "Duyệt tài liệu" },
    { href: "/lecturer/classes", label: "Môn học & Lớp" },
    { href: "/lecturer/assignments", label: "Bài tập" },
    { href: "/lecturer/analytics", label: "Phân tích lớp" },
  ],
} as const;

export function AppShell({
  role,
  name,
  children,
}: {
  role: "student" | "lecturer" | "admin";
  name: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isStaff = role === "lecturer" || role === "admin";
  const items = NAV[isStaff ? "lecturer" : "student"] ?? [];
  const [overview, setOverview] = useState<StudentOverview | null>(null);

  useEffect(() => {
    if (isStaff) return;
    let cancelled = false;
    apiFetch<StudentOverview>("/api/student/overview")
      .then((data) => {
        if (!cancelled) setOverview(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isStaff, pathname]);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside
        style={{
          width: 230,
          flexShrink: 0,
          background: "var(--color-surface)",
          borderRight: "1px solid var(--color-line)",
          display: "flex",
          flexDirection: "column",
          position: "sticky",
          top: 0,
          height: "100vh",
        }}
      >
        <div style={{ padding: "16px 16px 12px", display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32, height: 32, borderRadius: 8,
              background: "var(--color-accent)", color: "#fff",
              display: "grid", placeItems: "center",
              fontWeight: 700, fontSize: 15,
            }}
          >
            T
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>TrueScholar</div>
            <span className={`pill ${isStaff ? "pill-warn" : "pill-accent"}`}>
              {role === "admin" ? "Quản trị" : role === "lecturer" ? "Giảng viên" : "Sinh viên"}
            </span>
          </div>
        </div>

        <nav style={{ padding: "8px", display: "flex", flexDirection: "column", gap: 2 }}>
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  textDecoration: "none",
                  color: active ? "var(--color-accent)" : "var(--color-ink)",
                  background: active ? "var(--color-accent-tint)" : "transparent",
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {!isStaff && overview && (
          <div
            style={{
              margin: "8px 12px",
              padding: "10px 12px",
              borderRadius: 8,
              background: "var(--color-recessed)",
              border: "1px solid var(--color-line)",
              fontSize: 12,
              overflowY: "auto",
            }}
          >
            <div style={{ fontWeight: 600, color: "var(--color-muted)", marginBottom: 4 }}>
              Lớp đang học ({overview.classes.length})
            </div>
            {overview.classes.length === 0 ? (
              <div style={{ color: "var(--color-muted)", marginBottom: 10 }}>Chưa ghi danh lớp nào</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 10 }}>
                {overview.classes.map((c) => (
                  <div key={c.id} style={{ color: "var(--color-ink)", fontWeight: 500 }}>
                    {c.name}
                    {c.course?.code && (
                      <span style={{ color: "var(--color-muted)", fontWeight: 400 }}> · {c.course.code}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{ fontWeight: 600, color: "var(--color-muted)", marginBottom: 4 }}>
              Tài liệu hiện có ({overview.documents.length})
            </div>
            {overview.documents.length === 0 ? (
              <div style={{ color: "var(--color-muted)" }}>Chưa có tài liệu nào</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {overview.documents.slice(0, 5).map((d) => (
                  <Link
                    key={d.id}
                    href="/knowledge"
                    style={{
                      color: "var(--color-accent)",
                      textDecoration: "none",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={`${d.title} (${d.lessonSections} mục bài học)`}
                  >
                    {d.title} <span className="tnum" style={{ color: "var(--color-muted)" }}>({d.lessonSections})</span>
                  </Link>
                ))}
                {overview.documents.length > 5 && (
                  <Link href="/knowledge" style={{ color: "var(--color-muted)", textDecoration: "none" }}>
                    +{overview.documents.length - 5} tài liệu khác...
                  </Link>
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: "auto", padding: 16, borderTop: "1px solid var(--color-line)" }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>{name}</div>
          <button className="btn btn-sm" onClick={signOut}>Đăng xuất</button>
        </div>
      </aside>

      <main style={{ flex: 1, padding: "28px 32px", minWidth: 0 }}>{children}</main>
    </div>
  );
}

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.015em" }}>{title}</h1>
      {description && (
        <p style={{ color: "var(--color-muted)", fontSize: 13.5, marginTop: 4, maxWidth: 640 }}>
          {description}
        </p>
      )}
    </div>
  );
}
