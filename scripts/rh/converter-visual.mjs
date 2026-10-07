// Converte as classes de cor do CRM RH (Tailwind 3, paleta slate/blue fixa) para os
// TOKENS do design system do Zaytan Hub Financeiro (Tailwind 4 + variáveis CSS):
//   slate   → foreground / muted-foreground / secondary / border / input
//   blue    → primary (laranja Zaytan)
//   emerald → success     red/rose → destructive     amber → warning (+ warning-ink)
// As demais famílias (violet, indigo, orange, yellow) ganham variante dark:.
// Também troca utilitários removidos no Tailwind 4 (flex-shrink/flex-grow).
//
// Idempotente: rodar de novo não altera nada (as classes de origem já não existem).
// Uso: node scripts/rh/converter-visual.mjs [arquivo]   (padrão: src/modulos/rh/RHApp.jsx)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const arquivo = process.argv[2] || path.join(aqui, "..", "..", "src", "modulos", "rh", "RHApp.jsx");
let src = fs.readFileSync(arquivo, "utf8");

// [token, alpha 0-100] por utilitário/tonalidade. `hover` permite um alvo diferente
// quando a classe vem com a variante hover: (botões que escurecem no hover).
const NEUTRO = {
  text: { 900: ["foreground", 100], 800: ["foreground", 100], 700: ["foreground", 80], 600: ["foreground", 70], 500: ["muted-foreground", 100], 400: ["muted-foreground", 80], 300: ["muted-foreground", 50], 200: ["muted-foreground", 30], 100: ["muted-foreground", 20], 50: ["background", 100] },
  bg: { 50: ["secondary", 50], 100: ["secondary", 100], 200: ["border", 100], 300: ["muted-foreground", 30], 400: ["muted-foreground", 50], 500: ["muted-foreground", 100], 600: ["muted-foreground", 100], 700: ["foreground", 80], 800: ["foreground", 100], 900: ["foreground", 100] },
  border: { 50: ["border", 40], 100: ["border", 60], 200: ["border", 100], 300: ["input", 100], 400: ["muted-foreground", 40], 500: ["muted-foreground", 60] },
  ring: { 100: ["border", 100], 200: ["border", 100], 300: ["input", 100] },
};
const MARCA = (token, forte = 100) => ({
  text: Object.fromEntries([300, 400, 500, 600, 700, 800, 900].map((n) => [n, [token, 100]])),
  bg: { 50: [token, 8], 100: [token, 15], 200: [token, 25], 300: [token, 40], 400: [token, 80], 500: [token, forte], 600: [token, 100], 700: [token, 100] },
  border: { 50: [token, 15], 100: [token, 20], 200: [token, 30], 300: [token, 40], 400: [token, 70], 500: [token, 100], 600: [token, 100], 700: [token, 100] },
  ring: { 50: [token, 10], 100: [token, 15], 200: [token, 25], 300: [token, 35], 400: [token, 50], 500: [token, 100], 600: [token, 100] },
});
const FAMILIAS = {
  slate: NEUTRO,
  gray: NEUTRO,
  blue: MARCA("primary"),
  emerald: MARCA("success"),
  green: MARCA("success"),
  red: MARCA("destructive"),
  rose: MARCA("destructive"),
  amber: { ...MARCA("warning"), text: { 400: ["warning", 100], 500: ["warning", 100], 600: ["warning-ink", 100], 700: ["warning-ink", 100], 800: ["warning-ink", 100], 900: ["warning-ink", 100] } },
};
// No hover, o tom mais escuro do botão vira a própria cor com 90% (padrão do Financeiro).
const HOVER_ESCURO = { 700: 90, 800: 90, 500: 90 };

const UTIL = { text: "text", bg: "bg", border: "border", divide: "border", ring: "ring", from: "bg", to: "bg", fill: "text", stroke: "text", accent: "text", outline: "border", placeholder: "text", decoration: "text" };

const re = /(?<![\w\-/[])((?:[a-z0-9-]+:)*)(!?)(text|bg|border|divide|ring|from|to|fill|stroke|accent|outline|placeholder|decoration)-(slate|gray|blue|emerald|green|red|rose|amber)-(50|100|200|300|400|500|600|700|800|900)(?:\/(\d{1,3}))?(?![\w\-/])/g;

let trocas = 0;
const naoMapeadas = new Map();
src = src.replace(re, (m, variantes, imp, util, fam, tom, alpha) => {
  const tabela = FAMILIAS[fam][UTIL[util]];
  const alvo = tabela && tabela[tom];
  if (!alvo) {
    naoMapeadas.set(m, (naoMapeadas.get(m) || 0) + 1);
    return m;
  }
  let [token, a] = alvo;
  if (fam !== "slate" && fam !== "gray" && variantes.includes("hover:") && util === "bg" && HOVER_ESCURO[tom]) a = HOVER_ESCURO[tom];
  if (alpha) a = Math.max(5, Math.round((a * Number(alpha)) / 100 / 5) * 5);
  trocas++;
  return `${variantes}${imp}${util}-${token}${a >= 100 ? "" : `/${a}`}`;
});

// Branco "de cartão" vira a superfície do tema (funciona no modo escuro).
src = src.replace(/(?<![\w\-/[])((?:[a-z0-9-]+:)*)bg-white(\/\d{1,3})?(?![\w\-/])/g, (m, v, a) => {
  trocas++;
  return `${v}bg-card${a || ""}`;
});

// Demais famílias: mantém a cor (papel semântico próprio) e acrescenta a versão escura.
const OUTRAS = /(?<![\w\-/[:])(bg|text|border)-(violet|indigo|orange|yellow|sky|teal|purple)-(50|100|200|300|500|600|700|800)(?:\/(\d{1,3}))?(?![\w\-/])(?! dark:)/g;
src = src.replace(OUTRAS, (m, util, fam, tom) => {
  const n = Number(tom);
  let dark = null;
  if (util === "bg" && n <= 100) dark = `dark:bg-${fam}-500/15`;
  else if (util === "text" && n >= 600) dark = `dark:text-${fam}-300`;
  else if (util === "border" && n <= 300) dark = `dark:border-${fam}-500/30`;
  if (!dark) return m;
  trocas++;
  return `${m} ${dark}`;
});

// Utilitários removidos no Tailwind 4.
src = src.replace(/(?<![\w-])flex-shrink-(\d)(?![\w-])/g, (_, d) => { trocas++; return `shrink-${d}`; });
src = src.replace(/(?<![\w-])flex-grow(?![\w-])/g, () => { trocas++; return "grow"; });

// Cores fixas dos gráficos (Recharts não lê variáveis CSS): paleta do Financeiro.
const HEX = { "#2563eb": "#FF4D1C", "#1e293b": "#3F3F46", "#ef4444": "#D63B0F", "#f59e0b": "#E0A800" };
src = src.replace(/(fill|stroke)="(#[0-9a-fA-F]{6})"/g, (m, attr, hex) => {
  const novo = HEX[hex.toLowerCase()];
  if (!novo) return m;
  trocas++;
  return `${attr}="${novo}"`;
});

fs.writeFileSync(arquivo, src, "utf8");
console.log(`${path.basename(arquivo)}: ${trocas} troca(s).`);
if (naoMapeadas.size) {
  console.log("Classes mantidas (sem mapeamento):");
  for (const [k, n] of naoMapeadas) console.log(`  ${k} ×${n}`);
}
