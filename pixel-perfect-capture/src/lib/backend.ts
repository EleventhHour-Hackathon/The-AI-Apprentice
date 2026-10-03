// The AI Apprentice backend (core/backend). Override with VITE_BACKEND_URL.
export const BACKEND_URL = String(
  import.meta.env["VITE_BACKEND_URL"] ?? "http://localhost:8000",
).replace(/\/+$/, "");
