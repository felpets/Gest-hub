import { createFileRoute, Navigate } from "@tanstack/react-router";

// Endereço antigo: as Configurações do RH agora são uma seção das Configurações.
export const Route = createFileRoute("/rh/configuracoes")({
  component: () => <Navigate to="/configuracoes" search={{ secao: "rh" }} replace />,
});
