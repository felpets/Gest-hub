// Filtros de movimentações (Movimentações e Relatórios) — lógica pura.
// Datas são strings ISO "YYYY-MM-DD" comparadas lexicograficamente (padrão do
// projeto); nada de Date para comparar. A UI vive em
// src/components/FiltrosMovimentacoes.tsx; aqui é só o que dá pra testar isolado.
import type { Conta, Movimentacao } from "@/lib/queries";
import { pad, hojeISO, fmtBR } from "@/lib/datas";
import { norm } from "@/lib/format";

// ─── Tipos ──────────────────────────────────────────────────
export type Filtros = {
  de: string | null; // "YYYY-MM-DD" inclusivo; null = sem limite inferior
  ate: string | null; // "YYYY-MM-DD" inclusivo; null = sem limite superior
  // null = todas. Valores: "Pai", "Pai / Filho", categoria solta do extrato,
  // ou SEM_CATEGORIA. Set vazio é normalizado para null pela UI.
  cats: Set<string> | null;
  busca: string; // busca APENAS em desc/ia (categoria tem filtro próprio)
  valorMin: number | null; // R$; null = sem piso
  valorMax: number | null; // R$; null = sem teto
};

// Sentinel p/ transações sem categoria (m.cat vazio) — nunca colide com nome real.
export const SEM_CATEGORIA = "__sem_categoria__";

export const FILTROS_VAZIO: Filtros = {
  de: null,
  ate: null,
  cats: null,
  busca: "",
  valorMin: null,
  valorMax: null,
};

// ─── Presets de período ─────────────────────────────────────
export type PresetPeriodo = "tudo" | "este-mes" | "mes-passado" | "30d" | "este-ano";
export const PRESETS: { id: PresetPeriodo; label: string }[] = [
  { id: "tudo", label: "Tudo" },
  { id: "este-mes", label: "Este mês" },
  { id: "mes-passado", label: "Mês passado" },
  { id: "30d", label: "30d" },
  { id: "este-ano", label: "Este ano" },
];

const ultimoDia = (ano: number, mes: number) => new Date(ano, mes, 0).getDate(); // mes 1-based

export function rangePreset(p: PresetPeriodo): { de: string | null; ate: string | null } {
  const hoje = hojeISO();
  const [y, m, d] = hoje.split("-").map(Number);
  switch (p) {
    case "tudo":
      return { de: null, ate: null };
    case "este-mes":
      return { de: `${y}-${pad(m)}-01`, ate: `${y}-${pad(m)}-${pad(ultimoDia(y, m))}` };
    case "mes-passado": {
      const ref = new Date(y, m - 2, 1); // Date normaliza jan → dez do ano anterior
      const ya = ref.getFullYear(), ma = ref.getMonth() + 1;
      return { de: `${ya}-${pad(ma)}-01`, ate: `${ya}-${pad(ma)}-${pad(ultimoDia(ya, ma))}` };
    }
    case "30d": {
      const ref = new Date(y, m - 1, d - 29); // hoje incluso ⇒ −29
      return { de: `${ref.getFullYear()}-${pad(ref.getMonth() + 1)}-${pad(ref.getDate())}`, ate: hoje };
    }
    case "este-ano":
      return { de: `${y}-01-01`, ate: `${y}-12-31` };
  }
}

// O chip de preset ativo é DERIVADO comparando o range atual — sem estado próprio.
export const mesmoRange = (f: Filtros, r: { de: string | null; ate: string | null }) =>
  f.de === r.de && f.ate === r.ate;

// ─── Aplicação (pura, usada nas duas telas) ─────────────────
// `getData` escolhe a data usada no filtro de PERÍODO. Padrão = data real
// (extrato). Nos relatórios passa-se a data de competência, para o filtro de
// mês respeitar categorias marcadas "conta no mês anterior/seguinte".
export function aplicaFiltros<T extends Movimentacao>(
  movs: T[],
  f: Filtros,
  getData: (m: T) => string = (m) => m.dataISO
): T[] {
  // Pontas invertidas (defensivo): troca em vez de zerar a lista.
  const [de, ate] = f.de && f.ate && f.de > f.ate ? [f.ate, f.de] : [f.de, f.ate];
  const [vMin, vMax] =
    f.valorMin != null && f.valorMax != null && f.valorMin > f.valorMax
      ? [f.valorMax, f.valorMin]
      : [f.valorMin, f.valorMax];
  const busca = norm(f.busca);
  const cats = f.cats && f.cats.size > 0 ? [...f.cats] : null;

  return movs.filter((m) => {
    const d = getData(m);
    if (de && d < de) return false;
    if (ate && d > ate) return false;
    if (vMin != null && m.valor < vMin) return false;
    if (vMax != null && m.valor > vMax) return false;
    if (
      cats &&
      !cats.some((v) =>
        v === SEM_CATEGORIA ? m.cat.trim() === "" : m.cat === v || m.cat.startsWith(v + " / ")
      )
    )
      return false;
    if (busca && !norm(m.desc).includes(busca) && !norm(m.ia).includes(busca)) return false;
    return true;
  });
}

export const filtrosAtivos = (f: Filtros) =>
  f.de !== null ||
  f.ate !== null ||
  (f.cats?.size ?? 0) > 0 ||
  f.busca.trim() !== "" ||
  f.valorMin !== null ||
  f.valorMax !== null;

// Rótulo do período (badge e subtitle do PDF).
export function resumoPeriodo(f: Filtros): string {
  if (!f.de && !f.ate) return "todo o período";
  if (f.de && f.ate) return `${fmtBR(f.de)} – ${fmtBR(f.ate)}`;
  return f.de ? `desde ${fmtBR(f.de)}` : `até ${fmtBR(f.ate!)}`;
}

// ─── Competência × data do pagamento ────────────────────────
// Categoria com regra de competência ("conta no mês anterior/seguinte") move o
// lançamento de mês nos relatórios, mas não no caixa: a Visão geral segue a
// data em que o dinheiro saiu. Daí os dois números diferentes no mesmo mês.
// Aqui está o de-para do período escolhido, para a tela explicar a diferença
// em vez de deixar o usuário procurar.
export type MovComCompetencia = { dataISO: string; dataComp: string; tipo: "in" | "out"; valor: number; cat: string };

export type DeslocamentoCompetencia = {
  // pagos no período, contados em outro mês
  saiuEntradas: number; saiuSaidas: number;
  // pagos em outro mês, contados neste período
  entrouEntradas: number; entrouSaidas: number;
  categorias: string[];
  temDiferenca: boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function deslocamentoCompetencia(
  movs: MovComCompetencia[],
  de: string | null,
  ate: string | null,
): DeslocamentoCompetencia {
  const dentro = (d: string) => (!de || d >= de) && (!ate || d <= ate);
  let saiuEntradas = 0, saiuSaidas = 0, entrouEntradas = 0, entrouSaidas = 0;
  const categorias = new Set<string>();
  for (const m of movs) {
    if (m.dataISO === m.dataComp) continue;
    const noPeriodoPorData = dentro(m.dataISO);
    const noPeriodoPorComp = dentro(m.dataComp);
    if (noPeriodoPorData === noPeriodoPorComp) continue;
    categorias.add(m.cat || "(sem categoria)");
    if (noPeriodoPorData) {
      if (m.tipo === "in") saiuEntradas += m.valor; else saiuSaidas += m.valor;
    } else {
      if (m.tipo === "in") entrouEntradas += m.valor; else entrouSaidas += m.valor;
    }
  }
  const total = saiuEntradas + saiuSaidas + entrouEntradas + entrouSaidas;
  return {
    saiuEntradas: r2(saiuEntradas), saiuSaidas: r2(saiuSaidas),
    entrouEntradas: r2(entrouEntradas), entrouSaidas: r2(entrouSaidas),
    categorias: [...categorias].sort(),
    temDiferenca: total > 0,
  };
}

// ─── Opções de categoria do filtro ──────────────────────────
// O plano de contas (hierárquico: "Pai" e "Pai / Filho") mais as categorias
// soltas que vieram no extrato e não estão no plano. As DUAS telas de filtro
// montam a lista daqui — a de computador (components/FiltrosMovimentacoes) e a
// folha do celular —, senão uma ofereceria categoria que a outra não conhece.
export type GrupoCat = { titulo: string; opcoes: { value: string; label: string; filho: boolean }[] };

export function opcoesDeCategoria(
  planoContas: Conta[],
  movimentos: Movimentacao[],
): { grupos: GrupoCat[]; temSemCategoria: boolean } {
  const roots = planoContas.filter((c) => !c.parentId);
  const grupos: GrupoCat[] = roots.map((root) => ({
    titulo: root.nome,
    opcoes: [
      { value: root.nome, label: root.nome, filho: false },
      ...planoContas
        .filter((c) => c.parentId === root.id)
        .map((c) => ({ value: `${root.nome} / ${c.nome}`, label: c.nome, filho: true })),
    ],
  }));
  const noPlano = new Set(grupos.flatMap((g) => g.opcoes.map((o) => o.value)));
  const soltas = [...new Set(movimentos.map((m) => m.cat).filter(Boolean))]
    .filter((c) => !noPlano.has(c))
    .sort((a, b) => a.localeCompare(b));
  if (soltas.length) {
    grupos.push({ titulo: "Do extrato", opcoes: soltas.map((c) => ({ value: c, label: c, filho: false })) });
  }
  return { grupos, temSemCategoria: movimentos.some((m) => !m.cat.trim()) };
}
