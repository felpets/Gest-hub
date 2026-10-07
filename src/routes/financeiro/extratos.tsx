import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell, TelaEmbutida } from "@/components/AppShell";
import { AbasPagina } from "@/components/AbasPagina";
import { ABAS } from "@/lib/navegacao";
import { abaAtiva, lerAba, useAbasPermitidas } from "@/lib/use-abas";
import { usePendentesCount } from "@/lib/queries";
import { Importar } from "@/modulos/financeiro/telas/importar";
import { Revisao } from "@/modulos/financeiro/telas/revisao";
import { ConferirExtrato } from "@/modulos/financeiro/telas/conferir-extrato";
import { RevisaoCelular, ConferirCelular } from "@/modulos/financeiro/telas/extratos-celular";
import { useEhCelular } from "@/lib/tela";

// Financeiro › Extratos — um fluxo só em três passos: importar o arquivo,
// revisar/classificar (categorização assistida) e conferir com o banco.
export const Route = createFileRoute("/financeiro/extratos")({
  validateSearch: (s: Record<string, unknown>): { aba?: string; lote?: string } => ({
    aba: lerAba(s),
    lote: typeof s.lote === "string" && s.lote ? s.lote : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Extratos · Finance HUB" },
      { name: "description", content: "Importação de extratos, revisão e classificação, conferência com o banco." },
    ],
  }),
  component: Extratos,
});

function Extratos() {
  const { aba, lote } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: pendentes = 0 } = usePendentesCount();
  // Revisar e conferir têm tela de app; importar usa a mesma dos dois tamanhos
  // (ela já cabe em 390px — ver extratos-celular.tsx).
  const celular = useEhCelular();
  const abas = useAbasPermitidas(ABAS.extratos);
  const ativa = abaAtiva(abas, aba);

  return (
    <AppShell
      title="Extratos"
      subtitle={celular ? undefined : "Importar → revisar e classificar → conferir com o banco"}
      tabs={
        <AbasPagina
          abas={abas.map((a) => (a.id === "revisar" ? { ...a, badge: pendentes } : a))}
          ativa={ativa?.id ?? ""}
          onTrocar={(id) => navigate({ search: { aba: id } })}
        />
      }
    >
      {ativa && (
        <TelaEmbutida caps={ativa.caps}>
          {ativa.id === "importar" && <Importar />}
          {ativa.id === "revisar" && (celular ? <RevisaoCelular lote={lote} /> : <Revisao lote={lote} />)}
          {ativa.id === "conferir" && (celular ? <ConferirCelular /> : <ConferirExtrato />)}
        </TelaEmbutida>
      )}
    </AppShell>
  );
}
