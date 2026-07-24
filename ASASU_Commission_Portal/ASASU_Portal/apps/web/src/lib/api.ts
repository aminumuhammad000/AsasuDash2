import type { AuthUser } from "@asasu/shared";

export const API_ROOT = import.meta.env.VITE_API_URL ?? "/api";

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(error?.message ?? `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function apiRequest<T>(token: string | undefined, path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_ROOT}${path}`, { ...options, headers });
  return parseResponse<T>(response);
}

export async function uploadFile<T>(token: string, path: string, file: File, fields: Record<string, string> = {}) {
  const form = new FormData();
  form.append("file", file);
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));
  return apiRequest<T>(token, path, { method: "POST", body: form });
}

export async function login(email: string, password: string) {
  return apiRequest<AuthUser>(undefined, "/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}
