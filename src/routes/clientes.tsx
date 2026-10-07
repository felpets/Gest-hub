import { createFileRoute, Navigate } from "@tanstack/react-router";

// URL antiga, mantida para não quebrar links: consolidada em Financeiro › Receitas e vendas.
// Redireciona ao montar (como no Financeiro original), e não com `redirect` no beforeLoad:
// este corre com a hidratação da página pré-renderizada e gera o erro React #418 às vezes.
export const Route = createFileRoute("/clientes")({
  component: () => <Navigate to="/financeiro/receitas" search={{ aba: "clientes" }} replace />,
});
