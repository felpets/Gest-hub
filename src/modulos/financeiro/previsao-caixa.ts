import { useMemo } from "react";
import { hojeISO, pad } from "@/lib/datas";
import { useCobrancas, usePrevistos } from "@/lib/queries";
import { buildProjecao, itensDaProjecao, resumoPorMes } from "@/lib/projecao";

// A conta da previsão de caixa, num lugar só: o Caixa › Projeção e o Dashboard
// da Gestão chamam este hook, então "vai entrar", "vai sair" e "termino com"
// são os mesmos números nas duas telas.

// `frase` completa "O dinheiro dá para tudo …" no veredito da tela.
export const HORIZONTES = [
  { id: "mesAtual", titulo: "Este mês", dias: 0, frase: "até o fim deste mês" },
  { id: "30d", titulo: "30 dias", dias: 30, frase: "nos próximos 30 dias" },
  { id: "60d", titulo: "60 dias", dias: 60, frase: "nos próximos 60 dias" },
  { id: "90d", titulo: "90 dias", dias: 90, frase: "nos próximos 90 dias" },
  { id: "mesSeg", titulo: "Até o fim do mês que vem", dias: 0, frase: "até o fim do mês que vem" },
] as const;
export type HorizonteId = (typeof HORIZONTES)[number]["id"];
// O mês corrente é o que a empresa olha todo dia: é ele que abre a tela.
export const HORIZONTE_PADRAO: HorizonteId = "mesAtual";

const isoLocal = (dt: Date) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
export function fimHorizonte(hoje: string, id: HorizonteId): string {
  const [y, m, d] = hoje.split("-").map(Number);
  if (id === "mesAtual") return isoLocal(new Date(y, m, 0));   // último dia deste mês
  if (id === "mesSeg") return isoLocal(new Date(y, m + 1, 0)); // último dia do mês seguinte
  const dias = HORIZONTES.find((h) => h.id === id)!.dias;
  return isoLocal(new Date(y, m - 1, d + dias));
}

// De hoje até `fim` (YYYY-MM-DD). O Caixa passa o fim do horizonte escolhido
// (30/60/90 dias…); o Dashboard passa o último dia do período do filtro.
export function useProjecaoCaixa(saldoAtual: number, fim: string) {
  const { data: previstos = [] } = usePrevistos();
  const { data: cobrancas = [] } = useCobrancas();
  const hoje = hojeISO();

  return useMemo(() => {
    const itens = itensDaProjecao(previstos, cobrancas, hoje, fim)
      .sort((a, b) => (a.dataISO < b.dataISO ? -1 : a.dataISO > b.dataISO ? 1 : a.tipo === "in" ? -1 : 1));
    const projecao = buildProjecao(saldoAtual, hoje, itens, fim);
    const entra = itens.filter((i) => i.tipo === "in").reduce((s, i) => s + i.valor, 0);
    const sai = itens.filter((i) => i.tipo === "out").reduce((s, i) => s + i.valor, 0);
    // Saldo depois de cada item: é o que mostra QUAL conta leva o caixa ao vermelho.
    let corrente = saldoAtual;
    const linhas = itens.map((i) => {
      corrente += i.tipo === "in" ? i.valor : -i.valor;
      return { ...i, saldoDepois: Math.round(corrente * 100) / 100 };
    });
    return {
      hoje, fim, itens: linhas, projecao, entra, sai,
      qtdEntra: itens.filter((i) => i.tipo === "in").length,
      qtdSai: itens.filter((i) => i.tipo === "out").length,
      meses: resumoPorMes(saldoAtual, itens),
    };
  }, [previstos, cobrancas, saldoAtual, hoje, fim]);
}

export type PrevisaoCaixa = ReturnType<typeof useProjecaoCaixa>;
