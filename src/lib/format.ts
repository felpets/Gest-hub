// Utilitários de formatação e tipos compartilhados.

// Valor em Real: 1234.5 → "R$ 1.234,50"
export const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Valor compacto p/ eixos/badges: 10324.97 → "10,3K"; < 1000 → inteiro.
export const fmtK = (v: number) => {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1).replace(".", ",")}K`;
  return v.toFixed(0);
};

// Normaliza p/ comparação: remove acentos, minúsculas, trim.
// (Vive aqui — e não em import-parsers — para não arrastar o xlsx pro bundle.)
export const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Lê o valueAsNumber de um <input type="number">: NaN (campo vazio/inválido)
// vira 0. Substitui o padrão `valueAsNumber || 0`, que também zerava valores
// válidos "falsy" e escondia o problema do campo vazio.
export const numFromInput = (v: number): number => (Number.isNaN(v) ? 0 : v);

// Limita um dia de vencimento a [1, max]. Padrão 31: qualquer dia do mês
// serve, e quem não existe no mês (31 em fevereiro) cai no último dia dele —
// quem faz isso é isoDiaDoMes, em lib/datas. NaN → 1.
export const clampDia = (n: number, max = 31): number =>
  Number.isFinite(n) ? Math.max(1, Math.min(max, Math.round(n))) : 1;

// ─── Clientes ────────────────────────────────────────────────────────────────
export type ClienteStatus = "Pago" | "Pendente" | "Inadimplente" | "Inativo";

// ─── Pessoas ─────────────────────────────────────────────────────────────────
// Nome exibível a partir do e-mail do login: "ana.paula@zaytan.com" → "Ana
// Paula". O sistema não guarda nome de usuário separado, e mostrar o e-mail
// inteiro na lista e nos avisos polui — o e-mail completo fica no `title`.
export const nomeDoEmail = (email: string): string => {
  const local = (email ?? "").split("@")[0] ?? "";
  if (!local) return "";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
};
