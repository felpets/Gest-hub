import { createFileRoute, Navigate } from "@tanstack/react-router";

// Endereço antigo: os Ajustes agora são uma seção da área única de Configurações.
export const Route = createFileRoute("/financeiro/ajustes")({
  component: () => <Navigate to="/configuracoes" search={{ secao: "financeiro" }} replace />,
});
