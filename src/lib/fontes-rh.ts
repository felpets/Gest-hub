// ─── Recorrência com o valor vindo do RH (migração 49) ─────────────────────
// As recorrências de Folha do Financeiro (Salários, Adiantamento, VT, VR) eram
// lembretes de vencimento com valor simbólico, porque o valor de verdade mora
// no cadastro do RH. Ligando a recorrência a uma destas fontes, o valor de cada
// mês passa a vir de lá — e muda sozinho quando o RH muda.

export type FonteRH = "salarios" | "folha_liquida" | "adiantamento" | "vt" | "vr";

// Totais de uma competência, como a função fn_rh_totais_mensais devolve.
export type TotaisRH = {
  competencia: string;    // YYYY-MM
  salarios: number;       // soma dos salários cadastrados (bruto)
  adiantamento: number;   // soma dos adiantamentos do mês
  vt: number;             // vale-transporte, custo cheio da empresa
  vr: number;             // vale-refeição do mês
  pessoas: number;
  // Salário de cada pessoa menos o adiantamento que ela RECEBEU na competência
  // (migração 59). null = banco ainda sem a 59: cai na conta antiga, que tira
  // o adiantamento previsto de todos.
  folhaLiquida: number | null;
  vrAproximado: boolean;  // o RH pede rateio por admissão, que não é feito aqui
};

export const FONTES_RH: { chave: FonteRH; nome: string; desc: string }[] = [
  {
    chave: "folha_liquida",
    nome: "Folha — líquido a pagar",
    desc: "Salários cadastrados menos o adiantamento que cada pessoa já recebeu no mês. Quem não recebeu adiantamento entra com o salário cheio.",
  },
  {
    chave: "salarios",
    nome: "Salários — bruto cadastrado",
    desc: "Soma dos salários dos funcionários ativos, sem descontar o adiantamento.",
  },
  {
    chave: "adiantamento",
    nome: "Adiantamento quinzenal",
    desc: "Soma dos adiantamentos: percentual da empresa, percentual próprio ou valor fixo de cada um.",
  },
  {
    chave: "vt",
    nome: "Vale-transporte",
    desc: "Valor do dia de cada pessoa × dias úteis da configuração do RH, pelo custo cheio da empresa.",
  },
  {
    chave: "vr",
    nome: "Vale-refeição",
    desc: "Valor do dia × dias do mês, na base escolhida na configuração do RH.",
  },
];

export function nomeFonteRH(chave: string | null | undefined): string {
  return FONTES_RH.find((f) => f.chave === chave)?.nome ?? "";
}

export function ehFonteRH(valor: unknown): valor is FonteRH {
  return typeof valor === "string" && FONTES_RH.some((f) => f.chave === valor);
}

// Quanto essa fonte vale na competência. Sem totais (RH indisponível, migração
// não rodada, mês fora do intervalo), devolve null — quem chama mantém o valor
// que já estava, em vez de zerar a conta.
export function valorDaFonte(totais: TotaisRH | undefined | null, fonte: FonteRH): number | null {
  if (!totais) return null;
  switch (fonte) {
    case "salarios": return totais.salarios;
    case "folha_liquida":
      return totais.folhaLiquida ?? Math.max(0, Math.round((totais.salarios - totais.adiantamento) * 100) / 100);
    case "adiantamento": return totais.adiantamento;
    case "vt": return totais.vt;
    case "vr": return totais.vr;
  }
}

// Indexa os totais por competência para consulta rápida na reconciliação.
export function porCompetencia(lista: TotaisRH[]): Map<string, TotaisRH> {
  return new Map(lista.map((t) => [t.competencia, t]));
}

// Uma recorrência ligada ao RH cobre a rubrica correspondente: o Dashboard
// deixa de listar as linhas por pessoa daquela rubrica, senão o mesmo dinheiro
// apareceria duas vezes (uma na conta do mês, outra na folha do RH).
export function origemRHCoberta(fonte: FonteRH): "rh_salario" | "rh_adiantamento" | null {
  if (fonte === "salarios" || fonte === "folha_liquida") return "rh_salario";
  if (fonte === "adiantamento") return "rh_adiantamento";
  return null; // VT e VR não têm linha por pessoa no Dashboard
}
