// ─── Largura da tela ────────────────────────────────────────────────────────
// O Hub passa a ter dois desenhos: o de computador (menu lateral, tabelas) e o
// de celular (cartões, barra inferior), que nasceu junto com o APK Android.
//
// Quem decide é a LARGURA DA JANELA, não o aparelho: assim o site aberto num
// celular mostra a mesma tela do app — foi o que se combinou —, e uma janela
// estreita no computador também. É por isso que a conferência de 390 px
// (`npm run test:e2e:celular`) passa a cobrir o desenho novo sem emular nada.
//
// 768px é o `md` do Tailwind, o mesmo ponto de corte já usado nas classes das
// telas; usar outro faria a casca trocar num lugar e o conteúdo noutro.
import { useSyncExternalStore } from "react";
import { NO_APP } from "@/lib/nativo";

const CONSULTA = "(max-width: 767.98px)";

const temMatchMedia = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function";

function assinar(avisar: () => void): () => void {
  if (!temMatchMedia()) return () => {};
  const mq = window.matchMedia(CONSULTA);
  mq.addEventListener("change", avisar);
  return () => mq.removeEventListener("change", avisar);
}

const noCliente = () => (temMatchMedia() ? window.matchMedia(CONSULTA).matches : false);

// No prerender não existe janela. `false` (computador) é o palpite seguro: o
// prerender só monta a casca do SPA, sem conteúdo de página, e o cliente
// corrige no primeiro render.
const noServidor = () => false;

/** true quando vale o desenho de app: dentro do APK sempre, e no site quando a
 *  janela é estreita. */
export function useEhCelular(): boolean {
  const estreita = useSyncExternalStore(assinar, noCliente, noServidor);

  // Dentro do APK o desenho de app vale SEMPRE, sem depender de medir largura.
  // Dois motivos: num tablet a tela é larga e mesmo assim é o app; e o WebView do
  // Android, quando algo atrapalha a meta viewport, monta a página como se a tela
  // tivesse 980px — e aí a conta de largura daria "computador" dentro do celular.
  return NO_APP || estreita;
}
