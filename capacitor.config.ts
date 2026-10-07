import type { CapacitorConfig } from "@capacitor/cli";

// ─── APK Android do Zaytan Hub (Capacitor) ──────────────────────────────────
// O app é o MESMO site: o Capacitor empacota o `dist/client` (build do Vite em
// modo SPA) dentro do APK e o roda num WebView. Não há segundo código a manter.
//
// O que o app faz de diferente do site:
//   • abre direto em Financeiro › Pagamentos › Pix do dia (ver src/lib/nativo.ts);
//   • baixar PDF/Excel grava o arquivo e abre o compartilhar do Android
//     (`<a download>` não funciona em WebView — ver src/lib/salvar-arquivo.ts);
//   • as funções /api/* não existem dentro do APK, então as chamadas vão para
//     o site publicado na Vercel (VITE_API_BASE, ver src/lib/nativo.ts).
//
// O APK é gerado pelo workflow .github/workflows/apk.yml — esta máquina não
// precisa de Android Studio. Passo a passo em docs/apk-android.md.
const config: CapacitorConfig = {
  appId: "com.zaytan.laportec.pagamentos",
  appName: "Laportec Pagamentos",
  // Saída do `npm run build` (vite.config.ts → spa.enabled + vercel.json).
  webDir: "dist/client",
  server: {
    // Origem dos assets dentro do app: https://localhost. É uma origem estável
    // e segura, então o localStorage sobrevive entre aberturas — é lá que o
    // supabase-js guarda a sessão (persistSession) e o app guarda o tema e a
    // empresa ativa. Trocar isso desloga todo mundo na atualização seguinte.
    androidScheme: "https",
    // Rotas fundas (/financeiro/pagamentos) recarregam servindo o index.html:
    // é o html5mode do servidor local, ligado por padrão. Anotado porque o app
    // depende disso — sem ele, um reload na tela de Pagamentos daria tela branca.
  },
  android: {
    // Sem http às claras: tudo que o app fala (Supabase, Vercel) é https.
    allowMixedContent: false,
  },
};

export default config;
