/* Calls biometric_sync.console_api on the Frappe site (same origin; the dev server proxies /api). */

export class ApiError extends Error {
  status: number;
  detail?: string;
  /** Settings are protected by the settings password and this session hasn't entered it. */
  locked?: boolean;
  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

const M = "biometric_sync.console_api.";
let csrf: string | null = null;

async function csrfToken(): Promise<string> {
  if (csrf) return csrf;
  const r = await fetch(`/api/method/${M}csrf`, { credentials: "same-origin" });
  const d = await r.json().catch(() => ({}));
  csrf = d.message || "";
  return csrf as string;
}

function errorText(d: any, res: Response): string {
  try {
    if (d?._server_messages) {
      const msgs = JSON.parse(d._server_messages).map((m: string) => {
        try { return JSON.parse(m).message; } catch { return m; }
      });
      return msgs.join(" ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
  } catch { /* ignore */ }
  if (d?.exception) return String(d.exception).split(":").slice(1).join(":").trim() || d.exception;
  return res.statusText || "Request failed";
}

/** GET (reads) or POST (changes) a console_api method; returns `message`. */
export async function call<T = any>(method: string, args: Record<string, any> = {}, post = false): Promise<T> {
  const url = `/api/method/${M}${method}`;
  let res: Response;
  try {
    if (post) {
      const body = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, v !== null && typeof v === "object" ? JSON.stringify(v) : v]));
      res = await fetch(url, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-Frappe-CSRF-Token": await csrfToken() },
        body: JSON.stringify(body),
      });
    } else {
      const qs = new URLSearchParams();
      Object.entries(args).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") qs.set(k, String(v)); });
      res = await fetch(url + (qs.toString() ? "?" + qs : ""), { credentials: "same-origin", headers: { Accept: "application/json" } });
    }
  } catch {
    throw new ApiError("Cannot reach the server.", 0);
  }
  const d = await res.json().catch(() => ({}));
  if (res.status === 403 && /Login|not allowed|session/i.test(errorText(d, res)) && !window.__bsLoggedIn) {
    throw new ApiError("Login required", 401);
  }
  if (res.status === 400 && /CSRF/i.test(JSON.stringify(d))) { csrf = null; return call(method, args, post); }
  if (!res.ok) {
    const err = new ApiError(errorText(d, res), res.status, d?.exc ? String(d.exc).slice(0, 4000) : undefined);
    err.locked = res.status === 403 && /settings are locked/i.test(err.message);
    throw err;
  }
  return d.message as T;
}

export const get = <T = any>(method: string, args?: Record<string, any>) => call<T>(method, args, false);
export const post = <T = any>(method: string, args?: Record<string, any>) => call<T>(method, args, true);

/** Download a CSV produced by a console_api method. */
export function download(method: string, args: Record<string, any> = {}) {
  const qs = new URLSearchParams();
  Object.entries(args).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") qs.set(k, String(v)); });
  const a = document.createElement("a");
  a.href = `/api/method/${M}${method}${qs.toString() ? "?" + qs : ""}`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function login(usr: string, pwd: string) {
  const res = await fetch("/api/method/login", {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ usr, pwd }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(d.message || "Login failed", res.status);
  csrf = null;
}

export async function logout() {
  await fetch("/api/method/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
}

declare global {
  interface Window { __bsLoggedIn?: boolean }
}
