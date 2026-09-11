// Credentials deliberately live outside the book database and exports.
import { DEFAULT_MODEL_ID, DEFAULT_PROVIDER_ID, providerById, validModelName, normalizeBaseUrl, CUSTOM_PROVIDER_ID } from "./model-providers";

const SESSION_KEY = "momai-session-key";
const LEGACY_SESSION_KEY = "momai-deepseek-session-key";
const CHOICE_KEY = "momai-model-choice";
const LEGACY_CHOICE_KEY = "momai-model";

export type SessionCredentials = { provider: string; key: string };
export type ModelChoice = { provider: string; model: string; baseUrl?: string };

export function readSessionCredentials(): SessionCredentials | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SessionCredentials>;
      if (typeof parsed.key === "string" && parsed.key && typeof parsed.provider === "string" && providerById(parsed.provider)) return { provider: parsed.provider, key: parsed.key };
    }
    const legacy = sessionStorage.getItem(LEGACY_SESSION_KEY);
    return legacy ? { provider: DEFAULT_PROVIDER_ID, key: legacy } : null;
  } catch { return null; }
}

export function saveSessionCredentials(value: SessionCredentials | null): void {
  try {
    if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(LEGACY_SESSION_KEY);
  } catch { /* storage unavailable */ }
}

export function validApiKey(value: string): boolean { return /^[\x21-\x7e]{10,256}$/.test(value); }

export function defaultChoice(): ModelChoice { return { provider: DEFAULT_PROVIDER_ID, model: DEFAULT_MODEL_ID }; }

export function normalizeChoice(input: unknown): ModelChoice | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Partial<ModelChoice>;
  const provider = typeof candidate.provider === "string" ? candidate.provider : DEFAULT_PROVIDER_ID;
  if (!providerById(provider)) return null;
  const model = typeof candidate.model === "string" ? candidate.model : "";
  if (!validModelName(model)) return null;
  const baseUrl = typeof candidate.baseUrl === "string" ? normalizeBaseUrl(candidate.baseUrl) : null;
  if (candidate.baseUrl && !baseUrl) return null;
  return provider === CUSTOM_PROVIDER_ID && !baseUrl ? { provider, model } : { provider, model, ...(baseUrl ? { baseUrl } : {}) };
}

export function readModelChoice(): ModelChoice | null {
  try {
    const saved = normalizeChoice(JSON.parse(localStorage.getItem(CHOICE_KEY) ?? "null"));
    if (saved) return saved;
    const legacy = localStorage.getItem(LEGACY_CHOICE_KEY);
    if (legacy === "deepseek-v4-pro" || legacy === "deepseek-v4-flash") return { provider: DEFAULT_PROVIDER_ID, model: legacy };
    return null;
  } catch { return null; }
}

export function saveModelChoice(choice: ModelChoice): boolean {
  try { localStorage.setItem(CHOICE_KEY, JSON.stringify(choice)); return true; } catch { return false; }
}
