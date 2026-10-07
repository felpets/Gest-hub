import { createFileRoute } from "@tanstack/react-router";

// Painel do RH: a tela é desenhada pelo layout /rh (src/routes/rh.tsx).
export const Route = createFileRoute("/rh/")({
  component: () => null,
});
