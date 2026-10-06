import { checkTeamPassword, createSessionCookie, json, readBody } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Método não permitido" });
  const { password } = await readBody(req);
  if (!checkTeamPassword(password)) {
    await new Promise((r) => setTimeout(r, 1000)); // atrasa tentativas de adivinhar a senha
    return json(res, 401, { error: "Senha incorreta" });
  }
  res.setHeader("Set-Cookie", createSessionCookie());
  return json(res, 200, { ok: true });
}
