// Captura as telas REAIS do protótipo (banco simulado, dados fictícios) para o vídeo.
//
// Antes, suba o app em modo protótipo (na raiz do projeto):
//   $env:VITE_DATA_MODE='mock'; npx vite dev --port 8188 --strictPort --host 127.0.0.1
// Depois:  node capturar.mjs [base] [só-estas,separadas,por,vírgula]
//          → capturas/web/*.png e capturas/celular/*.png
//
// O script só entra com o login de demonstração, que não existe no banco real:
// se o app estiver apontando para dados de verdade, o login falha e nada é capturado.
// O banco do protótipo vive na memória da página: nada do que se clica aqui é gravado.
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || "http://127.0.0.1:8188";
const SO = process.argv[3] ? new Set(process.argv[3].split(",")) : null;
const quer = (nome) => !SO || SO.has(nome);
const EXTRATO_MODELO = path.resolve(RAIZ, "..", "modelo-extrato.ofx");
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Web: 1440x727 é a proporção exata da área útil do navegador desenhado no vídeo.
// Telas mais compridas que isso são capturadas inteiras (até ALTURA_MAX) e o
// vídeo rola por elas. A janela cresce ANTES de abrir a rota: a captura de
// página inteira do Chrome redimensiona a janela e desmonta o estado da tela.
const WEB = { width: 1440, height: 727, deviceScaleFactor: 2 };
const ALTURA_MAX = 1700;
// Celular: a proporção do visor da moldura, descontada a barra de status.
const CELULAR = { width: 390, height: 800, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

// Telas web na ordem do roteiro: [arquivo, rota].
const TELAS_WEB = [
  // Gestão › Dashboard
  ["dashboard", "/"],
  ["projecao", "/?aba=projecao"],
  ["pessoas", "/?aba=pessoas"],
  ["pessoas-relatorios", "/?aba=pessoas&visao=relatorios"],
  // Financeiro
  ["caixa", "/financeiro/caixa"],
  ["fluxo", "/financeiro/caixa?aba=fluxo"],
  ["analises", "/financeiro/caixa?aba=analises"],
  ["cartoes", "/financeiro/caixa?aba=cartoes"],
  ["extratos", "/financeiro/extratos"],
  // (extratos-previa: importação de verdade, logo abaixo)
  ["revisar", "/financeiro/extratos?aba=revisar"],
  ["conferir", "/financeiro/extratos?aba=conferir"],
  ["pix", "/financeiro/pagamentos?aba=pix"],
  ["contas", "/financeiro/pagamentos?aba=contas"],
  ["dividas", "/financeiro/pagamentos?aba=dividas"],
  ["clientes", "/financeiro/receitas"],
  ["cobrancas", "/financeiro/receitas?aba=cobrancas"],
  ["vendas", "/financeiro/receitas?aba=vendas"],
  ["relatorios", "/financeiro/relatorios"],
  // RH
  ["rh", "/rh"],
  ["funcionarios", "/rh/funcionarios"],
  ["documentos", "/rh/funcionarios?aba=documentos"],
  ["atestados", "/rh/funcionarios?aba=atestados"],
  ["treinamento", "/rh/treinamento"],
  ["turmas", "/rh/treinamento?aba=turmas"],
  ["treinamento-pagamento", "/rh/treinamento?aba=pagamentos"],
  ["recrutamento", "/rh/recrutamento"],
  ["talentos", "/rh/recrutamento?aba=talentos"],
  ["agenda", "/rh/recrutamento?aba=agenda"],
  ["roteiro", "/rh/recrutamento?aba=roteiro"],
  ["folha", "/rh/folha"],
  ["repasse", "/rh/folha?aba=repasse"],
  ["beneficios", "/rh/folha?aba=beneficios"],
  ["rescisoes", "/rh/folha?aba=rescisoes"],
  ["diario", "/rh/folha?aba=diario"],
  // Configurações
  ["config-usuarios", "/configuracoes?secao=usuarios"],
  ["config-rh", "/configuracoes?secao=rh"],
  ["config-funcionalidades", "/configuracoes?secao=funcionalidades"],
];

const navegador = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean).find((c) => existsSync(c));
if (!navegador) throw new Error("Não achei Chrome nem Edge. Aponte CHROME_PATH para o executável.");

const browser = await puppeteer.launch({ executablePath: navegador, headless: true, args: ["--hide-scrollbars", "--force-color-profile=srgb"] });

async function entrar(viewport) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("#email", { timeout: 120000 });
  await page.type("#email", "diretoria@zaytanhub.demo");
  await page.type("#password", "demo1234");
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 60000 });
  await espera(2500);
  return page;
}
async function ir(page, rota) {
  await page.goto(`${BASE}${rota}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  try { await page.waitForNetworkIdle({ idleTime: 500, timeout: 6000 }); } catch { /* o servidor de dev nunca fica 100% quieto */ }
  // O RH abre depois do resto da página ("Abrindo o RH..."): espera sumir todo aviso de carregamento.
  try {
    await page.waitForFunction(() => !/Abrindo|Carregando/i.test(document.body.innerText) && !document.querySelector("main .animate-spin"), { timeout: 45000, polling: 300 });
  } catch { console.warn(`! ${rota} ainda carregando`); }
  await espera(1500); // gráficos terminam de animar
}
// Altura do conteúdo, olhando também a área que rola por dentro do layout.
const alturaConteudo = (page) => page.evaluate(() =>
  Math.max(document.documentElement.scrollHeight, ...[...document.querySelectorAll("main, [data-scroll], .overflow-auto, .overflow-y-auto")].map((n) => n.scrollHeight + n.getBoundingClientRect().top)));

function pasta(nome) {
  const p = path.join(RAIZ, "capturas", nome);
  mkdirSync(p, { recursive: true });
  return (arquivo) => path.join(p, `${arquivo}.png`);
}
// Nomes que o vídeo mostra no lugar dos do protótipo. A troca é feita só no
// texto da página, na hora da foto: o código e os dados do app não mudam.
// Cada par é [texto do protótipo, texto no vídeo].
const NOMES = [
  ["Laportec", "Teste"], // a empresa de exemplo do protótipo
];
async function foto(page, arquivo) {
  await page.evaluate((nomes) => {
    const andar = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let no = andar.nextNode(); no; no = andar.nextNode()) {
      let texto = no.nodeValue;
      for (const [de, para] of nomes) texto = texto.split(de).join(para);
      if (texto !== no.nodeValue) no.nodeValue = texto;
    }
  }, NOMES);
  await page.screenshot({ path: arquivo });
}

// Clica pelo texto que a pessoa lê (o mesmo jeito dos testes em scripts/e2e).
async function clicar(page, seletor, texto) {
  const achou = await page.evaluate((seletor, fonte) => {
    const re = new RegExp(fonte, "i");
    const alvo = [...document.querySelectorAll(seletor)].find((n) => re.test(n.textContent || ""));
    if (alvo) alvo.click();
    return !!alvo;
  }, seletor, texto);
  if (!achou) console.warn(`! não achei "${texto}" em ${seletor}`);
  await espera(900);
  return achou;
}

// ─── Web ────────────────────────────────────────────────────
{
  const em = pasta("web");
  const page = await entrar(WEB);
  const alta = (altura) => page.setViewport({ ...WEB, height: altura });

  for (const [arquivo, rota] of TELAS_WEB) {
    if (!quer(arquivo)) continue;
    // 1ª passada mede, 2ª abre já com a janela do tamanho do conteúdo.
    await alta(727);
    await ir(page, rota);
    const h = Math.min(ALTURA_MAX, Math.max(727, Math.ceil(await alturaConteudo(page))));
    if (h > 727) { await alta(h); await ir(page, rota); }
    await foto(page, em(arquivo));
    console.log(`web: ${arquivo}  (${h}px)`);
  }

  // Importação de verdade: o extrato-modelo do repositório, destino = 1ª conta.
  if (quer("extratos-previa")) {
    await alta(1400);
    await ir(page, "/financeiro/extratos");
    const campo = await page.$('input[type="file"]');
    await campo.uploadFile(EXTRATO_MODELO);
    await espera(2500);
    if (await clicar(page, '[role="combobox"]', "Selecionar conta")) {
      const opcao = await page.$('[role="option"]');
      if (opcao) await opcao.click();
      await espera(1500);
    }
    await foto(page, em("extratos-previa"));
    console.log("web: extratos-previa");
  }
  await page.browserContext().close();
}

// ─── Celular ────────────────────────────────────────────────
{
  const em = pasta("celular");
  const page = await entrar(CELULAR);
  const tira = async (arquivo, acao) => { if (quer(`cel-${arquivo}`)) { await acao(); await foto(page, em(arquivo)); console.log(`celular: ${arquivo}`); } };

  await tira("inicio", () => ir(page, "/"));
  await tira("cartoes", () => ir(page, "/financeiro/caixa?aba=cartoes"));
  await tira("fatura", () => clicar(page, "button, a, [role='button']", "Cartão Marketing"));
  await tira("pagamentos", () => ir(page, "/financeiro/pagamentos"));
  await tira("pagamentos-selecionado", async () => {
    const caixa = await page.$('[role="checkbox"]');
    if (caixa) { await caixa.click(); await espera(700); }
  });
  await tira("pagamentos-confirmar", () => clicar(page, "button", "Pagar selecionado")); // para aqui: não confirma
  await tira("rh", () => ir(page, "/rh"));
  await tira("rh-funcionarios", () => ir(page, "/rh/funcionarios"));

  await page.browserContext().close();
}

await browser.close();
