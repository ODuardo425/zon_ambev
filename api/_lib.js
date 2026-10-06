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

// ---------- Trava: estado da estação (API pública da Tupi) ----------

const STATION_STATUS_URL = (
  process.env.STATION_STATUS_URL || "https://api.tupinambaenergia.com.br/station"
).replace(/\/$/, "");

// Estados OCPP que indicam cliente usando a estação. Pode ser alterado pela variável BLOCK_STATES.
const BLOCK_STATES = (process.env.BLOCK_STATES || "Preparing,Charging,SuspendedEV,SuspendedEVSE")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const isBlocking = (s) => BLOCK_STATES.includes(String(s || "").toLowerCase());

function summarize(base, plugs, overall) {
  const blockingPlugs = plugs.filter((p) => isBlocking(p.state));
  return {
    found: true,
    ...base,
    overall,
    plugs,
    blockingPlugs,
    inUse: blockingPlugs.length > 0 || isBlocking(overall),
    unknown: plugs.length === 0 && !overall && !base.disconnected,
  };
}

// 1ª opção: API pública (mesma do app). Pode recusar chamadas de servidores (HTTP 403).
async function fromPublicApi(stationId) {
  const r = await fetch(`${STATION_STATUS_URL}/${encodeURIComponent(stationId)}`, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "pt-BR,pt;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
    },
    cache: "no-store",
  });
  if (r.status === 404) return { found: false };
  if (!r.ok) throw new Error(`API pública HTTP ${r.status}`);
  const d = await r.json().catch(() => null);
  if (!d || !(d.stationID || d.stationId)) return { found: false };
  const plugs = (Array.isArray(d.connectedPlugs) ? d.connectedPlugs : []).map((p) => ({
    id: p.connectorID ?? p.connectorId ?? null,
    name: p.name || "",
    state: p.stateName || "Desconhecido",
    percentage: p.meterValues?.percentage ?? null,
  }));
  return summarize(
    { stationId: d.stationID || d.stationId, name: d.name || "", address: d.address || "", source: "public" },
    plugs,
    d.stateName || null
  );
}

// 2ª opção: lista autenticada do painel Tupi (mesma tela "Stations > Connected").
async function fromTupiPanel(stationId) {
  const r = await tupiRequest("GET", "stations");
  if (!r.ok) throw new Error(`painel Tupi HTTP ${r.status}`);
  const list = Array.isArray(r.data) ? r.data : r.data?.stations || r.data?.data || [];
  const st = list.find((s) => String(s?.stationId || "").toUpperCase() === stationId.toUpperCase());
  if (!st) return { found: false };
  const disconnected = !!st.disconnectionTimestamp;
  const plugs = disconnected ? [] : (Array.isArray(st.connectors) ? st.connectors : []).map((c) => ({
    id: c.connectorId ?? c.id ?? null,
    name: "",
    state: c.lastStatus || c.status || "Desconhecido",
    percentage: null,
  }));
  return summarize(
    { stationId: st.stationId, name: st.name || "", address: "", source: "panel", disconnected },
    plugs,
    disconnected ? "Disconnected" : null
  );
}

export async function getStationStatus(stationId) {
  let publicError = null;
  try {
    const st = await fromPublicApi(stationId);
    if (st.found) return st;
  } catch (e) {
    publicError = e.message;
  }
  try {
    return await fromTupiPanel(stationId);
  } catch (e) {
    throw new Error(
      `Não foi possível consultar o estado da estação (${publicError ? publicError + "; " : ""}${e.message})`
    );
  }
}

const STATE_PT = {
  disconnected: "desconectada", preparing: "preparando", charging: "carregando", suspendedev: "pausada pelo veículo", suspendedevse: "pausada pela estação",
};

export function lockReason(st) {
  if (st.disconnected) return "A estação está desconectada da Tupi, então o comando não chegaria até ela.";
  if (st.unknown) return "Não foi possível confirmar se há recarga em andamento.";
  if (!st.inUse) return null;
  const list = st.blockingPlugs.map((p) => `conector ${p.id ?? "?"} (${STATE_PT[String(p.state).toLowerCase()] || p.state})`).join(", ");
  return `Há cliente usando a estação${list ? ": " + list : ""}.`;
}
