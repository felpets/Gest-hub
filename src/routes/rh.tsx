import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { AbasPagina } from "@/components/AbasPagina";
import { SECOES_RH, podeVerModuloRH } from "@/lib/navegacao";
import { lerAba } from "@/lib/use-abas";
import { useAcessoRH } from "@/modulos/rh/acesso";
import { ModuloRH } from "@/modulos/rh/ModuloRH";

// Pilar RH. Layout único para todas as seções (/rh, /rh/funcionarios, …): o
// módulo RH fica montado enquanto a pessoa navega entre as seções, então os
// dados não são recarregados a cada clique (como no CRM RH original).
export const Route = createFileRoute("/rh")({
  validateSearch: (s: Record<string, unknown>): { aba?: string } => ({ aba: lerAba(s) }),
  head: () => ({
    meta: [
      { title: "RH · Finance HUB" },
      { name: "description", content: "Gestão de pessoas: funcionários, treinamento, recrutamento, ausências e folha." },
    ],
  }),
  component: LayoutRH,
});

function LayoutRH() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const { aba } = Route.useSearch();
  const navigate = useNavigate();
  const { perfil } = useAcessoRH();

  const secao = path.replace(/^\/rh\/?/, "").split("/")[0] ?? "";
  const def = SECOES_RH[secao] ?? SECOES_RH[""];
  const abas = def.abas.filter((a) => podeVerModuloRH(perfil, a.modulo));
  const ativa = abas.find((a) => a.id === aba) ?? abas[0];

  return (
    <AppShell
      title={def.titulo}
      subtitle={def.subtitulo}
      tabs={<AbasPagina abas={abas} ativa={ativa?.id ?? ""} onTrocar={(id) => navigate({ to: path, search: { aba: id } })} />}
    >
      {/* Sem aba permitida (perfil do RH não inclui a seção): o RH mostra o painel. */}
      <ModuloRH modulo={ativa?.modulo ?? "dashboard"} sub={ativa?.sub ?? ""} />
      <Outlet />
    </AppShell>
  );
}
