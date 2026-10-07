import { createFileRoute, Navigate } from "@tanstack/react-router";

// Endereço antigo: ausências agora são uma aba de Funcionários (é informação
// da pessoa, e era a única seção do RH com uma tela só).
export const Route = createFileRoute("/rh/atestados")({
  component: () => <Navigate to="/rh/funcionarios" search={{ aba: "atestados" }} replace />,
});
