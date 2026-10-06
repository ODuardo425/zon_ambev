import { isAuthenticated, json, getStationStatus, lockReason, STATION_ID_RE } from "./_lib.js";

// GET /api/station?id=CPZON07 → dados da estação + se o reset está liberado
export default async function handler(req, res) {
  if (!isAuthenticated(req)) return json(res, 401, { error: "Sessão expirada. Entre novamente." });
  if (req.method !== "GET") return json(res, 405, { error: "Método não permitido" });

  const id = String(new URL(req.url, "http://x").searchParams.get("id") || "").trim().toUpperCase();
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
