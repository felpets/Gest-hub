// Conferência de celular (390 px): nenhuma tela pode rolar na horizontal e o
// console não pode acusar erro. Uso (com o app rodando): npm run test:e2e:celular
// Rolagem horizontal numa tabela larga é esperada DENTRO do cartão (overflow-x);
// o que este teste barra é a PÁGINA inteira passar da largura da tela.
import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";

const BASE = process.argv[2] || "http://127.0.0.1:8080";
const SHOTS = path.resolve("e2e-capturas/celular");
fs.mkdirSync(SHOTS, { recursive: true });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// BROWSER_URL: em vez de abrir o navegador, conecta num que já esteja rodando
// em modo depuração (ex.: msedge --headless=new --remote-debugging-port=9333).
// É a saída para máquinas sem Chrome: o Edge 154 sai na hora com o --headless
// antigo que o puppeteer passa no launch.
const CELULAR = { width: 390, height: 844, isMobile: true, hasTouch: true };
const browser = process.env.BROWSER_URL
  ? await puppeteer.connect({ browserURL: process.env.BROWSER_URL })
  : await puppeteer.launch({
      executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      defaultViewport: CELULAR,
    });
const page = await browser.newPage();
await page.setViewport(CELULAR);
const erros = [];
page.on("console", (m) => m.type() === "error" && erros.push(m.text().slice(0, 160)));
page.on("pageerror", (e) => erros.push(String(e.message).slice(0, 160)));

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector("#email", { timeout: 120000 });
await page.type("#email", "diretoria@zaytanhub.demo");
await page.type("#password", "demo1234");
await page.click('button[type="submit"]');
await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 60000 });
await espera(2500);

const ROTAS = [
  "/", "/?aba=projecao", "/?aba=pessoas",
  "/configuracoes", "/configuracoes?secao=geral", "/configuracoes?secao=funcionalidades",
  "/financeiro/pagamentos", "/financeiro/pagamentos?aba=contas", "/financeiro/pagamentos?aba=dividas",
  "/financeiro/caixa", "/financeiro/caixa?aba=fluxo", "/financeiro/caixa?aba=analises", "/financeiro/caixa?aba=cartoes",
  "/financeiro/extratos", "/financeiro/extratos?aba=revisar", "/financeiro/extratos?aba=conferir",
  "/financeiro/receitas", "/financeiro/receitas?aba=cobrancas", "/financeiro/receitas?aba=vendas",
  "/financeiro/relatorios",
  "/rh", "/rh/funcionarios", "/rh/folha",
];
for (const rota of ROTAS) {
  await page.goto(`${BASE}${rota}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  try { await page.waitForNetworkIdle({ idleTime: 500, timeout: 30000 }); } catch { /* segue */ }
  await espera(1200);
  const largura = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    cliente: document.documentElement.clientWidth,
  }));
  const ok = largura.scroll <= largura.cliente + 1;
  await page.screenshot({ path: path.join(SHOTS, `${rota.replace(/[/?=&]+/g, "_") || "raiz"}.png`), fullPage: false });
  console.log(`${ok ? "OK   " : "FALHA"} ${rota} — scrollWidth ${largura.scroll} / clientWidth ${largura.cliente}`);
}
// ─── Pix do dia no celular: selecionar e abrir a confirmação ───
// A tela de celular (pix-celular.tsx) é outra da de computador, e os testes de
// interação rodam a 1440 px — sem isto, ninguém verifica a seleção com o dedo.
let interacao = "não rodou";
try {
  await page.goto(`${BASE}/financeiro/pagamentos`, { waitUntil: "domcontentloaded", timeout: 120000 });
  try { await page.waitForNetworkIdle({ idleTime: 500, timeout: 30000 }); } catch { /* segue */ }
  await espera(1200);

  const caixa = await page.$('[role="checkbox"]');
  if (!caixa) throw new Error("nenhum Pix pendente para selecionar");
  await caixa.click();
  await espera(400);

  const barra = await page.evaluate(() => document.body.innerText.includes("selecionado"));
  if (!barra) throw new Error("a barra de seleção não apareceu");

  // Clique pelo texto, de dentro da página: a busca por manipulador varia
  // com a versão do puppeteer, e o que importa aqui é o rótulo que a pessoa lê.
  const clicou = await page.evaluate(() => {
    const alvo = Array.from(document.querySelectorAll("button")).find((b) => /Pagar selecionado/i.test(b.textContent || ""));
    if (!alvo) return false;
    alvo.click();
    return true;
  });
  if (!clicou) throw new Error("não achei o botão Pagar selecionado");
  await espera(600);

  const folha = await page.evaluate(() => document.body.innerText.includes("Confirmar pagamentos"));
  if (!folha) throw new Error("a folha de confirmação não abriu");
  await page.screenshot({ path: path.join(SHOTS, "_confirmar_pagamento.png"), fullPage: false });

  // Fecha sem confirmar: o teste não deve mexer nos dados do protótipo.
  await page.keyboard.press("Escape");
  await espera(500);

  // Detalhe (tela 02): abre pelo cartão, tem de virar ?pix=<id> no endereço —
  // é isso que faz o botão voltar do Android fechar o detalhe, e não sair da tela.
  const abriu = await page.evaluate(() => {
    const alvo = Array.from(document.querySelectorAll("button")).find((b) => /Detalhes/i.test(b.textContent || ""));
    if (!alvo) return false;
    alvo.click();
    return true;
  });
  if (!abriu) throw new Error("não achei o cartão para abrir o detalhe");
  await espera(700);

  if (!page.url().includes("pix=")) throw new Error("o detalhe não foi para o endereço (?pix=)");
  const detalhe = await page.evaluate(() => document.body.innerText.includes("Dados do Pix"));
  if (!detalhe) throw new Error("a tela de detalhe não abriu");
  await page.screenshot({ path: path.join(SHOTS, "_detalhe_pagamento.png"), fullPage: false });

  // O mesmo que o botão físico do aparelho faz.
  await page.goBack();
  await espera(700);
  const voltou = await page.evaluate(() => !document.body.innerText.includes("Dados do Pix"));
  if (!voltou) throw new Error("o voltar do aparelho não fechou o detalhe");
  await espera(400);

  // Desmarca: com seleção ativa o botão de Novo Pix some (é o desenho — a barra
  // de pagar toma o lugar dele).
  const caixa2 = await page.$("[role=checkbox]");
  if (caixa2) { await caixa2.click(); await espera(400); }

  // Novo Pix (tela 03): também vive no endereço, por ?form=novo.
  const abriuForm = await page.evaluate(() => {
    const alvo = Array.from(document.querySelectorAll("button")).find((b) => /Novo Pix/i.test(b.textContent || ""));
    if (!alvo) return false;
    alvo.click();
    return true;
  });
  if (!abriuForm) throw new Error("não achei o botão Novo Pix");
  await espera(700);
  if (!page.url().includes("form=")) throw new Error("o formulário não foi para o endereço (?form=)");
  const temForm = await page.evaluate(() => document.body.innerText.includes("Titular recebedor"));
  if (!temForm) throw new Error("o formulário não abriu");
  await page.screenshot({ path: path.join(SHOTS, "_novo_pix.png"), fullPage: false });

  await page.goBack();
  await espera(600);
  const fechouForm = await page.evaluate(() => !document.body.innerText.includes("Titular recebedor"));
  if (!fechouForm) throw new Error("o voltar do aparelho não fechou o formulário");
  await espera(400);

  // Filtros (tela 06): abre pelo cabeçalho, muda o período e aplica.
  const botaoFiltro = await page.$("[aria-label='Filtrar pagamentos']");
  if (!botaoFiltro) throw new Error("não achei o botão de filtrar");
  await botaoFiltro.click();
  await espera(700);
  const temFiltros = await page.evaluate(() => document.body.innerText.includes("Faixa de valor"));
  if (!temFiltros) throw new Error("a tela de filtros não abriu");
  await page.screenshot({ path: path.join(SHOTS, "_filtros.png"), fullPage: false });

  const aplicou = await page.evaluate(() => {
    const botoes = Array.from(document.querySelectorAll("button"));
    const mes = botoes.find((b) => (b.textContent || "").trim() === "Este mês");
    if (!mes) return false;
    mes.click();
    const ver = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").startsWith("Ver ") && (b.textContent || "").includes("resultado"));
    if (!ver) return false;
    ver.click();
    return true;
  });
  if (!aplicou) throw new Error("não consegui aplicar o filtro de período");
  await espera(700);
  const voltouDaLista = await page.evaluate(() => !document.body.innerText.includes("Faixa de valor"));
  if (!voltouDaLista) throw new Error("a tela de filtros não fechou ao aplicar");
  interacao = "OK";
} catch (e) {
  interacao = `FALHA — ${e.message}`;
}
console.log(`${interacao.startsWith("OK") ? "OK   " : "FALHA"} Pix do dia: selecionar → confirmar (${interacao})`);

console.log(erros.length ? `ERROS: ${erros.join(" || ")}` : "sem erros de console");
// Conectado (BROWSER_URL), fechar mataria o navegador de quem chamou.
if (process.env.BROWSER_URL) await browser.disconnect();
else await browser.close();
