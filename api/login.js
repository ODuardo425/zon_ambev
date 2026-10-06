import { checkTeamPassword, createSessionCookie, isAuthenticated, json, readBody } from "./_lib.js";

export default async function handler(req, res) {
  // GET: a página usa para saber se já existe sessão válida
  if (req.method === "GET") return json(res, 200, { authenticated: isAuthenticated(req) });
  if (req.method !== "POST") return json(res, 405, { error: "Método não permitido" });

  const { password } = await readBody(req);
  if (!checkTeamPassword(password)) {
    await new Promise((r) => setTimeout(r, 1000)); // atrasa tentativas de adivinhar a senha
    return json(res, 401, { error: "Senha incorreta" });
  }
  res.setHeader("Set-Cookie", createSessionCookie());
  return json(res, 200, { ok: true });
}
