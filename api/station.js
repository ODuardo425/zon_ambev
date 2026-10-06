import {
  isAuthenticated, json, getStationStatus, lockReason, tupiRequest, STATION_ID_RE,
} from "./_lib.js";

// Mesmos estados da trava (_lib.js) — usado só para a etiqueta "Em uso" da lista
const BLOCK_STATES = (process.env.BLOCK_STATES || "Preparing,Charging,SuspendedEV,SuspendedEVSE")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

// GET /api/station          → lista de estações (para o técnico localizar)
// GET /api/station?id=CPZON07 → estado ao vivo da estação + se o reset está liberado
export default async function handler(req, res) {
  if (!isAuthenticated(req)) return json(res, 401, { error: "Sessão expirada. Entre novamente." });
  if (req.method !== "GET") return json(res, 405, { error: "Método não permitido" });

  const raw = new URL(req.url, "http://x").searchParams.get("id");
  if (raw == null || raw === "") return listStations(res);

  const id = String(raw).trim().toUpperCase();
  if (!STATION_ID_RE.test(id)) return json(res, 400, { error: "ID de estação inválido" });

  try {
    const st = await getStationStatus(id);
    if (!st.found) return json(res, 404, { error: `Estação ${id} não encontrada. Confira o ID na etiqueta da estação.` });
    const reason = lockReason(st);
    return json(res, 200, { ...st, canReset: !reason, lockReason: reason });
  } catch (e) {
    console.error("station:", id, e.message);
    return json(res, 502, { error: e.message });
  }
}

async function listStations(res) {
  try {
    const r = await tupiRequest("GET", "stations");
    if (!r.ok) return json(res, 502, { error: `A Tupi respondeu ${r.status} ao listar estações` });
    const list = Array.isArray(r.data) ? r.data : r.data?.stations || r.data?.data || [];
    const stations = list
      .filter((s) => s && s.stationId)
      .map((s) => {
        const states = (Array.isArray(s.connectors) ? s.connectors : [])
          .map((c) => c.lastStatus || c.status)
          .filter(Boolean);
        return {
          stationId: s.stationId,
          name: s.name || "",
          disconnected: !!s.disconnectionTimestamp,
          states,
          inUse: states.some((x) => BLOCK_STATES.includes(String(x).toLowerCase())),
        };
      })
      .sort((a, b) => (a.name || a.stationId).localeCompare(b.name || b.stationId, "pt-BR"));
    return json(res, 200, { stations });
  } catch (e) {
    console.error("station list:", e.message);
    return json(res, 500, { error: e.message });
  }
}
