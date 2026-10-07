import { createFileRoute, Navigate } from "@tanstack/react-router";

// URL antiga, mantida para não quebrar links: movida para Financeiro › Plano de contas.
// Redireciona ao montar (como no Financeiro original), e não com `redirect` no beforeLoad:
// este corre com a hidratação da página pré-renderizada e gera o erro React #418 às vezes.
export const Route = createFileRoute("/plano-de-contas")({
  component: () => <Navigate to="/financeiro/plano-de-contas" replace />,
});
