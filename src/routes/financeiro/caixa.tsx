import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { AppShell, TelaEmbutida } from "@/components/AppShell";
import { AbasPagina } from "@/components/AbasPagina";
import { ABAS } from "@/lib/navegacao";
import { abaAtiva, lerAba, useAbasPermitidas } from "@/lib/use-abas";
import { Movimentacoes } from "@/modulos/financeiro/telas/movimentacoes";
import { FluxoCaixa } from "@/modulos/financeiro/telas/fluxo-caixa";
import { Cartoes } from "@/modulos/financeiro/telas/cartoes";
import { Relatorios } from "@/modulos/gestao/telas/relatorios";
import { MovimentacoesCelular } from "@/modulos/financeiro/telas/movimentacoes-celular";
import { FluxoCelular, AnalisesCelular, CartoesCelular } from "@/modulos/financeiro/telas/caixa-celular";
import { useEhCelular } from "@/lib/tela";

// Financeiro › Caixa — lançamentos do extrato, saldo realizado, análises
// financeiras (vieram da Gestão: quem trabalha no caixa chega nelas sem
// desviar) e o demonstrativo dos cartões. A projeção mudou para a Gestão, ao
// lado do Histórico; o endereço antigo continua abrindo.
export const Route = createFileRoute("/financeiro/caixa")({
  validateSearch: (s: Record<string, unknown>): { aba?: string } => ({ aba: lerAba(s) }),
  head: () => ({
    meta: [
      { title: "Caixa · Finance HUB" },
      { name: "description", content: "Lançamentos, fluxo de caixa realizado, análises financeiras e gastos dos cartões." },
    ],
  }),
  component: Caixa,
});

function Caixa() {
  const { aba } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  // As quatro abas têm duas telas: a de computador (tabelas e gráficos largos)
  // e a de app (cartões, folhas que sobem, gráficos de 170px). Os números vêm
  // dos mesmos ganchos — ver movimentacoes-celular.tsx e caixa-celular.tsx.
  const celular = useEhCelular();
  const abas = useAbasPermitidas(ABAS.caixa);
  const ativa = abaAtiva(abas, aba);

  if (aba === "projecao") return <Navigate to="/" search={{ aba: "projecao" }} replace />;

  return (
    <AppShell
      title={celular ? "Movimentações" : "Caixa"}
      subtitle={celular ? undefined : "Lançamentos do extrato, saldo realizado, análises financeiras e gastos dos cartões"}
      tabs={<AbasPagina abas={abas} ativa={ativa?.id ?? ""} onTrocar={(id) => navigate({ search: { aba: id } })} />}
    >
      {ativa && (
        <TelaEmbutida caps={ativa.caps}>
          {ativa.id === "movimentacoes" && (celular ? <MovimentacoesCelular /> : <Movimentacoes />)}
          {ativa.id === "fluxo" && (celular ? <FluxoCelular /> : <FluxoCaixa visao="realizado" />)}
          {ativa.id === "analises" && (celular ? <AnalisesCelular /> : <Relatorios />)}
          {ativa.id === "cartoes" && (celular ? <CartoesCelular /> : <Cartoes />)}
        </TelaEmbutida>
      )}
    </AppShell>
  );
}
