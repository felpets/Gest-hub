// ─── Funcionalidades opcionais (Configurações › Funcionalidades) ───────────
// Partes do sistema que nem toda empresa usa. Ficam em
// `configuracoes.funcionalidades` (jsonb, migração 47), uma linha por empresa.
// Sem valor gravado vale o `padrao` daqui — por isso nada muda de
// comportamento só por rodar a migração.

export type Funcionalidade = "dividas_acordos";

export type DefFuncionalidade = {
  chave: Funcionalidade;
  nome: string;
  desc: string;
  // Onde ela aparece quando está ligada (texto do cartão de configuração).
  onde: string;
  padrao: boolean;
};

export const FUNCIONALIDADES: DefFuncionalidade[] = [
  {
    chave: "dividas_acordos",
    nome: "Dívidas e acordos",
    desc: "Acordos parcelados com credor, parcelas, comprovantes e o próximo vencimento de cada um.",
    onde: "Financeiro › Pagamentos › Dívidas e acordos, e as parcelas na agenda do Dashboard.",
    padrao: true,
  },
];

export type MapaFuncionalidades = Partial<Record<Funcionalidade, boolean>>;

export function nomeFuncionalidade(chave: string): string {
  return FUNCIONALIDADES.find((f) => f.chave === chave)?.nome ?? chave;
}

// Ligada? Sem valor gravado (ou valor inválido), responde o padrão do catálogo.
export function ligada(mapa: MapaFuncionalidades | null | undefined, chave: Funcionalidade): boolean {
  const v = mapa?.[chave];
  if (typeof v === "boolean") return v;
  return FUNCIONALIDADES.find((f) => f.chave === chave)?.padrao ?? false;
}

// Aceita o que vier do banco (jsonb) sem confiar no formato: só chaves do
// catálogo, só valores booleanos.
export function lerMapa(bruto: unknown): MapaFuncionalidades {
  const out: MapaFuncionalidades = {};
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return out;
  for (const f of FUNCIONALIDADES) {
    const v = (bruto as Record<string, unknown>)[f.chave];
    if (typeof v === "boolean") out[f.chave] = v;
  }
  return out;
}
