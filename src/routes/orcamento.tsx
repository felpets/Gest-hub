import { createFileRoute, Navigate } from "@tanstack/react-router";

// URL antiga, mantida para não quebrar links: a tela de Orçamento saiu da navegação (ver docs/CONSOLIDACAO.md); os dados continuam no banco.
// Redireciona ao montar (como no Financeiro original), e não com `redirect` no beforeLoad:
// este corre com a hidratação da página pré-renderizada e gera o erro React #418 às vezes.
export const Route = createFileRoute("/orcamento")({
  component: () => <Navigate to="/" replace />,
});
