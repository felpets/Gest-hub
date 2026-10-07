// Utilitários de data compartilhados. Antes eram reimplementados em ~10 arquivos.
// ATENÇÃO: há DUAS semânticas de "hoje" no projeto e elas NÃO são equivalentes
// perto da meia-noite (o Brasil é UTC-3). Mantidas separadas de propósito para
// não mudar o comportamento de nenhum chamador:
//   - todayISO(): baseada em UTC (toISOString) — usada em telas de cadastro.
//   - hojeISO():  baseada no fuso LOCAL — usada em cálculos de vencimento/dia.

// 7 → "07"
export const pad = (n: number) => String(n).padStart(2, "0");

// "2026-07-06" → "06/07"
export const ddMM = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

// "2026-07-06" → "06/07/2026"
// Timestamp ISO (com hora) -> "dd/mm/aaaa hh:mm" no fuso LOCAL.
export const fmtDataHora = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const fmtBR = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

// Hoje em ISO (YYYY-MM-DD) pela data UTC.
export const todayISO = () => new Date().toISOString().slice(0, 10);

// Hoje em ISO (YYYY-MM-DD) pelo fuso LOCAL.
export const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// 1º dia do mês corrente (YYYY-MM-01) pelo fuso LOCAL.
export const compAtual = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
};

// "2026-08" → "2026-07" (mês anterior). Trata virada de ano: "2026-01" → "2025-12".
export const mesAnterior = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  return m <= 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
};

// "2026-12" → "2027-01" (mês seguinte). Trata virada de ano.
export const mesSeguinte = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  return m >= 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
};

// "2026-09" → "Setembro de 2026". Pelas partes, nunca new Date(iso), que no
// fuso do Brasil volta um dia. Usado pelas telas de celular, onde o mês é um
// título e não cabe abreviado.
export const nomeMesLongo = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  const nome = new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long" });
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${y}`;
};

// Como uma categoria decide o mês de competência de um lançamento.
export type CompetenciaModo =
  | "pagamento"       // mês da própria data (padrão)
  | "anterior"        // sempre o mês anterior
  | "seguinte"        // sempre o mês seguinte
  | "corte_seguinte"  // a partir do dia de corte → mês seguinte
  | "corte_anterior"; // até o dia de corte → mês anterior

// Mês de COMPETÊNCIA ("YYYY-MM") de uma data, conforme o modo da categoria.
// `diaCorte` só é usado nos modos de corte.
export const mesCompetencia = (
  dataISO: string,
  modo: CompetenciaModo,
  diaCorte?: number | null
): string => {
  const ym = dataISO.slice(0, 7);
  const dia = Number(dataISO.slice(8, 10));
  switch (modo) {
    case "anterior": return mesAnterior(ym);
    case "seguinte": return mesSeguinte(ym);
    case "corte_seguinte": return diaCorte != null && dia >= diaCorte ? mesSeguinte(ym) : ym;
    case "corte_anterior": return diaCorte != null && dia <= diaCorte ? mesAnterior(ym) : ym;
    default: return ym; // "pagamento"
  }
};

// Data de COMPETÊNCIA (YYYY-MM-DD): o MESMO dia do pagamento, mas no mês de
// competência (clampado ao tamanho do mês). Sem deslocamento, devolve a data
// real. Serve para os relatórios filtrarem pelo mês de competência, não pela
// data de caixa.
export const dataCompetencia = (
  dataISO: string,
  modo: CompetenciaModo,
  diaCorte?: number | null
): string => {
  const mc = mesCompetencia(dataISO, modo, diaCorte);
  if (mc === dataISO.slice(0, 7)) return dataISO;
  const [cy, cm] = mc.split("-").map(Number);
  const ultimo = new Date(cy, cm, 0).getDate(); // último dia do mês de competência
  const dia = Math.min(Number(dataISO.slice(8, 10)), ultimo);
  return `${mc}-${pad(dia)}`;
};

// Date (fuso LOCAL) → "YYYY-MM-DD". Interno aos helpers de dia útil abaixo.
const isoLocal = (dt: Date) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;

// Data ISO do dia `dia` dentro do mês (ano, mes) — mes 1..12. O dia que não
// existe naquele mês cai no ÚLTIMO dia dele, nunca vira o mês seguinte:
// 31 em fevereiro = 28 (ou 29 em bissexto), 31 em abril = 30. É o que faz
// "todo dia 30" e a opção "Último dia do mês" (gravada como dia 31) caírem
// sempre no mês certo. O ajuste de dia útil, quando vale, vem depois.
export const isoDiaDoMes = (ano: number, mes: number, dia: number): string => {
  const ultimo = new Date(ano, mes, 0).getDate();
  const d = Math.max(1, Math.min(ultimo, Math.round(dia) || 1));
  return `${ano}-${pad(mes)}-${pad(d)}`;
};

// Dia da semana (0 = domingo … 6 = sábado) de "YYYY-MM-DD".
// Constrói a data pelas partes (fuso LOCAL) para não depender de parsing UTC
// (new Date("2026-08-01") seria meia-noite UTC e mudaria o dia).
const dow = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
};

// "2026-08-01" → true se cair em sábado ou domingo.
export const ehFimDeSemana = (iso: string): boolean => dow(iso) === 0 || dow(iso) === 6;

// "2026-08-02" → true se cair em domingo. Usado só na CONTAGEM trabalhista
// (nthDiaUtil), onde o sábado conta como dia útil e o domingo não.
export const ehDomingo = (iso: string): boolean => dow(iso) === 0;

// Antecipa `iso` para o DIA ÚTIL ANTERIOR quando cai em fim de semana ou feriado.
// `feriados` é o conjunto (nacionais + da empresa) já pronto, em "YYYY-MM-DD"
// (vem de fn_feriados_efetivos). Convenção *Preceding*: SEMPRE o dia útil
// imediatamente anterior, mesmo que caia no mês anterior (ex.: 01/08 sáb →
// 31/07 sex) — nunca paga depois do vencimento. A extensão de recorrências
// (reconciliarRecorrentes) reconcilia por regra, então tolera a data
// gravada ficar num mês diferente do vencimento.
export const diaUtilAnterior = (iso: string, feriados: Set<string>): string => {
  const ehDiaUtil = (s: string) => !ehFimDeSemana(s) && !feriados.has(s);
  if (ehDiaUtil(iso)) return iso;

  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  for (let i = 0; i < 40; i++) {
    dt.setDate(dt.getDate() - 1); // anda para trás, cruzando o mês se preciso
    const s = isoLocal(dt);
    if (ehDiaUtil(s)) return s;
  }

  return iso; // inalcançável na prática (todo mês tem dia útil)
};

// N-ésimo DIA ÚTIL do mês, contando para FRENTE a partir do dia 1. Ex.:
// nthDiaUtil(2026, 7, 5, feriados) = 5º dia útil de julho/2026 (data do salário).
//
// ATENÇÃO — são DUAS regras diferentes, de propósito:
//  1. CONTAGEM (trabalhista/CLT): sábado É dia útil. Só domingo e feriado não
//     contam. É assim que se conta o "5º dia útil" de salário, VT e VR.
//  2. POUSO (expediente/banco): não se paga em sábado. Se o N-ésimo cair num
//     sábado, o resultado é antecipado para a sexta (diaUtilAnterior) — nunca
//     empurrado para frente, que passaria do prazo legal.
//
// Consequências esperadas dessa combinação:
//  - Com N=1 e o dia 1 caindo em sábado, o resultado fica na sexta do MÊS
//    ANTERIOR (ex.: 01/08/2026 sáb → 31/07/2026). Pagar antes é sempre válido,
//    e reconciliarRecorrentes reconcilia por regra, então tolera isso.
//  - Dois N vizinhos podem colapsar na mesma data quando o maior cai em sábado.
//
// `feriados` é o conjunto (nacionais + da empresa) de fn_feriados_efetivos.
// Se `n` exceder os dias contados do mês, usa o ÚLTIMO deles (clamp).
export const nthDiaUtil = (ano: number, mes: number, n: number, feriados: Set<string>): string => {
  const conta = (s: string) => !ehDomingo(s) && !feriados.has(s); // sábado conta
  const diasNoMes = new Date(ano, mes, 0).getDate(); // mes 1-based → último dia do mês
  const alvo = Math.max(1, n);
  let count = 0;
  let ultimo = `${ano}-${pad(mes)}-01`;
  for (let d = 1; d <= diasNoMes; d++) {
    const s = `${ano}-${pad(mes)}-${pad(d)}`;
    if (conta(s)) {
      ultimo = s;
      if (++count === alvo) return diaUtilAnterior(s, feriados);
    }
  }
  return diaUtilAnterior(ultimo, feriados); // n grande demais → último do mês
};
