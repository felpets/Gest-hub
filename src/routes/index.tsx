import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { AppShell, TelaEmbutida } from "@/components/AppShell";
import { AbasPagina } from "@/components/AbasPagina";
import { ABAS, PESSOAS_VISOES, podeVerModuloRH } from "@/lib/navegacao";
import { abaAtiva, lerAba, useAbasPermitidas } from "@/lib/use-abas";
import { useEmpresa } from "@/lib/empresa";
import { useAcessoRH } from "@/modulos/rh/acesso";
import { ModuloRH } from "@/modulos/rh/ModuloRH";
import { Dashboard as PainelFinanceiro } from "@/modulos/gestao/telas/painel-financeiro";
import { FluxoCaixa } from "@/modulos/financeiro/telas/fluxo-caixa";
import { ResumoPessoas } from "@/modulos/gestao/ResumoPessoas";
import { HistoricoCelular, ProjecaoCelular, PessoasCelular } from "@/modulos/gestao/telas/inicio-celular";
import { useEhCelular } from "@/lib/tela";
import { cn } from "@/lib/utils";

// Gestão › Dashboard — o que já aconteceu (Histórico, pelo extrato), o que vem
// pela frente (Projeção de caixa) e os indicadores de pessoas. As Análises
// financeiras moram no Caixa; o endereço antigo daqui leva para lá.
export const Route = createFileRoute("/")({
  validateSearch: (s: Record<string, unknown>): { aba?: string; visao?: string } => ({
    aba: lerAba(s),
    visao: typeof s.visao === "string" && s.visao ? s.visao : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Dashboard · Finance HUB" },
      { name: "description", content: "Histórico do extrato, projeção de caixa e indicadores de pessoas." },
    ],
  }),
  component: DashboardGestao,
});

function DashboardGestao() {
  const { aba, visao } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { caps } = useEmpresa();
  // As três abas têm duas telas: a de computador e a de app (cartões, um bloco
  // de resumo, barra de baixo). A conta é a mesma nas duas — ver inicio-celular.tsx.
  const celular = useEhCelular();
  const { perfil } = useAcessoRH({ seguirFinanceiro: true });
  // O perfil "recrutamento" do RH não enxerga indicadores/relatórios de RH.
  const abas = useAbasPermitidas(ABAS.dashboard, (a) => a.id !== "pessoas" || podeVerModuloRH(perfil, "indicadores"));
  const ativa = abaAtiva(abas, aba);
  const visaoPessoas = PESSOAS_VISOES.find((v) => v.id === visao) ?? PESSOAS_VISOES[0];

  // As Análises financeiras mudaram para o Caixa: o link antigo continua abrindo.
  if (aba === "analises") return <Navigate to="/financeiro/caixa" search={{ aba: "analises" }} replace />;

  return (
    <AppShell
      title={celular ? "Início" : "Dashboard"}
      subtitle={celular ? undefined : "O que já passou pelo extrato, o que vem pela frente e os indicadores de pessoas"}
      tabs={<AbasPagina abas={abas} ativa={ativa?.id ?? ""} onTrocar={(id) => navigate({ search: { aba: id } })} />}
    >
      {!ativa && (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Nenhuma visão do Dashboard está liberada para o seu cargo. Use o menu ao lado para abrir as áreas do seu dia a dia.
        </p>
      )}
      {ativa?.id === "visao" && (
        <TelaEmbutida caps={ativa.caps}>
          {celular ? (
            <HistoricoCelular />
          ) : (
            <>
              {/* O fluxo financeiro vem primeiro: é a leitura que o gestor abre para
                  fazer. Os indicadores de pessoas ficam depois dele. */}
              <PainelFinanceiro />
              {caps.has("rh_acessar") && podeVerModuloRH(perfil, "dashboard") && perfil !== "recrutamento" && (
                <div className="mt-8 border-t border-border/60 pt-8">
                  <ResumoPessoas />
                </div>
              )}
            </>
          )}
        </TelaEmbutida>
      )}
      {ativa?.id === "projecao" && (
        <TelaEmbutida caps={ativa.caps}>
          {celular ? <ProjecaoCelular /> : <FluxoCaixa visao="projecao" />}
        </TelaEmbutida>
      )}
      {/* No celular a aba abre nos indicadores em cartões; "Indicadores" e
          "Relatórios" levam ao módulo do RH, que é onde eles moram. */}
      {ativa?.id === "pessoas" && celular && !visao && (
        <TelaEmbutida caps={ativa.caps}>
          <PessoasCelular onAbrir={(v) => navigate({ search: { aba: "pessoas", visao: v } })} />
        </TelaEmbutida>
      )}
      {ativa?.id === "pessoas" && !(celular && !visao) && (
        <ModuloRH
          seguirFinanceiro
          modulo={visaoPessoas.modulo}
          sub=""
          abasSlot={
            <div className="inline-flex rounded-lg bg-secondary/70 p-1">
              {PESSOAS_VISOES.map((v) => (
                <button
                  key={v.id}
                  onClick={() => navigate({ search: { aba: "pessoas", visao: v.id } })}
                  className={cn(
                    "cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    v.id === visaoPessoas.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v.titulo}
                </button>
              ))}
            </div>
          }
        />
      )}
    </AppShell>
  );
}
