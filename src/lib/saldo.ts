import type { Movimentacao } from "@/lib/queries";
import { ddMM } from "@/lib/datas";

export type SaldoPoint = { day: string; date: string; saldo: number };

// Só os campos que o acúmulo diário lê. Movimentacao satisfaz isto, e também a
// projeção (lançamentos futuros) — permitindo reusar buildDailyBalance sem cast.
export type MovLike = { dataISO: string; tipo: "in" | "out"; valor: number };

// Série de saldo acumulado a partir de um saldo inicial numa data.
// Considera só as movimentações em/depois da data inicial (o saldo inicial
// já representa tudo que veio antes). Retorna a série diária e o saldo atual.
export function buildDailyBalance(
  movimentos: MovLike[],
  saldoInicial: number,
  dataInicial: string
): { series: SaldoPoint[]; saldoAtual: number } {
  const relevantes = movimentos.filter((m) => m.dataISO >= dataInicial);

  // Soma líquida por dia.
  const porDia = new Map<string, number>();
  for (const m of relevantes) {
    const delta = m.tipo === "in" ? m.valor : -m.valor;
    porDia.set(m.dataISO, (porDia.get(m.dataISO) ?? 0) + delta);
  }

  const dias = [...porDia.keys()].sort();
  let saldo = saldoInicial;
  // Ponto base = saldo inicial na data informada.
  const series: SaldoPoint[] = [{ day: ddMM(dataInicial), date: dataInicial, saldo: saldoInicial }];
  for (const d of dias) {
    saldo = Math.round((saldo + porDia.get(d)!) * 100) / 100;
    series.push({ day: ddMM(d), date: d, saldo });
  }

  return { series, saldoAtual: saldo };
}

// Saldo consolidado de VÁRIAS contas, cada uma com seu próprio saldo inicial e
// data de abertura. Uma conta contribui 0 ANTES da sua data de abertura (o saldo
// inicial só "existe" a partir dela — não é esticado para trás). O saldo atual
// consolidado é a soma dos saldos atuais de cada conta.
export type ContaSaldoInput = { movs: Movimentacao[]; saldoInicial: number; dataInicial: string };

export function buildConsolidatedBalance(
  contas: ContaSaldoInput[]
): { series: SaldoPoint[]; saldoAtual: number } {
  if (contas.length === 0) return { series: [], saldoAtual: 0 };

  // Série de cada conta (cada uma já começa no seu saldoInicial/dataInicial).
  const per = contas.map((c) => buildDailyBalance(c.movs, c.saldoInicial, c.dataInicial));

  // Eixo de datas = união ordenada de todas as datas.
  const dateSet = new Set<string>();
  for (const p of per) for (const pt of p.series) dateSet.add(pt.date);
  const dates = [...dateSet].sort();

  // Em cada data d, cada conta vale o último saldo com data <= d (0 antes da 1ª).
  // Como `dates` e cada série estão em ordem crescente, um ponteiro por série
  // (que só avança) dá o mesmo resultado em O(D + ΣS) em vez de O(D × ΣS).
  const idx = new Array(per.length).fill(-1);
  const cur = new Array(per.length).fill(0);
  const series: SaldoPoint[] = dates.map((date) => {
    let total = 0;
    for (let i = 0; i < per.length; i++) {
      const s = per[i].series;
      while (idx[i] + 1 < s.length && s[idx[i] + 1].date <= date) {
        idx[i] += 1;
        cur[i] = s[idx[i]].saldo;
      }
      total += cur[i];
    }
    return { day: ddMM(date), date, saldo: Math.round(total * 100) / 100 };
  });

  const saldoAtual = Math.round(per.reduce((s, p) => s + p.saldoAtual, 0) * 100) / 100;
  return { series, saldoAtual };
}

// Atalho usado nas telas: calcula a série/saldo a partir das contas e das
// movimentações, respeitando a conta ativa. `contaId` null = consolidado (todas).
// Em modo consolidado, `movimentos` traz TODAS as contas e é agrupado por
// conta_id; numa conta específica, `movimentos` já vem filtrado só dela.
type ContaSaldo = { id: string; saldoInicial: number; saldoInicialData: string };

export function saldoFromContas(
  contas: ContaSaldo[],
  movimentos: Movimentacao[],
  contaId: string | null
): { series: SaldoPoint[]; saldoAtual: number } {
  if (contaId) {
    const c = contas.find((x) => x.id === contaId);
    return buildDailyBalance(movimentos, c?.saldoInicial ?? 0, c?.saldoInicialData ?? "1970-01-01");
  }
  const byConta = new Map<string, Movimentacao[]>();
  for (const m of movimentos) {
    if (!m.contaId) continue;
    const arr = byConta.get(m.contaId);
    if (arr) arr.push(m);
    else byConta.set(m.contaId, [m]);
  }
  return buildConsolidatedBalance(
    contas.map((c) => ({
      movs: byConta.get(c.id) ?? [],
      saldoInicial: c.saldoInicial,
      dataInicial: c.saldoInicialData,
    }))
  );
}
