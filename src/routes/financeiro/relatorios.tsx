import { createFileRoute } from "@tanstack/react-router";
import { Relatorios } from "@/modulos/gestao/telas/relatorios";

// Financeiro › Análise financeira — os mesmos relatórios do Dashboard da
// Gestão, agora com porta própria no Financeiro (quem trabalha no caixa chega
// neles sem passar pela Gestão). É o MESMO componente: nada foi duplicado.
export const Route = createFileRoute("/financeiro/relatorios")({
  head: () => ({
    meta: [
      { title: "Análise financeira · Finance HUB" },
      { name: "description", content: "Relatórios e análises: mensal, evolução, categorias, fluxo, receitas e despesas." },
    ],
  }),
  component: Relatorios,
});
