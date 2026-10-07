import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell, TelaEmbutida } from "@/components/AppShell";
import { AbasPagina } from "@/components/AbasPagina";
import { ABAS } from "@/lib/navegacao";
import { abaAtiva, lerAba, useAbasPermitidas } from "@/lib/use-abas";
import { Clientes } from "@/modulos/financeiro/telas/clientes";
import { Cobrancas } from "@/modulos/financeiro/telas/cobrancas";
import { Vendas } from "@/modulos/financeiro/telas/vendas";
import { ClientesCelular, CobrancasCelular, VendasCelular } from "@/modulos/financeiro/telas/receitas-celular";
import { useEhCelular } from "@/lib/tela";

// Financeiro › Receitas e vendas — mensalidades de clientes (com conciliação
// pelo extrato) e o controle de vendas. Vendas NÃO entram no saldo realizado.
export const Route = createFileRoute("/financeiro/receitas")({
  validateSearch: (s: Record<string, unknown>): { aba?: string } => ({ aba: lerAba(s) }),
  head: () => ({
    meta: [
      { title: "Receitas e vendas · Finance HUB" },
      { name: "description", content: "Clientes, cobranças conciliadas com o extrato e controle de vendas." },
    ],
  }),
  component: Receitas,
});

function Receitas() {
  const { aba } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  // As três abas têm desenho de app: a tabela vira lista de cartões, e o
  // resumo de três cartões grandes vira uma faixa (ver receitas-celular.tsx).
  const celular = useEhCelular();
  const abas = useAbasPermitidas(ABAS.receitas);
  const ativa = abaAtiva(abas, aba);

  return (
    <AppShell
      title="Receitas e vendas"
      subtitle={celular ? undefined : "Clientes, contas a receber e vendas — a mesma informação, do cadastro ao caixa"}
      tabs={<AbasPagina abas={abas} ativa={ativa?.id ?? ""} onTrocar={(id) => navigate({ search: { aba: id } })} />}
    >
      {ativa && (
        <TelaEmbutida caps={ativa.caps}>
          {ativa.id === "clientes" && (celular ? <ClientesCelular /> : <Clientes />)}
          {ativa.id === "cobrancas" && (celular ? <CobrancasCelular /> : <Cobrancas />)}
          {ativa.id === "vendas" && (celular ? <VendasCelular /> : <Vendas />)}
        </TelaEmbutida>
      )}
    </AppShell>
  );
}
