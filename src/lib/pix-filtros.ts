// ─── Filtros do Pix do dia (tela de celular) ────────────────────────────────
// A tela de filtros do app (tela 06 do desenho) escolhe período, situação, tipo
// de chave, quem lançou e faixa de valor. Quem decide o que entra na lista é
// este módulo: função pura, sem React, testada em pix-filtros.test.ts.
//
// Mora aqui, e não dentro da tela, porque isto decide o que a pessoa VÊ na hora
// de pagar — se um pendente sumir da lista por causa de um filtro mal aplicado,
// alguém deixa de pagar. É regra, não enfeite.
import { pad } from "@/lib/datas";
import type { PagamentoDiario } from "@/lib/queries";
import { formatarChavePix, type TipoChavePix } from "@/lib/pix";

export type Situacao = "pendente" | "pago" | "estornado";

export const situacaoDe = (p: PagamentoDiario): Situacao =>
  p.estornado ? "estornado" : p.pago ? "pago" : "pendente";

export type ModoPeriodo = "dia" | "7dias" | "mes" | "personalizado";

export type Filtros = {
  busca: string;
  periodo: ModoPeriodo;
  /** Só no modo "personalizado". */
  de: string;
  ate: string;
  /** Situações que entram. Vazio nunca: a tela garante ao menos uma. */
  status: Situacao[];
  /** Tipos de chave que entram. Vazio = todos. */
  tipos: TipoChavePix[];
  /** E-mail de quem lançou. Vazio = todos. */
  autor: string;
  valorMin: number | null;
  valorMax: number | null;
};

export const FILTROS_PADRAO: Filtros = {
  busca: "",
  periodo: "dia",
  de: "",
  ate: "",
  status: ["pendente"],
  tipos: [],
  autor: "",
  valorMin: null,
  valorMax: null,
};

// Datas ISO tratadas como texto (o fuso do Brasil faz `new Date(iso)` voltar um
// dia). Comparar "YYYY-MM-DD" com < e > funciona porque o formato é ordenável.
const daISO = (iso: string) => {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d);
};
const paraISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const somaDias = (iso: string, n: number) => {
  const d = daISO(iso);
  d.setDate(d.getDate() + n);
  return paraISO(d);
};

/**
 * O intervalo de datas que o filtro pede, a partir do dia em foco na tira.
 * "7 dias" são os sete terminando no dia escolhido (ele inclusive), e não os
 * sete seguintes: quem paga olha para trás, para o que ficou.
 */
export function intervaloDe(f: Filtros, dia: string): { de: string; ate: string } {
  if (f.periodo === "dia") return { de: dia, ate: dia };
  if (f.periodo === "7dias") return { de: somaDias(dia, -6), ate: dia };
  if (f.periodo === "mes") {
    const d = daISO(dia);
    const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const ym = dia.slice(0, 7);
    return { de: `${ym}-01`, ate: `${ym}-${pad(ultimo)}` };
  }
  // Personalizado com um lado em branco vale como "sem limite daquele lado".
  return { de: f.de || "0000-01-01", ate: f.ate || "9999-12-31" };
}

/** Quantos filtros estão fora do padrão — vira a bolinha no botão de filtro. */
export function quantosFiltros(f: Filtros): number {
  let n = 0;
  if (f.busca.trim()) n++;
  if (f.periodo !== FILTROS_PADRAO.periodo) n++;
  if (f.tipos.length) n++;
  if (f.autor) n++;
  if (f.valorMin !== null || f.valorMax !== null) n++;
  // Situação não conta: ela é a aba, sempre visível na tela.
  return n;
}

/** Aplica tudo menos a situação — que é a aba, e é contada à parte. */
export function filtrarPagamentos(
  pagamentos: PagamentoDiario[],
  f: Filtros,
  dia: string,
  autorDe: (id: string) => string | undefined = () => undefined,
): PagamentoDiario[] {
  const { de, ate } = intervaloDe(f, dia);
  const busca = f.busca.trim().toLowerCase();
  const tipos = new Set(f.tipos);

  return pagamentos.filter((p) => {
    if (p.data < de || p.data > ate) return false;
    if (tipos.size && !tipos.has(p.tipoChave)) return false;
    if (f.autor && autorDe(p.id) !== f.autor) return false;
    if (f.valorMin !== null && p.valor < f.valorMin) return false;
    if (f.valorMax !== null && p.valor > f.valorMax) return false;
    if (busca) {
      const alvo = [p.titular, p.chavePix, formatarChavePix(p.chavePix, p.tipoChave), p.descricao]
        .join(" ")
        .toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

/** Quantos de cada situação, já com os demais filtros aplicados. */
export function contarPorSituacao(lista: PagamentoDiario[]): Record<Situacao, number> {
  const c: Record<Situacao, number> = { pendente: 0, pago: 0, estornado: 0 };
  for (const p of lista) c[situacaoDe(p)]++;
  return c;
}

/** O que a lista mostra: o filtro completo, incluindo a situação escolhida. */
export function listaVisivel(
  pagamentos: PagamentoDiario[],
  f: Filtros,
  dia: string,
  autorDe?: (id: string) => string | undefined,
): PagamentoDiario[] {
  const status = new Set(
    f.status.length ? f.status : (["pendente", "pago", "estornado"] as Situacao[]),
  );
  return filtrarPagamentos(pagamentos, f, dia, autorDe).filter((p) => status.has(situacaoDe(p)));
}
