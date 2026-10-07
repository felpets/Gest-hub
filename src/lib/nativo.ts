// ─── O mesmo app rodando dentro do APK (Capacitor) ──────────────────────────
// O APK Android não é outro programa: é este mesmo site empacotado num WebView
// (ver capacitor.config.ts). Três coisas mudam quando ele roda ali dentro, e
// todas passam por aqui:
//
//   1. a abertura vai direto para Financeiro › Pagamentos › Pix do dia;
//   2. as chamadas /api/* (Usuários, sincronização do Inter) não existem dentro
//      do APK — precisam do endereço do site publicado;
//   3. baixar arquivo não usa <a download> (ver src/lib/salvar-arquivo.ts).
//
// A detecção NÃO importa o @capacitor/core de propósito: o bridge do Capacitor
// injeta o objeto `window.Capacitor` antes de a página carregar, então basta
// olhar o global. Assim este módulo continua seguro no prerender (roda no Node,
// onde não existe `window`) e o site não carrega nada de Capacitor à toa. Os
// plugins entram por import dinâmico, só no ramo nativo.

type BridgeCapacitor = { isNativePlatform?: () => boolean; getPlatform?: () => string };

function bridge(): BridgeCapacitor | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: BridgeCapacitor }).Capacitor;
}

/** true só dentro do APK/IPA. No navegador (inclusive no celular) é false. */
export const NO_APP: boolean = bridge()?.isNativePlatform?.() === true;

// ─── Endereço das funções de servidor ───────────────────────────────────────
// No site, /api/* é a própria origem (funções da Vercel, ver vercel.json). No
// APK a origem é https://localhost — o servidor local do Capacitor, que só tem
// os arquivos do build —, então as chamadas precisam apontar para o site
// publicado. O workflow do APK passa isso em VITE_API_BASE.
const BASE_API = String(import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");

/** Endereço de uma função de servidor: relativo no site, absoluto no APK. */
export function urlApi(caminho: string): string {
  return NO_APP && BASE_API ? BASE_API + caminho : caminho;
}

/** APK gerado sem VITE_API_BASE: as telas que dependem de /api/* vão falhar. */
export const SEM_API_NO_APP: boolean = NO_APP && !BASE_API;

// ─── Tela de abertura ───────────────────────────────────────────────────────
// O APK é o painel de pagamentos: quem abre quer o Pix do dia, não o Dashboard.
// O resto do Hub continua inteiro no app — só o ponto de partida muda.
export const DESTINO_INICIAL_DO_APP = { to: "/financeiro/pagamentos", search: { aba: "pix" } } as const;

/** O mesmo destino como URL, para a troca feita antes de o roteador existir. */
export const ROTA_INICIAL_DO_APP = `${DESTINO_INICIAL_DO_APP.to}?aba=${DESTINO_INICIAL_DO_APP.search.aba}`;

/**
 * Troca a URL da abertura fria pelo painel de Pagamentos, antes de o roteador
 * ser criado (src/router.tsx) — assim o Dashboard nem chega a montar.
 *
 * Só age quando o WebView está na raiz: se o endereço já é outro, é um reload
 * no meio do uso (o html5mode do Capacitor serve o index.html em qualquer
 * rota) e o app tem que voltar para onde a pessoa estava, não para o Pix.
 */
export function prepararRotaInicialDoApp(): void {
  if (!NO_APP || typeof window === "undefined") return;
  const { pathname, search, hash } = window.location;
  const naRaiz = pathname === "/" || pathname === "/index.html";
  if (!naRaiz || search || hash) return;
  window.history.replaceState(null, "", ROTA_INICIAL_DO_APP);
}
