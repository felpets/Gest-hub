import { createFileRoute, Navigate } from "@tanstack/react-router";

// Endereço antigo: Usuários agora é uma seção das Configurações.
export const Route = createFileRoute("/gestao/usuarios")({
  component: () => <Navigate to="/configuracoes" search={{ secao: "usuarios" }} replace />,
});
