import { createFileRoute, Navigate } from "@tanstack/react-router";

// URL antiga, mantida para não quebrar links: o saldo diário vive no Dashboard (visão geral).
// Redireciona ao montar (como no Financeiro original), e não com `redirect` no beforeLoad:
// este corre com a hidratação da página pré-renderizada e gera o erro React #418 às vezes.
export const Route = createFileRoute("/saldo-diario")({
  component: () => <Navigate to="/" search={{ aba: "visao" }} replace />,
});
