// Funções compartilhadas (arquivos que começam com "_" não viram rota no Vercel)
import crypto from "node:crypto";

const COOKIE = "zon_sess";
const SESSION_HOURS = 12;

// Chave pública do Firebase usada pelo painel admin.tupimob.com (não é segredo).
const FIREBASE_API_KEY =
  process.env.FIREBASE_API_KEY || "AIzaSyCjNbUpyHihJuIkMBU7Qoiq0r1E7-_QrbI";
const TUPI_API_URL = (
  process.env.TUPI_API_URL || "https://tupi-backend-bff.tupinrg.app/proxy-ocpp/api"
).replace(/\/$/, "");

// ---------- Sessão da equipe (cookie assinado, sem banco) ----------

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET ausente ou curto (mín. 32 caracteres)");
  return s;
}

function sign(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

export function createSessionCookie() {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const value = `${exp}.${sign(String(exp))}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function isAuthenticated(req) {
  const raw = req.headers.cookie || "";
  const match = raw.split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!match) return false;
  const [exp, sig] = match.slice(COOKIE.length + 1).split(".");
  if (!exp || !sig) return false;
  const expected = sign(exp);
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  return Number(exp) > Date.now();
}

export function checkTeamPassword(input) {
  const real = process.env.TEAM_PASSWORD || "";
  if (!real || typeof input !== "string") return false;
  const a = crypto.createHash("sha256").update(input).digest();
  const b = crypto.createHash("sha256").update(real).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---------- Acesso à Tupi ----------

let cachedToken = null; // { token, exp } — reaproveitado enquanto a função estiver "quente"

async function getTupiToken(force = false) {
  if (!force && cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const email = process.env.TUPI_EMAIL;
  const password = process.env.TUPI_PASSWORD;
  if (!email || !password) throw new Error("TUPI_EMAIL / TUPI_PASSWORD não configurados");

  const r = await fetch(
    `${process.env.FIREBASE_AUTH_URL || "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"}?key=${FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.idToken) {
    const msg = data?.error?.message || `HTTP ${r.status}`;
    throw new Error(`Falha no login do usuário de serviço na Tupi: ${msg}`);
  }
  cachedToken = { token: data.idToken, exp: Date.now() + Number(data.expiresIn || 3600) * 1000 };
  return cachedToken.token;
}

export async function tupiRequest(method, path, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getTupiToken(attempt > 0);
    const r = await fetch(`${TUPI_API_URL}/${path.replace(/^\//, "")}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401 && attempt === 0) continue; // token expirou: renova e tenta de novo
    const text = await r.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: r.status, ok: r.ok, data };
  }
}

export function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

export async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { return {}; }
}

export const STATION_ID_RE = /^[A-Za-z0-9_.:\-]{1,64}$/;
