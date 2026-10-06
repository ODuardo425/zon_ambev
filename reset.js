import { isAuthenticated, json, readBody, tupiRequest, STATION_ID_RE } from "./_lib.js";

export default async function handler(req, res) {
  if (!isAuthenticated(req)) return json(res, 401, { error: "Sessão expirada. Entre novamente." });
  if (req.method !== "POST") return json(res, 405, { error: "Método não permitido" });

  const { stationId } = await readBody(req);
  if (typeof stationId !== "string" || !STATION_ID_RE.test(stationId)) {
    return json(res, 400, { error: "ID de estação inválido" });
  }

  try {
    // Mesmo comando que o botão "Hard reboot" do painel admin.tupimob.com envia
    const r = await tupiRequest("POST", `ocpp16/reset/${encodeURIComponent(stationId)}`, {
      type: "Hard",
    });
    const result = r.data?.result ?? null;
    // Fica nos logs do Vercel (retenção curta)
    console.log(JSON.stringify({ event: "hard_reset", stationId, httpStatus: r.status, result, at: new Date().toISOString() }));

    if (!r.ok) {
      const msg = r.data?.message || r.data?.error || `HTTP ${r.status}`;
      return json(res, 502, { error: `A Tupi recusou o comando: ${msg}`, result });
    }
    return json(res, 200, { stationId, result: result || "Desconhecido", accepted: result === "Accepted" });
  } catch (e) {
    console.error("reset:", stationId, e.message);
    return json(res, 500, { error: e.message });
  }
}
