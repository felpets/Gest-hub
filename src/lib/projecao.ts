// Projeção de saldo: parte do saldo atual (do extrato) e soma os lançamentos
// FUTUROS já conhecidos (contas a pagar/receber em aberto). Puro e testável.
import { buildDailyBalance, type SaldoPoint } from "@/lib/saldo";

const r2 = (n: number) => Math.round(n * 100) / 100;

// ─── Projeção simples "fim do mês" (usada no Dashboard) ──────
// Saldo atual + impacto dos previstos EM ABERTO (não pagos) com vencimento
// dentro de [deISO, ateISO]. NÃO assume que os previstos marcados "pago" já
// baixaram o saldo — marcar pago só os tira das obrigações em aberto; o efeito
// real no saldo chega quando o extrato é importado. Inclui vencidos-não-pagos
// do período (deISO = início do mês) para não subestimar as saídas.
export type PrevistoProj = { data: string; tipo: "in" | "out"; valor: number; pago: boolean };

export function projecaoFimMes(
  saldoAtual: number,
  previstos: PrevistoProj[],
  deISO: string,
  ateISO: string
): { saldoProjetado: number; qtd: number; impacto: number } {
  const abertos = previstos.filter((p) => !p.pago && p.data >= deISO && p.data <= ateISO);
  const impacto = abertos.reduce((s, p) => s + (p.tipo === "in" ? p.valor : -p.valor), 0);
  return { saldoProjetado: r2(saldoAtual + impacto), qtd: abertos.length, impacto: r2(impacto) };
}

// ─── Projeção diária ao longo de um horizonte (tela de Fluxo de Caixa) ──
// Lançamento futuro genérico (previsto ou cobrança), reduzido ao que o cálculo lê.
export type LancamentoFuturo = { dataISO: string; tipo: "in" | "out"; valor: number };
export type ProjecaoPoint = SaldoPoint & { projetado: boolean };
export type Projecao = {
  series: ProjecaoPoint[];
  saldoInicial: number;
  saldoFinal: number;
  saldoMinimo: { date: string; saldo: number } | null;
  ficaNegativo: boolean;
  primeiroDiaNegativo: string | null;
};

// Série diária do saldo projetado de `dataInicial` até `horizonteFinal`,
// partindo de `saldoInicial` (o saldo atual). Delega a buildDailyBalance —
// mesma agregação por dia, arredondamento e ponto-base. O 1º ponto (hoje) é a
// "dobradiça" (projetado:false); os demais são projetados.
export function buildProjecao(
  saldoInicial: number,
  dataInicial: string,
  lancamentos: LancamentoFuturo[],
  horizonteFinal: string
): Projecao {
  const dentro = lancamentos.filter((l) => l.dataISO >= dataInicial && l.dataISO <= horizonteFinal);
  const { series: base } = buildDailyBalance(dentro, saldoInicial, dataInicial);
  const series: ProjecaoPoint[] = base.map((p, i) => ({ ...p, projetado: i > 0 }));

  const saldoFinal = series.length ? series[series.length - 1].saldo : r2(saldoInicial);
  let saldoMinimo: { date: string; saldo: number } | null = null;
  let primeiroDiaNegativo: string | null = null;
  for (const p of series) {
    if (!saldoMinimo || p.saldo < saldoMinimo.saldo) saldoMinimo = { date: p.date, saldo: p.saldo };
    if (primeiroDiaNegativo === null && p.saldo < 0) primeiroDiaNegativo = p.date;
  }
  return {
    series,
    saldoInicial: r2(saldoInicial),
    saldoFinal,
    saldoMinimo,
    ficaNegativo: primeiroDiaNegativo !== null,
    primeiroDiaNegativo,
  };
}

// Seleciona os lançamentos futuros das fontes existentes, aplicando a regra
// anti-dupla-contagem: só previstos NÃO pagos e cobranças EM ABERTO, dentro do
// intervalo. Cobranças são a fonte canônica do "a receber".
export type PrevistoFuturo = { data: string; tipo: "in" | "out"; valor: number; pago: boolean; descricao?: string };
export type CobrancaFutura = { vencimento: string; valor: number; status: string; descricao?: string; clienteId?: string };

// O mesmo lançamento, com o que a tela precisa para dizer DE ONDE ele vem.
export type ItemProjecao = LancamentoFuturo & {
  origem: "previsto" | "cobranca";
  descricao: string;
  clienteId?: string;
};

export function itensDaProjecao(
  previstos: PrevistoFuturo[],
  cobrancas: CobrancaFutura[],
  dataInicial: string,
  horizonteFinal: string,
  opts?: { incluirPrevistos?: boolean; incluirCobrancas?: boolean }
): ItemProjecao[] {
  const incluirPrevistos = opts?.incluirPrevistos ?? true;
  const incluirCobrancas = opts?.incluirCobrancas ?? true;
  const out: ItemProjecao[] = [];
  if (incluirPrevistos) {
    for (const p of previstos) {
      if (p.pago) continue;
      if (p.data >= dataInicial && p.data <= horizonteFinal) {
        out.push({ dataISO: p.data, tipo: p.tipo, valor: p.valor, origem: "previsto", descricao: p.descricao ?? "" });
      }
    }
  }
  if (incluirCobrancas) {
    for (const c of cobrancas) {
      if (c.status !== "aberto") continue;
      if (c.vencimento >= dataInicial && c.vencimento <= horizonteFinal) {
        out.push({ dataISO: c.vencimento, tipo: "in", valor: c.valor, origem: "cobranca", descricao: c.descricao ?? "", clienteId: c.clienteId });
      }
    }
  }
  return out;
}

export function lancamentosFuturos(
  previstos: PrevistoFuturo[],
  cobrancas: CobrancaFutura[],
  dataInicial: string,
  horizonteFinal: string,
  opts?: { incluirPrevistos?: boolean; incluirCobrancas?: boolean }
): LancamentoFuturo[] {
  return itensDaProjecao(previstos, cobrancas, dataInicial, horizonteFinal, opts)
    .map(({ dataISO, tipo, valor }) => ({ dataISO, tipo, valor }));
}

// Mês a mês: quanto entra, quanto sai e com quanto o caixa termina cada mês,
// partindo do saldo de hoje. Mês sem lançamento não aparece.
export type MesProjecao = { mes: string; entradas: number; saidas: number; saldoFinal: number };

export function resumoPorMes(saldoInicial: number, lancamentos: LancamentoFuturo[]): MesProjecao[] {
  const porMes = new Map<string, { entradas: number; saidas: number }>();
  for (const l of lancamentos) {
    const mes = l.dataISO.slice(0, 7);
    const m = porMes.get(mes) ?? { entradas: 0, saidas: 0 };
    if (l.tipo === "in") m.entradas += l.valor;
    else m.saidas += l.valor;
    porMes.set(mes, m);
  }
  let saldo = saldoInicial;
  return [...porMes.keys()].sort().map((mes) => {
    const m = porMes.get(mes)!;
    saldo = r2(saldo + m.entradas - m.saidas);
    return { mes, entradas: r2(m.entradas), saidas: r2(m.saidas), saldoFinal: saldo };
  });
}

// Une a série REALIZADA (passado → hoje) com a PROJETADA num só dataset para o
// gráfico: no dia de hoje (dobradiça) ambos os campos recebem o mesmo valor,
// para as duas linhas se conectarem sem "buraco".
export type PontoGrafico = {
  day: string;
  date: string;
  saldoRealizado: number | null;
  saldoProjetado: number | null;
};

export function mergeRealizadoProjetado(realizado: SaldoPoint[], projecao: ProjecaoPoint[]): PontoGrafico[] {
  const map = new Map<string, PontoGrafico>();
  for (const p of realizado) {
    map.set(p.date, { day: p.day, date: p.date, saldoRealizado: p.saldo, saldoProjetado: null });
  }
  for (const p of projecao) {
    const ex = map.get(p.date);
    if (ex) ex.saldoProjetado = p.saldo;
    else map.set(p.date, { day: p.day, date: p.date, saldoRealizado: null, saldoProjetado: p.saldo });
  }
  // Dobradiça: no 1º ponto da projeção (hoje) as duas linhas compartilham o valor.
  const hinge = projecao[0];
  if (hinge) {
    const ex = map.get(hinge.date) ?? { day: hinge.day, date: hinge.date, saldoRealizado: null, saldoProjetado: null };
    ex.saldoRealizado = ex.saldoRealizado ?? hinge.saldo;
    ex.saldoProjetado = hinge.saldo;
    map.set(hinge.date, ex);
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
