// Helper gọi FastAPI backend từ Client Components với JWT Supabase.
import { createClient } from "@/lib/supabase/client";

export type StudentOverview = {
  classes: {
    id: string;
    name: string;
    course: { id: string; code: string; title: string } | null;
  }[];
  documents: {
    id: string;
    title: string;
    visibility: string;
    course: { id: string; code: string; title: string } | null;
    lessonSections: number;
  }[];
};

export function getApiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");
}

export async function apiFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const supabase = createClient();
  let {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    const refreshed = await supabase.auth.refreshSession();
    session = refreshed.data.session;
  }

  if (!session?.access_token) {
    throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.access_token}`);
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    throw new Error(data?.error || data?.detail || `Lỗi máy chủ (${res.status})`);
  }
  return data as T;
}
