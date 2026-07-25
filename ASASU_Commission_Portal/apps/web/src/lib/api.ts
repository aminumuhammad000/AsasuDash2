import type { AuthUser } from "@asasu/shared";
import { useSession } from "../hooks/useSession";

export const API_ROOT = import.meta.env.VITE_API_URL ?? "/api";

async function parseResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  let text = "";
  let jsonBody: any = null;

  try {
    text = await response.text();
    if (text && (isJson || text.trim().startsWith("{") || text.trim().startsWith("["))) {
      jsonBody = JSON.parse(text);
    }
  } catch {
    // text was not valid JSON
  }

  if (!response.ok) {
    if (response.status === 401) {
      const msg = jsonBody?.message || "Your session has expired. Please log in again.";
      useSession.getState().logout(msg);
      throw new Error(msg);
    }

    if (jsonBody?.message) {
      throw new Error(jsonBody.message);
    }

    if (text.trim().startsWith("<")) {
      throw new Error(`Server returned HTML response (${response.status}). Please check backend API server.`);
    }

    throw new Error(text.trim() || `Request failed with status ${response.status}`);
  }

  if (jsonBody !== null) {
    return jsonBody as T;
  }

  if (text.trim().startsWith("<")) {
    throw new Error("Server returned HTML document instead of data. Check API proxy or server config.");
  }

  return text as unknown as T;
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

export async function downloadFile(token: string, path: string, filename: string) {
  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_ROOT}${path}`, { method: "GET", headers });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(error?.message ?? `Request failed with ${response.status}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function login(email: string, password: string) {
  return apiRequest<AuthUser>(undefined, "/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}
