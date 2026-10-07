// POST /api/inter/sync — sincronização manual disparada pelo app.
// Auth: Bearer <access_token do usuário logado no Supabase>.
// Body: { "contaId": "<uuid da conta bancária>" }
// Autorização: master OU membro da empresa com capacidade 'mov_gerir'.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { corsDoApp } from "../_lib/cors.js";
import { adminClient, getUserFromBearer, userPodeSincronizar } from "../_lib/supabase.js";
import { syncIntegracao, type IntegracaoRow } from "../_lib/sync.js";

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // O APK chama de outra origem: preflight e cabeçalhos antes de qualquer
  // checagem de método (OPTIONS cairia no 405 logo abaixo).
  if (corsDoApp(req, res)) return;

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Use POST" });
    return;
  }

  try {
    const admin = adminClient();

    const user = await getUserFromBearer(admin, req.headers.authorization);
    if (!user) {
      res.status(401).json({ ok: false, error: "Não autenticado" });
      return;
    }

    const contaId = typeof req.body?.contaId === "string" ? req.body.contaId : null;
    if (!contaId) {
      res.status(400).json({ ok: false, error: "Informe contaId" });
      return;
    }

    const { data: integ, error } = await admin
      .from("integracoes_inter")
      .select("*")
      .eq("conta_id", contaId)
      .eq("ativo", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!integ) {
      res.status(404).json({ ok: false, error: "Conta sem integração Inter ativa" });
      return;
    }

    const autorizado = await userPodeSincronizar(admin, user.id, integ.empresa_id);
    if (!autorizado) {
      res.status(403).json({ ok: false, error: "Sem permissão nesta empresa" });
      return;
    }

    const result = await syncIntegracao(admin, integ as IntegracaoRow);
    res.status(result.ok ? 200 : 502).json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: msg });
  }
}
