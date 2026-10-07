// Teste de fumaça do protótipo Zaytan Hub (dados fictícios): entra com cada
// perfil, abre todas as telas/abas (e as URLs antigas), confere entrada por
// cargo, bloqueios e erros de console, e salva capturas em e2e-capturas/.
//
// Uso (com o app rodando):  npm run test:e2e -- [base] [perfil...]
//   base padrão: http://127.0.0.1:8080 · Chrome: CHROME_PATH (padrão: Windows)
//   Para o build de produção: npm run build && node scripts/e2e/servir-dist.mjs dist/client 4173
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:8080";
const SO = process.argv.slice(3);
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHOTS = path.resolve(process.env.E2E_CAPTURAS || "e2e-capturas");
fs.mkdirSync(SHOTS, { recursive: true });

const TODAS = [
  "/", "/?aba=projecao", "/?aba=pessoas", "/?aba=pessoas&visao=relatorios",
  "/financeiro/caixa", "/financeiro/caixa?aba=fluxo", "/financeiro/caixa?aba=analises",
  "/financeiro/extratos", "/financeiro/extratos?aba=revisar", "/financeiro/extratos?aba=conferir",
  "/financeiro/pagamentos", "/financeiro/pagamentos?aba=contas", "/financeiro/pagamentos?aba=recorrencias",
  "/financeiro/caixa?aba=cartoes", "/financeiro/pagamentos?aba=dividas", "/financeiro/pagamentos?aba=pix",
  "/financeiro/receitas", "/financeiro/receitas?aba=cobrancas", "/financeiro/receitas?aba=vendas",
  "/financeiro/relatorios",
  "/configuracoes", "/configuracoes?secao=financeiro", "/configuracoes?secao=plano",
  "/configuracoes?secao=rh", "/configuracoes?secao=usuarios", "/configuracoes?secao=empresas",
  "/configuracoes?secao=funcionalidades",
  "/financeiro/plano-de-contas", "/financeiro/ajustes", "/gestao/usuarios", "/gestao/empresas",
  "/rh", "/rh/funcionarios", "/rh/funcionarios?aba=documentos", "/rh/funcionarios?aba=atestados",
  "/rh/treinamento", "/rh/treinamento?aba=turmas", "/rh/treinamento?aba=pagamentos",
  "/rh/recrutamento", "/rh/recrutamento?aba=talentos", "/rh/recrutamento?aba=agenda", "/rh/recrutamento?aba=roteiro",
  "/rh/folha", "/rh/folha?aba=repasse", "/rh/folha?aba=beneficios", "/rh/folha?aba=rescisoes",
  "/rh/folha?aba=diario", "/rh/configuracoes",
];

// URLs do Financeiro antigo: todas devem cair na aba equivalente sem erro de hidratação.
const ANTIGAS = [
  "/movimentacoes", "/entradas", "/saidas", "/fluxo-caixa", "/saldo-diario", "/importar", "/conciliacao",
  "/conferir-extrato", "/revisao?lote=abc", "/contas-a-pagar", "/previstos", "/recorrentes", "/processos",
  "/pagamentos-diarios", "/clientes", "/vendas", "/plano-de-contas", "/ajustes", "/usuarios", "/empresas",
  "/rh/atestados",
  "/orcamento", "/relatorios",
  // Trocaram de lugar: a projeção foi para a Gestão, as análises para o Caixa.
  "/financeiro/caixa?aba=projecao", "/?aba=analises",
];

const PERFIS = {
  diretoria: { email: "diretoria@zaytanhub.demo", entrada: "/", rotas: TODAS },
  financeiro: { email: "financeiro@zaytanhub.demo", entrada: "/", rotas: ["/", "/rh/folha?aba=repasse", "/configuracoes?secao=usuarios", "/configuracoes?secao=empresas"] },
  // Gestão é do Administrador (ou de quem for liberado): os outros cargos entram pela área deles.
  operador: { email: "operador@zaytanhub.demo", entrada: "/financeiro/caixa", rotas: ["/financeiro/caixa", "/financeiro/ajustes", "/rh"] },
  leitura: { email: "leitura@zaytanhub.demo", entrada: "/financeiro/relatorios", rotas: ["/financeiro/caixa", "/financeiro/extratos", "/?aba=pessoas"] },
  pix: { email: "pix@zaytanhub.demo", entrada: "/financeiro/pagamentos", rotas: ["/financeiro/pagamentos?aba=pix", "/financeiro/caixa", "/rh"] },
  rh: { email: "rh@zaytanhub.demo", entrada: "/rh", rotas: ["/rh/funcionarios", "/rh/folha", "/?aba=pessoas", "/rh/configuracoes", "/financeiro/caixa"] },
  recrutamento: { email: "recrutamento@zaytanhub.demo", entrada: "/rh", rotas: ["/rh/recrutamento", "/rh/recrutamento?aba=agenda", "/rh/folha", "/?aba=pessoas"] },
  antigas: { email: "diretoria@zaytanhub.demo", entrada: "/", rotas: ANTIGAS },
};

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const resultado = [];

// BROWSER_URL: em vez de abrir o navegador, conecta num que já esteja rodando
// em modo depuração (ex.: msedge --headless=new --remote-debugging-port=9333).
// É a saída para máquinas sem Chrome: o Edge 154 sai na hora com o --headless
// antigo que o puppeteer passa no launch.
const browser = process.env.BROWSER_URL
  ? await puppeteer.connect({ browserURL: process.env.BROWSER_URL, defaultViewport: { width: 1440, height: 900 } })
  : await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      args: ["--no-sandbox", "--window-size=1440,900"],
      defaultViewport: { width: 1440, height: 900 },
    });

async function estavel(page, ms = 700) {
  try { await page.waitForNetworkIdle({ idleTime: 400, timeout: 30000 }); } catch { /* segue */ }
  await espera(ms);
}

async function texto(page) {
  return page.evaluate(() => document.body.innerText);
}

for (const [nome, perfil] of Object.entries(PERFIS)) {
  if (SO.length && !SO.includes(nome)) continue;
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const erros = [];
  page.on("console", (m) => {
    if (m.type() === "error") erros.push(`console: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => erros.push(`pageerror: ${String(e.message).slice(0, 300)}`));

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("#email", { timeout: 120000 });
  await page.type("#email", perfil.email);
  await page.type("#password", "demo1234");
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 60000 });
  await estavel(page, 2500);
  const entrou = new URL(page.url()).pathname;
  resultado.push({ perfil: nome, rota: "(login)", ok: entrou === perfil.entrada, detalhe: `entrou em ${entrou} (esperado ${perfil.entrada})` });
  const menu = await page.evaluate(() =>
    [...document.querySelectorAll('[data-sidebar="menu-button"]')].map((a) => a.textContent.trim().replace(/\d+$/, "")).filter(Boolean)
  );
  resultado.push({ perfil: nome, rota: "(menu)", ok: menu.length > 0, detalhe: menu.join(" | ") });

  for (const rota of perfil.rotas) {
    const antes = erros.length;
    await page.goto(`${BASE}${rota}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await estavel(page, rota.startsWith("/rh") || rota.includes("pessoas") ? 1500 : 900);
    // O RH é carregado sob demanda: espera sair do "carregando" (até 45 s).
    try { await page.waitForFunction(() => !/Carregando dados do RH|Abrindo o RH/.test(document.body.innerText), { timeout: 45000 }); } catch { /* registra abaixo */ }
    const body = await texto(page);
    const final = new URL(page.url());
    const h1 = await page.evaluate(() => document.querySelector("main")?.closest("div")?.querySelector("h1")?.textContent ?? document.querySelector("h1")?.textContent ?? "");
    const quebrou = /This page didn't load|Something went wrong|Algo deu errado/i.test(body);
    const restrito = /Acesso restrito/.test(body);
    const carregando = /Carregando dados do RH|Abrindo o RH/.test(body);
    const nomeArq = `${nome}_${rota.replace(/[/?=&]+/g, "_").replace(/^_|_$/g, "") || "raiz"}.png`;
    await page.screenshot({ path: path.join(SHOTS, nomeArq), fullPage: false });
    resultado.push({
      perfil: nome, rota, ok: !quebrou && erros.length === antes && !carregando,
      detalhe: `→ ${final.pathname}${final.search} · h1="${h1.trim()}"${restrito ? " · ACESSO RESTRITO" : ""}${carregando ? " · AINDA CARREGANDO" : ""}${erros.length > antes ? " · ERROS: " + erros.slice(antes).join(" || ") : ""}`,
    });
  }
  await ctx.close();
}

// Conectado (BROWSER_URL), fechar mataria o navegador de quem chamou.
if (process.env.BROWSER_URL) await browser.disconnect();
else await browser.close();
for (const r of resultado) console.log(`${r.ok ? "OK " : "FALHA"} [${r.perfil}] ${r.rota} ${r.detalhe}`);
const falhas = resultado.filter((r) => !r.ok).length;
console.log(`\n${resultado.length - falhas}/${resultado.length} verificações OK`);
process.exitCode = falhas ? 1 : 0;
