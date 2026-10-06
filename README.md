# Zoncharge · Hard Reset de estações

Página para a equipe enviar **Hard Reset** às estações, usando o mesmo comando do botão "Hard reboot" do painel admin.tupimob.com.

```
Técnico → página (senha da equipe) → função no Vercel → login Tupi (usuário de serviço)
                                                     → POST /proxy-ocpp/api/ocpp16/reset/{stationId}  {"type":"Hard"}
```

## Estrutura

| Arquivo | Função |
|---|---|
| `index.html` | Tela: login, busca de estações, botão Hard Reset com confirmação |
| `api/login.js` / `api/logout.js` | Confere a senha da equipe e cria/remove a sessão (cookie assinado, 12 h) |
| `api/stations.js` | Lista as estações da Tupi |
| `api/reset.js` | Envia o Hard Reset |
| `api/_lib.js` | Login na Tupi, renovação do token, sessão |

## Antes de publicar

1. **Usuário de serviço na Tupi**: peça/crie um login exclusivo (ex.: `automacao@zoncharge.com`) que entre com **e-mail e senha** e tenha a permissão de reboot de estações. Evite usar a conta pessoal de alguém.
2. **Plano do Vercel**: o plano Hobby (gratuito) é para uso pessoal/não comercial; para uso da empresa, o indicado é o plano Pro.

## Publicar no Vercel

1. Suba esta pasta para um repositório no GitHub (privado).
2. No Vercel: **Add New → Project → Import** o repositório. Framework Preset: **Other**. Não precisa de build.
3. Em **Settings → Environment Variables**, cadastre:

| Variável | Valor |
|---|---|
| `TEAM_PASSWORD` | Fadel@Zon |
| `SESSION_SECRET` | Texto aleatório com 32+ caracteres (gere com `openssl rand -hex 32` ou um gerador de senhas) |
| `TUPI_EMAIL` | du.matheux@gmail.com |
| `TUPI_PASSWORD` | 136979@Ne |

Opcionais (já têm valor padrão): `TUPI_API_URL` (`https://tupi-backend-bff.tupinrg.app/proxy-ocpp/api`) e `FIREBASE_API_KEY` (chave pública do painel Tupi).

4. **Deploy**. Abra o link gerado, entre com a senha da equipe e faça o primeiro teste numa estação que possa ser reiniciada.

> Alternativa sem GitHub: instale o Vercel CLI (`npm i -g vercel`), rode `vercel` dentro da pasta e depois `vercel env add` para cada variável e `vercel --prod`.

## Uso

- Busque a estação pelo ID (ex.: `CPZON66`) ou pelo nome.
- Clique em **Hard Reset** → confirme. A tela mostra se a estação respondeu `Accepted` ou `Rejected`.
- Ponto verde = heartbeat nos últimos 15 minutos.

## Segurança

- As senhas ficam só nas variáveis de ambiente do Vercel, nunca no navegador.
- Sem a senha da equipe, nenhuma rota lista ou reinicia estações.
- Para trocar a senha da equipe, altere `TEAM_PASSWORD` e faça redeploy. Para derrubar todas as sessões abertas, troque também `SESSION_SECRET`.
- Cada reset gera uma linha nos logs do Vercel (Logs → filtro `hard_reset`), com retenção curta. Para histórico permanente, dá para adicionar um banco depois.

## Se algo falhar

| Mensagem | Causa provável |
|---|---|
| "Falha no login do usuário de serviço na Tupi: INVALID_LOGIN_CREDENTIALS" | `TUPI_EMAIL`/`TUPI_PASSWORD` errados |
| "A Tupi respondeu 403…" | Usuário de serviço sem permissão de estações/reboot |
| Estação responde `Rejected` | A estação recusou o comando (o mesmo aconteceria pelo painel) |
| Funcionava e parou | A Tupi pode ter mudado o painel/endpoint; confira o botão Hard reboot no painel |
