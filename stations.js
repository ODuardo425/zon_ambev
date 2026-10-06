import { isAuthenticated, json, tupiRequest } from "./_lib.js";

export default async function handler(req, res) {
  if (!isAuthenticated(req)) return json(res, 401, { error: "Sessão expirada. Entre novamente." });
  if (req.method !== "GET") return json(res, 405, { error: "Método não permitido" });

  try {
    const r = await tupiRequest("GET", "stations");
    if (!r.ok) return json(res, 502, { error: `A Tupi respondeu ${r.status} ao listar estações` });

    const list = Array.isArray(r.data) ? r.data : r.data?.stations || r.data?.data || [];
    const stations = list
      .filter((s) => s && s.stationId)
      .map((s) => ({
        stationId: s.stationId,
        name: s.name || "",
        lastHeartbeat: s.lastHeartbeat || null,
        connectors: Array.isArray(s.connectors)
          ? s.connectors.map((c) => ({
              id: c.connectorId ?? c.id ?? null,
              status: c.status ?? c.lastStatus ?? null,
            }))
          : [],
      }))
      .sort((a, b) => (a.name || a.stationId).localeCompare(b.name || b.stationId));

    return json(res, 200, { stations });
  } catch (e) {
    console.error("stations:", e.message);
    return json(res, 500, { error: e.message });
  }
}
