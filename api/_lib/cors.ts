// ─── CORS: liberar as funções para o APK Android ─────────────────────────────
// No site, /api/* é a mesma origem e CORS nem entra na conversa. Dentro do APK
// a página vem do servidor local do Capacitor (https://localhost), então as
// chamadas para estas funções são de outra origem — e o navegador embutido faz
// o preflight OPTIONS antes de cada POST/PATCH/DELETE com Authorization.
//
// A lista é fechada, nunca "*". E vale lembrar o que ela NÃO é: a autorização
// destas funções continua sendo o Bearer token do usuário logado, conferido
// contra o Supabase (ver _lib/supabase.ts e _lib/usuarios.ts). CORS só decide
// quem o navegador deixa LER a resposta; liberar a origem do app não dá acesso
// a nada a quem não tem token válido e a capacidade necessária.
import type { VercelRequest, VercelResponse } from "@vercel/node";

// Origem do WebView do Capacitor: no Android é https://localhost (androidScheme
// "https" em capacitor.config.ts); capacitor://localhost é a do iOS, deixada
// aqui para o dia em que houver app de iPhone.
const ORIGENS_DO_APP = ["https://localhost", "capacitor://localhost"];

/**
 * Responde ao preflight e marca a resposta como liberada para o app.
 * Devolve `true` quando já respondeu (OPTIONS) — o handler deve retornar.
 */
export function corsDoApp(req: VercelRequest, res: VercelResponse): boolean {
  const origem = typeof req.headers.origin === "string" ? req.headers.origin : null;

  if (origem && ORIGENS_DO_APP.includes(origem)) {
    res.setHeader("Access-Control-Allow-Origin", origem);
    // Sem o Vary, um cache intermediário poderia devolver a resposta do app
    // (com Allow-Origin) para o site, e vice-versa.
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
  }

  if (req.method === "OPTIONS") {
    // Origem desconhecida não recebeu o Allow-Origin acima: o preflight dela
    // falha no navegador, que é exatamente o esperado.
    res.status(204).end();
    return true;
  }

  return false;
}
