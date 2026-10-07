// Orquestração de uma sincronização (compartilhada pelo endpoint manual e
// pelo cron). Espelha o pipeline de importação por arquivo (useImportLote):
// insere em `movimentacoes` com categoria_status='pendente' + lote_id + fitid
// (dedup pelo índice único por conta) e roda fn_categorizar_pendentes — as
// transações caem na fila de Revisão exatamente como um upload.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getExtrato, getSaldo, getToken, makeDispatcher, type InterCreds, type InterTransacao } from "./inter.js";

export type IntegracaoRow = InterCreds & {
  id: string;
  empresa_id: string;
  conta_id: string;
  ultima_sync: string | null;
};

export type SyncResult = {
  contaId: string;
  ok: boolean;
  loteId?: string;
  inserted: number;
  skipped: number;
  saldo?: number;
  error?: string;
};

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// Janela da busca: da última sync (menos 3 dias de sobreposição — lançamentos
// retroativos; a dedup elimina repetidos) até hoje; 1ª vez = últimos 89 dias.
// O Inter limita a consulta a 90 dias.
function janela(ultimaSync: string | null): { dataInicio: string; dataFim: string } {
  const hoje = new Date();
  const min = new Date(hoje);
  min.setDate(min.getDate() - 89);

  let inicio = min;
  if (ultimaSync) {
    const s = new Date(ultimaSync);
    s.setDate(s.getDate() - 3);
    if (s > min) inicio = s;
  }
  if (inicio > hoje) inicio = hoje;
  return { dataInicio: isoDay(inicio), dataFim: isoDay(hoje) };
}

type LinhaMov = {
  empresa_id: string;
  conta_id: string;
  data: string;
  descricao: string;
  descricao_ia: null;
  categoria: null;
  valor: number;
  tipo: "in" | "out";
  confianca: number;
  fitid: string;
  categoria_status: "pendente";
  lote_id: string;
};

function mapTransacao(t: InterTransacao, integ: IntegracaoRow, loteId: string): LinhaMov | null {
  const fitid = t.idTransacao?.trim();
  const data = (t.dataEntrada ?? t.dataTransacao ?? "").slice(0, 10);
  const valor = Math.abs(Number(t.valor));
  if (!fitid || !data || !Number.isFinite(valor) || valor === 0) return null;
  const descricao =
    [t.titulo, t.descricao].filter((s) => s && s.trim()).join(" - ") ||
    t.tipoTransacao ||
    "Transação Inter";
  return {
    empresa_id: integ.empresa_id,
    conta_id: integ.conta_id,
    data,
    descricao,
    descricao_ia: null,
    categoria: null,
    valor,
    tipo: t.tipoOperacao === "C" ? "in" : "out",
    confianca: 1,
    fitid,
    categoria_status: "pendente",
    lote_id: loteId,
  };
}

const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

// FITIDs já existentes NESTA conta (mesma semântica de fetchExistingFitids do app).
async function fitidsExistentes(admin: SupabaseClient, integ: IntegracaoRow, fitids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const grupo of chunk(fitids, 500)) {
    const { data, error } = await admin
      .from("movimentacoes")
      .select("fitid")
      .eq("empresa_id", integ.empresa_id)
      .eq("conta_id", integ.conta_id)
      .in("fitid", grupo);
    if (error) throw new Error(`Consulta de duplicatas falhou: ${error.message}`);
    for (const r of data ?? []) if (r.fitid) found.add(r.fitid);
  }
  return found;
}

async function inserirLinhas(admin: SupabaseClient, integ: IntegracaoRow, linhas: LinhaMov[]): Promise<number> {
  let inserted = 0;
  for (const grupo of chunk(linhas, 500)) {
    const { error } = await admin.from("movimentacoes").insert(grupo);
    if (!error) {
      inserted += grupo.length;
      continue;
    }
    if (error.code !== "23505") throw new Error(`Insert falhou: ${error.message}`);
    // Corrida (cron × manual): alguém inseriu esses fitids entre a checagem e
    // o insert. Re-consulta e re-tenta uma vez só com o que ainda falta.
    const dup = await fitidsExistentes(admin, integ, grupo.map((l) => l.fitid));
    const restantes = grupo.filter((l) => !dup.has(l.fitid));
    if (restantes.length) {
      const { error: e2 } = await admin.from("movimentacoes").insert(restantes);
      if (e2) throw new Error(`Insert (retry) falhou: ${e2.message}`);
      inserted += restantes.length;
    }
  }
  return inserted;
}

export async function syncIntegracao(admin: SupabaseClient, integ: IntegracaoRow): Promise<SyncResult> {
  try {
    const { dataInicio, dataFim } = janela(integ.ultima_sync);
    const dispatcher = makeDispatcher(integ);
    const token = await getToken(dispatcher, integ);

    const transacoes = await getExtrato(dispatcher, token, integ, dataInicio, dataFim);

    const loteId = randomUUID();
    // Dedup interna do lote (o Inter não deve repetir idTransacao, mas custa nada).
    const vistos = new Set<string>();
    const linhas: LinhaMov[] = [];
    for (const t of transacoes) {
      const l = mapTransacao(t, integ, loteId);
      if (!l || vistos.has(l.fitid)) continue;
      vistos.add(l.fitid);
      linhas.push(l);
    }

    const existentes = await fitidsExistentes(admin, integ, linhas.map((l) => l.fitid));
    const novas = linhas.filter((l) => !existentes.has(l.fitid));
    const skipped = linhas.length - novas.length;

    let inserted = 0;
    if (novas.length) {
      inserted = await inserirLinhas(admin, integ, novas);
      const { error: rpcErr } = await admin.rpc("fn_categorizar_pendentes", {
        p_empresa: integ.empresa_id,
        p_lote: loteId,
      });
      if (rpcErr) {
        // Não é fatal: as linhas ficam pendentes sem sugestão; a Revisão funciona igual.
        console.error("fn_categorizar_pendentes:", rpcErr.message);
      }
    }

    const saldo = await getSaldo(dispatcher, token, integ, dataFim);

    const agora = new Date().toISOString();
    const { error: upErr } = await admin
      .from("integracoes_inter")
      .update({
        ultimo_saldo: saldo,
        ultimo_saldo_em: agora,
        ultima_sync: agora,
        ultimo_erro: null,
        atualizado_em: agora,
      })
      .eq("id", integ.id);
    if (upErr) throw new Error(`Gravação do status falhou: ${upErr.message}`);

    return {
      contaId: integ.conta_id,
      ok: true,
      loteId: inserted > 0 ? loteId : undefined,
      inserted,
      skipped,
      saldo,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("integracoes_inter")
      .update({ ultimo_erro: msg.slice(0, 500), atualizado_em: new Date().toISOString() })
      .eq("id", integ.id);
    return { contaId: integ.conta_id, ok: false, inserted: 0, skipped: 0, error: msg };
  }
}
