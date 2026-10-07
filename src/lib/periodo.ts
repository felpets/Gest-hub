// ─── Período do Dashboard ──────────────────────────────────────────────────
// Um filtro só governa o dashboard inteiro: KPIs, gráfico, detalhamentos,
// projeções, despesas por categoria. Funções puras (sem React, sem relógio
// implícito: quem chama passa "hoje").

export type ModoPeriodo = "mes_atual" | "mes_anterior" | "mes" | "personalizado";

export type Periodo = {
  modo: ModoPeriodo;
  de: string;   // YYYY-MM-DD (inclusive)
  ate: string;  // YYYY-MM-DD (inclusive)
  mes: string;  // YYYY-MM quando o período é um mês inteiro; "" no personalizado
};

const pad2 = (n: number) => String(n).padStart(2, "0");

export const ymDe = (iso: string) => iso.slice(0, 7);

export function ultimoDiaDoMes(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${pad2(new Date(y, m, 0).getDate())}`;
}

export function mesAnterior(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`;
}

export function mesSeguinte(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`;
}

// Meses de `de` até `ate`, inclusive.
export function mesesEntreISO(de: string, ate: string): string[] {
  const out: string[] = [];
  let ym = ymDe(de);
  const fim = ymDe(ate);
  for (let i = 0; i < 240 && ym <= fim; i++) {
    out.push(ym);
    ym = mesSeguinte(ym);
  }
  return out;
}

export function periodoDoMes(ym: string, modo: ModoPeriodo = "mes"): Periodo {
  return { modo, de: `${ym}-01`, ate: ultimoDiaDoMes(ym), mes: ym };
}

export function periodoPadrao(hoje: string): Periodo {
  return periodoDoMes(ymDe(hoje), "mes_atual");
}

// Período personalizado: aceita as pontas fora de ordem e devolve ordenado.
export function periodoPersonalizado(de: string, ate: string): Periodo {
  const [a, b] = de <= ate ? [de, ate] : [ate, de];
  return { modo: "personalizado", de: a, ate: b, mes: ymDe(a) === ymDe(b) ? ymDe(a) : "" };
}

// Mês FECHADO = o período inteiro já passou. O que aconteceu, aconteceu: não há
// mais nada a projetar ali, e o dashboard mostra só realizado. O mês corrente e
// os futuros continuam somando realizado + projetado.
export function periodoFechado(p: Periodo, hoje: string): boolean {
  return p.ate < ymDe(hoje) + "-01";
}

// O período alcança o presente (ou o futuro)? Define se faz sentido falar em
// "saldo atual" e em vencimentos à frente.
export function alcancaHoje(p: Periodo, hoje: string): boolean {
  return p.ate >= hoje;
}

export function contemHoje(p: Periodo, hoje: string): boolean {
  return p.de <= hoje && hoje <= p.ate;
}

const MESES_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MESES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function nomeMes(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const nome = MESES_PT[(m || 1) - 1] ?? "";
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} ${y}`;
}

export function nomeMesCurto(ym: string): string {
  const [, m] = ym.split("-").map(Number);
  return MESES_CURTO[(m || 1) - 1] ?? "";
}

const ddMMyyyy = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

export function rotuloPeriodo(p: Periodo): string {
  if (p.mes && p.de === `${p.mes}-01` && p.ate === ultimoDiaDoMes(p.mes)) return nomeMes(p.mes);
  return `${ddMMyyyy(p.de)} a ${ddMMyyyy(p.ate)}`;
}

// Quantos dias o período cobre (inclusive).
export function diasNoPeriodo(p: Periodo): number {
  const [y1, m1, d1] = p.de.split("-").map(Number);
  const [y2, m2, d2] = p.ate.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1;
}

// O gráfico agrupa por dia em períodos curtos e por mês nos longos — 400 barras
// de um ano não dizem nada.
export function agruparPor(p: Periodo): "dia" | "mes" {
  return diasNoPeriodo(p) > 62 ? "mes" : "dia";
}

export function dentro(p: Periodo, iso: string): boolean {
  return !!iso && iso >= p.de && iso <= p.ate;
}
