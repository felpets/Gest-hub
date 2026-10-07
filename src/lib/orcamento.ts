// Orçamento: cruza as METAS por categoria com o REALIZADO (movimentações).
// Puro e testável — a agregação é client-side, reusando o que o dashboard já
// carrega. Ver a migração supabase/33_orcamento.sql.
import type { Conta, Movimentacao, Orcamento } from "@/lib/queries";
import { caminhoConta, resolverFlags } from "@/lib/categorias";
import { mesCompetencia, type CompetenciaModo } from "@/lib/datas";

// Reexporta p/ manter os imports existentes (a definição vive em categorias.ts).
export { caminhoConta };

const r2 = (n: number) => Math.round(n * 100) / 100;

// Meta de uma categoria num mês (ym = "YYYY-MM"): override do mês vence o padrão
// (competencia null). Retorna null se não houver meta.
export function metaDoMes(
  orcs: Orcamento[],
  planoContaId: string,
  ym: string
): { id: string; valor: number; escopo: "mes" | "padrao" } | null {
  const daConta = orcs.filter((o) => o.planoContaId === planoContaId);
  const override = daConta.find((o) => o.competencia === `${ym}-01`);
  if (override) return { id: override.id, valor: override.valorMeta, escopo: "mes" };
  const padrao = daConta.find((o) => o.competencia === null);
  if (padrao) return { id: padrao.id, valor: padrao.valorMeta, escopo: "padrao" };
  return null;
}

// Realizado de uma categoria no mês (soma das movimentações do tipo certo).
// Folha = match exato do caminho; categoria-pai = ela mesma + as filhas
// (lançamentos com prefixo "Pai / ").
export function realizadoDaCategoria(
  movs: Movimentacao[],
  caminho: string,
  isPai: boolean,
  tipoMov: "in" | "out",
  ym: string,
  modo: CompetenciaModo = "pagamento",
  diaCorte: number | null = null
): number {
  const prefixo = `${caminho} / `;
  let total = 0;
  for (const m of movs) {
    if (m.tipo !== tipoMov) continue;
    if (mesCompetencia(m.dataISO, modo, diaCorte) !== ym) continue;
    const cat = (m.cat ?? "").trim();
    const bate = isPai ? cat === caminho || cat.startsWith(prefixo) : cat === caminho;
    if (bate) total += m.valor;
  }
  return r2(total);
}

export type MetaResolvida = {
  planoContaId: string;
  nome: string;
  caminho: string;
  tipo: "receita" | "despesa";
  meta: number;
  realizado: number;
  pctConsumido: number; // 0 quando meta = 0 (não divide por zero)
  restante: number;
  estourou: boolean;
};

// Para cada categoria COM meta no mês, resolve meta × realizado.
export function cruzarOrcamento(
  contas: Conta[],
  orcs: Orcamento[],
  movs: Movimentacao[],
  ym: string
): MetaResolvida[] {
  const paisComFilho = new Set(contas.filter((c) => c.parentId).map((c) => c.parentId as string));
  const flags = resolverFlags(contas);
  const out: MetaResolvida[] = [];
  for (const c of contas) {
    const meta = metaDoMes(orcs, c.id, ym);
    if (!meta) continue;
    const caminho = caminhoConta(c, contas);
    if (flags.ocultoDe(caminho)) continue; // categoria fora dos relatórios não entra no orçamento
    const isPai = paisComFilho.has(c.id);
    const tipoMov: "in" | "out" = c.tipo === "receita" ? "in" : "out";
    const reg = flags.competenciaDe(caminho);
    const realizado = realizadoDaCategoria(movs, caminho, isPai, tipoMov, ym, reg.modo, reg.diaCorte);
    out.push({
      planoContaId: c.id,
      nome: c.nome,
      caminho,
      tipo: c.tipo,
      meta: meta.valor,
      realizado,
      pctConsumido: meta.valor > 0 ? r2((realizado / meta.valor) * 100) : 0,
      restante: r2(meta.valor - realizado),
      estourou: realizado > meta.valor,
    });
  }
  return out;
}
