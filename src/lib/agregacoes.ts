// ─── Agregações das movimentações confirmadas ───────────────────────────────
// Funções puras, sem React: somam o extrato por mês e por categoria. São a base
// das Análises financeiras nas DUAS telas — a de computador (telas/relatorios)
// e a de celular (telas/caixa-celular) —, então os números batem entre si.
//
// Tudo aqui é REALIZADO: o que já passou pelo extrato. Nada de previsto.
import type { Movimentacao, MovimentacaoRel } from "@/lib/queries";

export const MESES_PT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

export const labelMes = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${MESES_PT[Number(m) - 1]}/${y.slice(2)}`;
};

export type MesAgg = {
  ym: string;
  mes: string;
  entradas: number;
  saidas: number;
  resultado: number;
};

// Por mês de COMPETÊNCIA (mês anterior ou seguinte quando a categoria pede),
// que é o que faz o relatório mensal fechar com o regime da empresa.
export function agrupaPorMes(movs: MovimentacaoRel[]): MesAgg[] {
  const map = new Map<string, { entradas: number; saidas: number }>();
  for (const m of movs) {
    const ym = m.mesComp;
    const e = map.get(ym) ?? { entradas: 0, saidas: 0 };
    if (m.tipo === "in") e.entradas += m.valor;
    else e.saidas += m.valor;
    map.set(ym, e);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ym, v]) => ({
      ym,
      mes: labelMes(ym),
      entradas: v.entradas,
      saidas: v.saidas,
      resultado: v.entradas - v.saidas,
    }));
}

export type DiaAgg = { dia: string; iso: string; entradas: number; saidas: number };

// Por dia real do lançamento (o dia em que o dinheiro andou), não por
// competência: é o fluxo de caixa, e caixa não se desloca de mês.
export function agrupaPorDia(movs: Movimentacao[]): DiaAgg[] {
  const map = new Map<string, DiaAgg>();
  for (const m of movs) {
    const e = map.get(m.dataISO) ?? { dia: m.date, iso: m.dataISO, entradas: 0, saidas: 0 };
    if (m.tipo === "in") e.entradas += m.valor;
    else e.saidas += m.valor;
    map.set(m.dataISO, e);
  }
  return [...map.values()].sort((a, b) => a.iso.localeCompare(b.iso));
}

// Pelo caminho inteiro da categoria ("Pai / Filho").
export function agrupaPorCategoria(movs: Movimentacao[], tipo: "in" | "out") {
  const map = new Map<string, number>();
  for (const m of movs) {
    if (m.tipo !== tipo) continue;
    const c = m.cat?.trim() || "(sem categoria)";
    map.set(c, (map.get(c) ?? 0) + m.valor);
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

// Por categoria GERAL: a raiz do caminho "Pai / Filho" (→ "Pai"). É assim que a
// pizza (e a rosca do celular) resume por categoria de topo, somando as filhas.
export function agrupaPorCategoriaGeral(movs: Movimentacao[], tipo: "in" | "out") {
  const map = new Map<string, number>();
  for (const m of movs) {
    if (m.tipo !== tipo) continue;
    const raiz = (m.cat?.split("/")[0] ?? "").trim() || "(sem categoria)";
    map.set(raiz, (map.get(raiz) ?? 0) + m.valor);
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}
