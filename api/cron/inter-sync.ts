// GET /api/cron/inter-sync — sincronização diária agendada (vercel.json →
// "crons"). O Vercel invoca com Authorization: Bearer <CRON_SECRET> quando a
// env var CRON_SECRET existe no projeto. Roda TODAS as integrações ativas,
// sequencialmente (gentil com o rate limit do Inter); a falha de uma não
// derruba as demais (fica em ultimo_erro e no array de resultados).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminClient } from "../_lib/supabase.js";
import { syncIntegracao, type IntegracaoRow, type SyncResult } from "../_lib/sync.js";

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ ok: false, error: "Não autorizado" });
    return;
  }

  try {
    const admin = adminClient();
    const { data: integracoes, error } = await admin
      .from("integracoes_inter")
      .select("*")
      .eq("ativo", true)
      .order("criado_em", { ascending: true });
    if (error) throw new Error(error.message);

    const resultados: SyncResult[] = [];
    for (const integ of (integracoes ?? []) as IntegracaoRow[]) {
      resultados.push(await syncIntegracao(admin, integ));
    }

    res.status(200).json({ ok: true, resultados });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: msg });
  }
}
