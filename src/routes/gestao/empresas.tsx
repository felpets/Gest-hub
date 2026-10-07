import { createFileRoute, Navigate } from "@tanstack/react-router";

// Endereço antigo: Empresas e cargos agora é uma seção das Configurações.
export const Route = createFileRoute("/gestao/empresas")({
  component: () => <Navigate to="/configuracoes" search={{ secao: "empresas" }} replace />,
});
