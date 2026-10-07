import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { AppShell, TelaEmbutida } from "@/components/AppShell";
import { AbasPagina } from "@/components/AbasPagina";
import { ABAS, abaRenomeada } from "@/lib/navegacao";
import { abaAtiva, lerAba, useAbasPermitidas } from "@/lib/use-abas";
import { ligada } from "@/lib/funcionalidades";
import { useFuncionalidades } from "@/lib/queries";
import { PagamentosDiarios } from "@/modulos/financeiro/telas/pagamentos-diarios";
import { PixCelular } from "@/modulos/financeiro/telas/pix-celular";
import { useEhCelular } from "@/lib/tela";
import { ContasAPagar } from "@/modulos/financeiro/telas/contas-a-pagar";
import { Processos } from "@/modulos/financeiro/telas/processos";
import { ContasCelular, DividasCelular } from "@/modulos/financeiro/telas/contas-celular";

// Financeiro › Pagamentos, na ordem do dia a dia:
//   Pix do dia       tarefa diária (é a primeira tela da área)
//   Contas do mês    obrigações do período + as regras que se repetem
//   Dívidas/acordos  opcional (Configurações › Funcionalidades)
// Cartões mudou para Caixa › Cartões: o endereço antigo leva para lá.
// A antiga "Visão geral" saiu: ela repetia Contas do mês, e a agenda completa
// (com Pix, RH e acordos juntos) é o Detalhamento de saídas do Dashboard.
export const Route = createFileRoute("/financeiro/pagamentos")({
  validateSearch: (s: Record<string, unknown>): { aba?: string; pix?: string; form?: string; filtros?: string } => ({
    aba: lerAba(s),
    // Detalhe de um Pix no celular. Fica no endereço de propósito: assim o
    // botão "voltar" do aparelho fecha o detalhe em vez de sair da tela, e um
    // link leva direto ao pagamento. Ver pix-celular-detalhe.tsx.
    pix: typeof s.pix === "string" && s.pix ? s.pix : undefined,
    // Formulário de Pix no celular: "novo", ou o id de quem está sendo editado.
    form: typeof s.form === "string" && s.form ? s.form : undefined,
    // Tela de filtros do celular. Também no endereço, pelo mesmo motivo: o
    // "voltar" do aparelho fecha a tela em vez de sair de Pagamentos.
    filtros: s.filtros ? "1" : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Pagamentos · Finance HUB" },
      { name: "description", content: "Pix do dia, contas do mês com as recorrências, dívidas e acordos." },
    ],
  }),
  component: Pagamentos,
});

function Pagamentos() {
  const { aba, pix, form, filtros } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  // O Pix do dia tem duas telas: a de computador (tabela) e a de celular
  // (cartões, um dia por vez). A lógica é a mesma nas duas — ver pix-celular.tsx.
  const celular = useEhCelular();
  const { data: funcs } = useFuncionalidades();
  const abas = useAbasPermitidas(ABAS.pagamentos, (a) => !a.funcionalidade || ligada(funcs, a.funcionalidade));
  const ativa = abaAtiva(abas, abaRenomeada("pagamentos", aba));

  if (aba === "cartoes") return <Navigate to="/financeiro/caixa" search={{ aba: "cartoes" }} replace />;

  return (
    <AppShell
      title="Pagamentos"
      subtitle={celular ? undefined : "Pix do dia, contas e recorrências do mês, dívidas e acordos"}
      tabs={<AbasPagina abas={abas} ativa={ativa?.id ?? ""} onTrocar={(id) => navigate({ search: { aba: id } })} />}
    >
      {ativa && (
        <TelaEmbutida caps={ativa.caps}>
          {ativa.id === "pix" &&
            (celular ? (
              <PixCelular
                pixAberto={pix ?? null}
                formAberto={form ?? null}
                filtrosAbertos={filtros === "1"}
                onAbrirPix={(id) => navigate({ search: { aba: "pix", pix: id ?? undefined } })}
                onAbrirForm={(id) => navigate({ search: { aba: "pix", form: id ?? undefined } })}
                onAbrirFiltros={(v) => navigate({ search: { aba: "pix", filtros: v ? "1" : undefined } })}
              />
            ) : (
              <PagamentosDiarios />
            ))}
          {ativa.id === "contas" && (celular ? <ContasCelular /> : <ContasAPagar />)}
          {ativa.id === "dividas" && (celular ? <DividasCelular /> : <Processos />)}
        </TelaEmbutida>
      )}
    </AppShell>
  );
}
