import { createFileRoute, Navigate } from "@tanstack/react-router";

// URL antiga, mantida para não quebrar links: Relatórios virou o Dashboard da Gestão (aba Análises financeiras).
// Redireciona ao montar (como no Financeiro original), e não com `redirect` no beforeLoad:
// este corre com a hidratação da página pré-renderizada e gera o erro React #418 às vezes.
export const Route = createFileRoute("/relatorios")({
  component: () => <Navigate to="/" search={{ aba: "analises" }} replace />,
});
