"use client";

/**
 * Thin fetch wrapper for client components talking to this same app's own /api/* routes.
 * Every route in src/app/api/** replies with JSON — on an error status it replies
 * `{ error: "<Arabic message>" }` (see e.g. login/route.ts), so this unwraps that shape
 * into a thrown `ApiError` carrying the already-Arabic message, instead of making every
 * page re-parse the response by hand.
 */
export class ApiError extends Error {
  status: number;
  requiresTwoFactor?: boolean;
  constructor(message: string, status: number, requiresTwoFactor?: boolean) {
    super(message);
    this.status = status;
    this.requiresTwoFactor = requiresTwoFactor;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
    credentials: "same-origin",
    cache: "no-store",
  });

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const message =
      (body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : null) || `حدث خطأ غير متوقع (${res.status})`;
    const requiresTwoFactor =
      body && typeof body === "object" && "requiresTwoFactor" in body
        ? Boolean((body as { requiresTwoFactor?: boolean }).requiresTwoFactor)
        : undefined;
    throw new ApiError(message, res.status, requiresTwoFactor);
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "POST", body: data !== undefined ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PATCH", body: data !== undefined ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
