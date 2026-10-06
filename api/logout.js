import { clearSessionCookie, json } from "./_lib.js";

export default function handler(req, res) {
  res.setHeader("Set-Cookie", clearSessionCookie());
  return json(res, 200, { ok: true });
}
