// ─── O que cai em cada cartão ──────────────────────────────────────────────
// A fatura chega pelo extrato como uma movimentação só. O que a empresa quer
// saber é o contrário: o que DENTRO dela é o quê, e quanto ainda falta pagar.
//
// Isso já existe espalhado: cada ferramenta é uma recorrência com categoria
// própria, e cada mês dela vira um pagamento previsto. Aqui só juntamos as duas
// pontas pelo cartão, sem inventar um cadastro de fatura.
//
// "Parcela 3 de 12" também não é campo novo: uma recorrência com início e fim
// já diz quantos meses ela tem. Contínua (sem fim) não é parcelada.

export type PrevistoCartao = {
  id: string;
  data: string;             // YYYY-MM-DD
  descricao: string;
  categoria: string;
  valor: number;
  pago: boolean;
  recorrenteId: string | null;
  cartaoId: string | null;
};

export type RecorrenteCartao = {
  id: string;
  inicio: string;           // YYYY-MM-DD
  fim: string | null;       // null = contínua
  cartaoId?: string | null;
};

export type ItemCartao = PrevistoCartao & {
  // null quando a recorrência é contínua (ou o item é avulso).
  parcela: { atual: number; total: number } | null;
  contínua: boolean;
};

const ym = (iso: string) => iso.slice(0, 7);

// Quantos meses entre duas competências, inclusive.
export function mesesEntreYM(de: string, ate: string): number {
  const [ay, am] = de.split("-").map(Number);
  const [by, bm] = ate.split("-").map(Number);
  if (!ay || !by) return 0;
  return (by - ay) * 12 + (bm - am) + 1;
}

// "Parcela 3 de 12" a partir da regra: posição do mês dentro de início..fim.
export function parcelaDe(rec: RecorrenteCartao | undefined, dataISO: string): { atual: number; total: number } | null {
  if (!rec || !rec.fim) return null;
  const total = mesesEntreYM(ym(rec.inicio), ym(rec.fim));
  const atual = mesesEntreYM(ym(rec.inicio), ym(dataISO));
  if (total < 1 || atual < 1 || atual > total) return null;
  return { atual, total };
}

// Itens de um cartão numa janela de datas, do mais próximo ao mais distante.
export function itensDoCartao(
  previstos: PrevistoCartao[],
  recorrentes: RecorrenteCartao[],
  cartaoId: string,
  janela: { de: string; ate: string },
): ItemCartao[] {
  const porId = new Map(recorrentes.map((r) => [r.id, r]));
  return previstos
    .filter((p) => p.cartaoId === cartaoId && p.data >= janela.de && p.data <= janela.ate)
    .map((p) => {
      const rec = p.recorrenteId ? porId.get(p.recorrenteId) : undefined;
      return { ...p, parcela: parcelaDe(rec, p.data), contínua: !!rec && !rec.fim };
    })
    .sort((a, b) => a.data.localeCompare(b.data) || a.descricao.localeCompare(b.descricao, "pt-BR"));
}

// Quanto o cartão compromete em cada mês da janela — é a resposta para
// "quanto ainda vai sair daqui para a frente".
export function totalPorMes(itens: ItemCartao[]): { mes: string; total: number; itens: number }[] {
  const mapa = new Map<string, { mes: string; total: number; itens: number }>();
  for (const i of itens) {
    const chave = ym(i.data);
    const atual = mapa.get(chave) ?? { mes: chave, total: 0, itens: 0 };
    atual.total = Math.round((atual.total + i.valor) * 100) / 100;
    atual.itens += 1;
    mapa.set(chave, atual);
  }
  return [...mapa.values()].sort((a, b) => a.mes.localeCompare(b.mes));
}

// ─── Demonstrativo do extrato do cartão (migração 53) ──────────────────────
// As compras importadas se agrupam pela FATURA em que caem: compra depois do
// dia de fechamento vai para a fatura seguinte. A fatura é identificada pelo
// mês do vencimento (é o mês em que o dinheiro sai da conta). Sem dia de
// fechamento cadastrado, vale o mês da compra.

const somaMes = (ymStr: string, n: number) => {
  const [y, m] = ymStr.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export function faturaDe(
  dataISO: string,
  cartao: { diaFechamento: number | null; diaVencimento: number | null },
): string {
  const mesCompra = ym(dataISO);
  if (!cartao.diaFechamento) return mesCompra;
  const dia = Number(dataISO.slice(8, 10));
  const mesFechamento = dia > cartao.diaFechamento ? somaMes(mesCompra, 1) : mesCompra;
  // Vence no mês seguinte ao fechamento quando o dia de vencimento vem antes
  // (ou no mesmo dia) do fechamento — o caso comum: fecha 28, vence 5.
  const venceNoMesSeguinte = !cartao.diaVencimento || cartao.diaVencimento <= cartao.diaFechamento;
  return venceNoMesSeguinte ? somaMes(mesFechamento, 1) : mesFechamento;
}

export type LancamentoCartao = { dataISO: string; valor: number; tipo: "in" | "out"; categoria: string };

export type ResumoFatura = {
  mes: string;       // YYYY-MM da fatura (mês do vencimento)
  gastos: number;    // compras
  creditos: number;  // pagamentos da fatura (todo valor positivo)
  itens: number;
};

export function resumoPorFatura<T extends LancamentoCartao>(
  lancamentos: T[],
  cartao: { diaFechamento: number | null; diaVencimento: number | null },
): ResumoFatura[] {
  const mapa = new Map<string, ResumoFatura>();
  for (const l of lancamentos) {
    const mes = faturaDe(l.dataISO, cartao);
    const r = mapa.get(mes) ?? { mes, gastos: 0, creditos: 0, itens: 0 };
    if (l.tipo === "out") r.gastos = Math.round((r.gastos + l.valor) * 100) / 100;
    else r.creditos = Math.round((r.creditos + l.valor) * 100) / 100;
    r.itens += 1;
    mapa.set(mes, r);
  }
  return [...mapa.values()].sort((a, b) => b.mes.localeCompare(a.mes));
}

// Gasto por categoria dentro de uma fatura: só as compras. Todo valor
// positivo no cartão é tratado como PAGAMENTO da fatura — é quitação, não
// gasto — e fica fora daqui, tenha ou não categoria.
export function gastosPorCategoria(lancamentos: LancamentoCartao[]): { categoria: string; total: number }[] {
  const mapa = new Map<string, number>();
  for (const l of lancamentos) {
    if (l.tipo !== "out") continue;
    const chave = l.categoria || "";
    mapa.set(chave, (mapa.get(chave) ?? 0) + l.valor);
  }
  return [...mapa.entries()]
    .map(([categoria, total]) => ({ categoria, total: Math.round(total * 100) / 100 }))
    .filter((c) => c.total !== 0)
    .sort((a, b) => b.total - a.total);
}

// Descrição normalizada: o que a importação usa para lembrar a categoria que
// a mesma compra recebeu antes ("ANTHROPIC  CLAUDE*" ≈ "anthropic claude").
export const chaveDescricao = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
