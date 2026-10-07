import { createFileRoute, Navigate } from "@tanstack/react-router";

// Endereço antigo: o Plano de Contas agora é uma seção das Configurações.
export const Route = createFileRoute("/financeiro/plano-de-contas")({
  component: () => <Navigate to="/configuracoes" search={{ secao: "plano" }} replace />,
});
