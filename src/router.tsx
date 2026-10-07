import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { routeTree } from "./routeTree.gen";
import { msgErro } from "@/lib/erros";
import { prepararRotaInicialDoApp } from "@/lib/nativo";

export const getRouter = () => {
  // Dentro do APK a abertura fria começa no painel de Pagamentos. Tem que ser
  // ANTES do createRouter: é da URL que o roteador tira a primeira tela.
  prepararRotaInicialDoApp();

  const queryClient = new QueryClient({
    defaultOptions: {
      // App interno: evita refetch a cada foco de janela e reduz retentativas.
      // As invalidações após mutation continuam refazendo o fetch normalmente.
      queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
    },
    // Feedback global: qualquer mutation que falhe mostra um toast de erro —
    // exceto as que tratam o erro inline (meta.silentError). Sucessos são
    // opt-in via meta.successMessage. Guardado p/ não disparar no SSR.
    mutationCache: new MutationCache({
      onError: (err, _vars, _ctx, mutation) => {
        if (typeof window === "undefined") return;
        if (!mutation.meta?.silentError) toast.error(msgErro(err));
      },
      onSuccess: (_data, _vars, _ctx, mutation) => {
        if (typeof window === "undefined") return;
        const msg = mutation.meta?.successMessage;
        if (msg) toast.success(String(msg));
      },
    }),
    // Falhas de leitura silenciosas (ex.: dashboard, que só usa default []) viram toast.
    queryCache: new QueryCache({
      onError: (err) => {
        if (typeof window === "undefined") return;
        toast.error(msgErro(err));
      },
    }),
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
