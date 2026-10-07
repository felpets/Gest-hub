import { createFileRoute, Navigate } from "@tanstack/react-router";

// URL antiga, mantida para não quebrar links (inclusive ?lote=): consolidada em
// Financeiro › Extratos (aba Revisar e classificar).
// Redireciona ao montar (como no Financeiro original), e não com `redirect` no beforeLoad:
// este corre com a hidratação da página pré-renderizada e gera o erro React #418 às vezes.
export const Route = createFileRoute("/revisao")({
  validateSearch: (s: Record<string, unknown>): { lote?: string } => ({
    lote: typeof s.lote === "string" && s.lote ? s.lote : undefined,
  }),
  component: RevisaoAntiga,
});

function RevisaoAntiga() {
  const { lote } = Route.useSearch();
  return <Navigate to="/financeiro/extratos" search={{ aba: "revisar", lote }} replace />;
}
