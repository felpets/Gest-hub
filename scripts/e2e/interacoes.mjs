// Interações reais (aprovar revisão, pagar Pix, cadastrar funcionário, filtros e
// configurações do RH, restrições por perfil). Uso: node scripts/e2e/interacoes.mjs [base]
// Interações reais no protótipo (dados fictícios): cada fluxo grava no banco
// simulado e o teste confere o efeito lendo o localStorage do navegador.
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] || "http://127.0.0.1:8080";
const CHAVE_DB = "zaytan.prototipo.db.v9";
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const resultados = [];
const ok = (nome, cond, detalhe = "") => resultados.push({ nome, ok: !!cond, detalhe });

// BROWSER_URL: em vez de abrir o navegador, conecta num que já esteja rodando
// em modo depuração (ex.: msedge --headless=new --remote-debugging-port=9333).
// É a saída para máquinas sem Chrome: o Edge 154 sai na hora com o --headless
// antigo que o puppeteer passa no launch.
const browser = process.env.BROWSER_URL
  ? await puppeteer.connect({ browserURL: process.env.BROWSER_URL, defaultViewport: { width: 1440, height: 900 } })
  : await puppeteer.launch({
      executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      defaultViewport: { width: 1440, height: 900 },
    });

async function abrir(email) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const erros = [];
  page.on("pageerror", (e) => erros.push(String(e.message).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.text())) erros.push(m.text().slice(0, 200)); });
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#email", { timeout: 120000 });
  await page.type("#email", email);
  await page.type("#password", "demo1234");
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 60000 });
  await espera(2000);
  return { ctx, page, erros };
}

async function ir(page, rota, extra = 1500) {
  await page.goto(`${BASE}${rota}`, { waitUntil: "domcontentloaded" });
  try { await page.waitForNetworkIdle({ idleTime: 400, timeout: 30000 }); } catch {}
  try { await page.waitForFunction(() => !/Carregando dados do RH|Abrindo o RH/.test(document.body.innerText), { timeout: 45000 }); } catch {}
  await espera(extra);
}

const db = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), CHAVE_DB);

// Menu do Radix (dropdown): abre no POINTERDOWN, não no click — e o item também
// só responde ao par pointerdown/pointerup. Por isso não dá para usar clicarTexto.
async function clicarNoMenu(page, seletor, re) {
  return page.evaluate((sel, fonte) => {
    const rx = new RegExp(fonte);
    const el = [...document.querySelectorAll(sel)].find((e) => rx.test(e.textContent || ""));
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    el.click();
    return true;
  }, seletor, re.source);
}

async function clicarTexto(page, seletor, re) {
  const achou = await page.evaluate((sel, fonte) => {
    const rx = new RegExp(fonte);
    const el = [...document.querySelectorAll(sel)].find((e) => rx.test(e.textContent || "") && !e.disabled);
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    el.click();
    return true;
  }, seletor, re.source);
  return achou;
}

// ── A) Revisão: aprovar tudo que tem categoria sugerida ──────────────────
{
  const { ctx, page, erros } = await abrir("diretoria@zaytanhub.demo");
  await ir(page, "/financeiro/extratos?aba=revisar");
  const antes = (await db(page)).movimentacoes.filter((m) => m.categoria_status === "pendente").length;
  const clicou = await clicarTexto(page, "button", /^Aprovar \d+ com categoria/);
  await espera(2500);
  const depois = (await db(page)).movimentacoes.filter((m) => m.categoria_status === "pendente").length;
  ok("Extratos › Revisar: aprovar em lote confirma e aprende", clicou && depois < antes, `pendentes ${antes} → ${depois}`);
  const regras = (await db(page)).regras_categorizacao.length;
  ok("Revisão grava/atualiza regras aprendidas", regras > 0, `${regras} regras`);

  // ── B) Pix do dia: marcar um pagamento como pago (com histórico) ────────
  await ir(page, "/financeiro/pagamentos?aba=pix");
  const d0 = await db(page);
  const pagos0 = d0.pagamentos_diarios.filter((p) => p.pago).length;
  const hist0 = d0.pagamentos_diarios_historico.filter((h) => h.acao === "pago").length;
  const abriu = await page.evaluate(() => {
    const b = document.querySelector('button[title="Marcar como pago"]');
    if (b) b.click();
    return !!b;
  });
  await espera(800);
  const confirmou = await clicarTexto(page, "button", /Confirmar pagamento/);
  await espera(2500);
  const d1 = await db(page);
  ok("Pagamentos › Pix: marcar como pago grava e audita", abriu && confirmou && d1.pagamentos_diarios.filter((p) => p.pago).length === pagos0 + 1 && d1.pagamentos_diarios_historico.filter((h) => h.acao === "pago").length === hist0 + 1, `pagos ${pagos0} → ${d1.pagamentos_diarios.filter((p) => p.pago).length}`);

  // ── C) RH: cadastrar funcionário (grava na tabela do RH) ────────────────
  await ir(page, "/rh/funcionarios");
  const f0 = (await db(page))["rh.funcionarios"].length;
  await clicarTexto(page, "button", /Novo funcionário/);
  await espera(800);
  await page.evaluate(() => {
    const campo = [...document.querySelectorAll("label")].find((l) => /Nome completo/.test(l.textContent || ""))?.querySelector("input");
    if (!campo) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(campo, "Pessoa de Teste Automatizado");
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await espera(300);
  await clicarTexto(page, "button", /^\s*Salvar\s*$/);
  await espera(3000);
  const funcs = (await db(page))["rh.funcionarios"];
  ok("RH › Funcionários: novo cadastro é gravado", funcs.length === f0 + 1 && funcs.some((r) => r.nome === "Pessoa de Teste Automatizado"), `${f0} → ${funcs.length}`);

  // ── D) RH: filtro "Pendentes" do VT (antes quebrava a tela) ─────────────
  await ir(page, "/rh/folha?aba=beneficios");
  const antesErros = erros.length;
  const trocou = await page.evaluate(() => {
    const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "pendentes") && [...s.options].some((o) => o.value === "pagos"));
    if (!sel) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(sel, "pendentes");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  });
  await espera(1500);
  const texto = await page.evaluate(() => document.body.innerText);
  ok("RH › Benefícios › VT: filtro Pendentes não derruba a tela", trocou && erros.length === antesErros && !/didn't load|Something went wrong/.test(texto), trocou ? "" : "select não encontrado");

  // ── E) Configurações › RH: horário da jornada é gravado como horário ────
  await ir(page, "/configuracoes?secao=rh");
  await clicarTexto(page, "button", /Benefícios/);
  await espera(800);
  const mudou = await page.evaluate(() => {
    const campo = [...document.querySelectorAll("label")].find((l) => /^Entrada/.test(l.textContent || ""))?.querySelector('input[type="time"]');
    if (!campo) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(campo, "08:00");
    campo.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  });
  await espera(2500);
  const cfg = (await db(page))["rh.config"]?.[0]?.data ?? {};
  ok("Configurações › RH: jornada guarda '08:00' (antes virava 0)", mudou && cfg.jornadaEntrada === "08:00", `jornadaEntrada=${JSON.stringify(cfg.jornadaEntrada)}`);

  ok("Sem erros de página no fluxo do master", erros.length === 0, erros.join(" | "));
  await ctx.close();
}

// ── F) Perfil RH restrito à Laportec ─────────────────────────────────────
{
  const { ctx, page, erros } = await abrir("rh@zaytanhub.demo");
  await ir(page, "/rh/funcionarios");
  const texto = await page.evaluate(() => document.body.innerText);
  const seletor = await page.evaluate(() => document.querySelector("header")?.innerText ?? "");
  ok("RH restrito: vê Laportec e não vê Avora/Zaytan", /Ana Beatriz Moura/.test(texto) && !/Rafaela Cunha|Yasmin Albuquerque/.test(texto) && /Laportec/.test(seletor) && !/Todas as empresas/.test(texto));
  await ir(page, "/?aba=pessoas");
  const t2 = await page.evaluate(() => document.body.innerText);
  // A Gestão (e os indicadores de pessoas dentro dela) é do Administrador ou de quem for liberado.
  ok("RH restrito: sem a Gestão liberada, os indicadores da Gestão ficam fechados",
    /Acesso restrito/.test(t2) && !/Indicadores de RH/.test(t2));
  ok("Sem erros de página no perfil RH", erros.length === 0, erros.join(" | "));
  await ctx.close();
}

// ── G) Operador não grava configuração (RLS espelhada) ───────────────────
{
  const { ctx, page, erros } = await abrir("operador@zaytanhub.demo");
  // Sem config_gerir a seção "Ajustes do Financeiro" nem aparece na lista da
  // esquerda: a página cai na primeira permitida (Geral).
  await ir(page, "/configuracoes?secao=financeiro");
  const texto = await page.evaluate(() => document.body.innerText);
  ok("Operador: Ajustes do Financeiro não aparece nas Configurações", !/Contas bancárias/.test(texto) && /Aparência/.test(texto));
  await ir(page, "/financeiro/caixa");
  const t2 = await page.evaluate(() => document.body.innerText);
  ok("Operador: Caixa abre com lançamentos", /Movimentações/.test(t2) && /PIX RECEBIDO|SISPAG|ALUGUEL/i.test(t2));
  ok("Sem erros de página no perfil operador", erros.length === 0, erros.join(" | "));
  await ctx.close();
}

// ── H) Pix do dia enxerga os pagamentos diários do RH (só leitura) ───────
{
  const { ctx, page, erros } = await abrir("pix@zaytanhub.demo");
  await ir(page, "/financeiro/pagamentos?aba=pix");
  const texto = await page.evaluate(() => document.body.innerText);
  ok("Pix do dia: mostra os pagamentos diários lançados no RH", /Pagamentos diários lançados no RH/.test(texto) && /Carlos Eduardo Ramos/.test(texto) && /Somente leitura/.test(texto));
  const menu = await page.evaluate(() => [...document.querySelectorAll('[data-sidebar="menu-button"]')].map((a) => a.textContent.trim()).join("|"));
  ok("Pix do dia: ver o RH aqui não abre o módulo RH", !/Painel do RH/.test(menu), menu);
  ok("Sem erros de página no perfil Pix", erros.length === 0, erros.join(" | "));
  await ctx.close();
}

// ── I) O RH não enxerga o Pix do Financeiro ──────────────────────────────
{
  const { ctx, page, erros } = await abrir("rh@zaytanhub.demo");
  await ir(page, "/rh/folha?aba=diario");
  const texto = await page.evaluate(() => document.body.innerText);
  ok("RH › Pagamento diário: lista só o que o RH lançou", /Carlos Eduardo Ramos/.test(texto) && !/Transportes Rápido ME/.test(texto));
  await ir(page, "/financeiro/pagamentos?aba=pix");
  const t2 = await page.evaluate(() => document.body.innerText);
  ok("RH: Pix do dia do Financeiro fica fechado", /Acesso restrito/.test(t2) && !/Transportes Rápido ME/.test(t2));
  ok("Sem erros de página no perfil RH (Pix)", erros.length === 0, erros.join(" | "));
  await ctx.close();
}

// ── K) RH separado por empresa (seletor do topo, como no Financeiro) ─────
{
  const { ctx, page, erros } = await abrir("diretoria@zaytanhub.demo");
  await ir(page, "/rh/funcionarios");
  // A lista pagina (12 por página): compara o total de registros e as empresas da coluna Empresa.
  const retrato = () => page.evaluate(() => {
    const texto = document.body.innerText;
    const total = Number((texto.match(/(\d+) registro\(s\)/) || [])[1] ?? -1);
    const idx = [...document.querySelectorAll("thead th")].findIndex((th) => /^\s*Empresa/i.test(th.textContent || ""));
    const empresas = idx < 0 ? [] : [...new Set([...document.querySelectorAll("tbody tr")].map((tr) => tr.children[idx]?.textContent?.trim()).filter(Boolean))];
    const filtroEmpresa = [...document.querySelectorAll("select")].some((s) => [...s.options].some((o) => o.value === "Avora"));
    return { total, empresas, filtroEmpresa };
  });
  const escolher = async (rotulo) => {
    await page.click('button[aria-label="Empresa ativa no RH"]');
    await espera(500);
    const clicou = await clicarTexto(page, '[role="menuitem"]', new RegExp(`^${rotulo}`));
    await espera(1500);
    return clicou;
  };
  const r0 = await retrato();
  ok("RH por empresa: abre na empresa ativa (Laportec) sem misturar as outras", r0.total > 0 && r0.empresas.join() === "Laportec" && !r0.filtroEmpresa, JSON.stringify(r0));
  const trocouZ = await escolher("Zaytan");
  const r1 = await retrato();
  ok("RH por empresa: trocar para Zaytan mostra só a Zaytan", trocouZ && r1.total > 0 && r1.empresas.join() === "Zaytan", JSON.stringify(r1));
  const trocouT = await escolher("Todas as empresas");
  const r2 = await retrato();
  ok("RH por empresa: 'Todas as empresas' junta o grupo", trocouT && r2.total > r0.total && r2.total > r1.total && r2.filtroEmpresa && r2.empresas.length > 1, JSON.stringify(r2));
  await escolher("Laportec");
  await ir(page, "/financeiro/pagamentos?aba=pix");
  const empresaFin = await page.evaluate(() => document.querySelector("header")?.innerText ?? "");
  ok("RH por empresa: escolher a Laportec no RH deixa o Financeiro na Laportec", /Laportec/.test(empresaFin));
  ok("Sem erros de página ao trocar a empresa do RH", erros.length === 0, erros.join(" | "));
  await ctx.close();
}

// Abre o diálogo Acessos da linha de um login (Gestão › Usuários).
async function abrirAcessos(page, email) {
  const abriu = await page.evaluate((alvo) => {
    const linha = [...document.querySelectorAll("tr")].find((tr) => (tr.textContent || "").includes(alvo));
    const b = linha?.querySelector('button[title="Acessos"]');
    if (b) b.click();
    return !!b;
  }, email);
  await espera(800);
  return abriu;
}

const menuLateral = (page) => page.evaluate(() =>
  [...document.querySelectorAll('[data-sidebar="menu-button"]')].map((a) => (a.textContent || "").trim().replace(/\d+$/, "")));

// ── J) Master libera o RH para uma pessoa (Gestão › Usuários) ────────────
{
  const { ctx, page, erros } = await abrir("diretoria@zaytanhub.demo");
  await ir(page, "/configuracoes?secao=usuarios");
  const operador = "7d0c0000-0000-4000-8000-000000000003";
  const antes = ((await db(page)).rh_acessos ?? []).some((a) => a.user_id === operador);
  const abriu = await abrirAcessos(page, "operador@zaytanhub.demo");
  await page.click('[role="dialog"] button[aria-label="RH"]');
  await espera(300);
  const liberou = await clicarTexto(page, '[role="dialog"] button', /^\s*Salvar acessos\s*$/);
  await espera(2000);
  const depois = ((await db(page)).rh_acessos ?? []).some((a) => a.user_id === operador);
  ok("Gestão › Usuários: master libera o RH para uma pessoa", !antes && abriu && liberou && depois);
  ok("Sem erros de página ao liberar o RH", erros.length === 0, erros.join(" | "));
  await ctx.close();
}

// ── J2) Gestão: só Administrador — ou quem o master liberar em Usuários ───
{
  const operador = "7d0c0000-0000-4000-8000-000000000003";
  // Antes: o Operador não vê a Gestão (nem no menu, nem pelo endereço).
  const op = await abrir("operador@zaytanhub.demo");
  const menuAntes = await menuLateral(op.page);
  await ir(op.page, "/");
  const telaAntes = await op.page.evaluate(() => document.body.innerText);
  ok("Gestão: Operador não vê o Dashboard no menu", !menuAntes.includes("Dashboard"), menuAntes.join("|"));
  ok("Gestão: Operador abrindo '/' não vê a Gestão", !/Previsão de caixa|Como o caixa fechou/.test(telaAntes), op.page.url());
  await op.ctx.close();

  // O master liga a Gestão para ele em Configurações › Usuários.
  const m = await abrir("diretoria@zaytanhub.demo");
  await ir(m.page, "/configuracoes?secao=usuarios");
  const abriu = await abrirAcessos(m.page, "operador@zaytanhub.demo");
  await m.page.click('[role="dialog"] button[aria-label="Gestão"]');
  await espera(300);
  await clicarTexto(m.page, '[role="dialog"] button', /^\s*Salvar acessos\s*$/);
  await espera(2000);
  const banco = await db(m.page);
  const liberado = (banco.gestao_acessos ?? []).some((g) => g.user_id === operador);
  const registrou = (banco.usuarios_historico ?? []).some((h) => h.user_id === operador && h.acao === "acesso_gestao");
  ok("Gestão: master libera a Gestão para o Operador (e fica no registro)", abriu && liberado && registrou);

  // Agora o Operador vê (mesmo navegador: o banco da demo é o que o master gravou).
  await trocarLogin(m.page, "operador@zaytanhub.demo");
  await ir(m.page, "/");
  const telaDepois = await m.page.evaluate(() => document.body.innerText);
  const menuDepois = await menuLateral(m.page);
  ok("Gestão: liberado, o Operador vê o Dashboard", /Previsão de caixa/.test(telaDepois) && menuDepois.includes("Dashboard"), menuDepois.join("|"));
  ok("Sem erros de página na liberação da Gestão", op.erros.length === 0 && m.erros.length === 0,
    [...op.erros, ...m.erros].join(" | "));
  await m.ctx.close();
}

// Menu de um seletor do topo: abre e devolve os nomes (e fecha com Escape).
async function itensDoSeletor(page, rotulo) {
  const botao = await page.$(`button[aria-label="${rotulo}"]`);
  if (!botao) return null;
  await botao.click();
  await espera(500);
  const itens = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map((e) => (e.textContent || "").trim()));
  await page.keyboard.press("Escape");
  await espera(300);
  return itens;
}

// Abas da PÁGINA (AbasPagina, no cabeçalho). As telas embutidas têm abas
// próprias (o Pix tem Lista/Histórico), então não serve varrer todo role="tab".
async function abasDaPagina(page) {
  return page.evaluate(() => {
    const lista = document.querySelector('[role="tablist"]');
    return [...(lista?.querySelectorAll('[role="tab"]') ?? [])].map((b) => b.textContent.trim()).join("|");
  });
}

async function digitar(page, seletor, valor) {
  await page.evaluate((sel, v) => {
    const campo = document.querySelector(sel);
    if (!campo) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(campo, v);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  }, seletor, valor);
}

// Troca o login no mesmo navegador (o banco simulado fica no localStorage dele).
async function trocarLogin(page, email) {
  await page.evaluate(() => localStorage.removeItem("zaytan.prototipo.sessao.v1"));
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#email", { timeout: 60000 });
  await page.type("#email", email);
  await page.type("#password", "demo1234");
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 60000 });
  await espera(2000);
}

// ── L) Empresa só do RH (Gestão › Empresas e cargos) ─────────────────────
{
  const { ctx, page, erros } = await abrir("diretoria@zaytanhub.demo");
  await ir(page, "/configuracoes?secao=empresas");
  await clicarTexto(page, "button", /Nova empresa/);
  await espera(600);
  await digitar(page, '[role="dialog"] input', "Filial Recrutamento");
  const escolheu = await clicarTexto(page, '[role="radio"]', /^RHFuncionários/);
  await espera(300);
  const criou = await clicarTexto(page, '[role="dialog"] button', /^\s*Criar\s*$/);
  await espera(2500);
  const criada = ((await db(page)).empresas ?? []).find((e) => e.nome === "Filial Recrutamento");
  ok("Empresas: cria empresa só do RH", escolheu && criou && JSON.stringify(criada?.modulos) === '["rh"]', JSON.stringify(criada?.modulos));
  await ir(page, "/financeiro/caixa");
  const doFinanceiro = await itensDoSeletor(page, "Empresa ativa no Financeiro");
  await ir(page, "/rh/funcionarios");
  const doRH = await itensDoSeletor(page, "Empresa ativa no RH");
  ok("Empresa só do RH: aparece no seletor do RH e não no do Financeiro",
    !!doFinanceiro && !doFinanceiro.includes("Filial Recrutamento") && !!doRH && doRH.includes("Filial Recrutamento"),
    `Financeiro=${JSON.stringify(doFinanceiro)} RH=${JSON.stringify(doRH)}`);
  ok("Sem erros de página ao criar empresa do RH", erros.length === 0, erros.join(" | "));
  await ctx.close();
}

// ── M) RH em duas empresas (sem ser todas) ───────────────────────────────
{
  const { ctx, page, erros } = await abrir("diretoria@zaytanhub.demo");
  await ir(page, "/configuracoes?secao=usuarios");
  await abrirAcessos(page, "operador@zaytanhub.demo");
  await page.click('[role="dialog"] button[aria-label="RH"]');
  await espera(300);
  await page.click('[role="dialog"] button[aria-label="Todas as empresas"]');
  await espera(200);
  await page.click('[role="dialog"] button[aria-label="Laportec"]');
  await page.click('[role="dialog"] button[aria-label="Zaytan"]');
  await espera(200);
  await clicarTexto(page, '[role="dialog"] button', /^\s*Salvar acessos\s*$/);
  await espera(2000);
  const operador = "7d0c0000-0000-4000-8000-000000000003";
  const acesso = ((await db(page)).rh_acessos ?? []).find((a) => a.user_id === operador);
  ok("Usuários: libera o RH em duas empresas", JSON.stringify(acesso?.empresas) === '["Laportec","Zaytan"]', JSON.stringify(acesso?.empresas));

  await trocarLogin(page, "operador@zaytanhub.demo");
  await ir(page, "/rh/funcionarios");
  const itens = await itensDoSeletor(page, "Empresa ativa no RH");
  ok("RH em duas empresas: o seletor mostra só as duas, sem 'Todas as empresas'",
    JSON.stringify(itens) === '["Laportec","Zaytan"]', JSON.stringify(itens));
  ok("Sem erros de página no RH com duas empresas", erros.length === 0, erros.join(" | "));
  await ctx.close();
}

// ── N) Só o RH: tira o Financeiro e liga o RH ────────────────────────────
{
  const { ctx, page, erros } = await abrir("diretoria@zaytanhub.demo");
  await ir(page, "/configuracoes?secao=usuarios");
  await abrirAcessos(page, "leitura@zaytanhub.demo");
  await page.click('[role="dialog"] button[aria-label="Financeiro"]');
  await page.click('[role="dialog"] button[aria-label="RH"]');
  await espera(300);
  await clicarTexto(page, '[role="dialog"] button', /^\s*Salvar acessos\s*$/);
  await espera(2000);
  const leitura = "7d0c0000-0000-4000-8000-000000000004";
  const d = await db(page);
  const semFinanceiro = !(d.empresa_membros ?? []).some((m) => m.user_id === leitura);
  const comRH = (d.rh_acessos ?? []).some((a) => a.user_id === leitura);
  ok("Acessos: tira o Financeiro e liga o RH", semFinanceiro && comRH);

  await trocarLogin(page, "leitura@zaytanhub.demo");
  const entrada = new URL(page.url()).pathname;
  const menu = await menuLateral(page);
  ok("Só RH: entra no RH e o menu não mostra o Financeiro",
    entrada === "/rh" && menu.includes("Funcionários") && !menu.includes("Caixa") && !menu.includes("Empresas e cargos"),
    `entrada=${entrada} menu=${menu.join("|")}`);
  ok("Sem erros de página no login só do RH", erros.length === 0, erros.join(" | "));
  await ctx.close();
}

// ── O) Administração (Empresas e cargos) para outra pessoa ───────────────
{
  const { ctx, page, erros } = await abrir("diretoria@zaytanhub.demo");
  await ir(page, "/configuracoes?secao=usuarios");
  await abrirAcessos(page, "diretoria@zaytanhub.demo");
  const propriaTravada = await page.evaluate(() =>
    document.querySelector('[role="dialog"] button[aria-label="Administração — Empresas e cargos"]')?.disabled === true);
  await page.keyboard.press("Escape");
  await espera(500);
  ok("Administração: ninguém tira a própria", propriaTravada);

  await abrirAcessos(page, "operador@zaytanhub.demo");
  await page.click('[role="dialog"] button[aria-label="Administração — Empresas e cargos"]');
  await espera(300);
  await clicarTexto(page, '[role="dialog"] button', /^\s*Salvar acessos\s*$/);
  await espera(2000);
  const operador = "7d0c0000-0000-4000-8000-000000000003";
  const virou = ((await db(page)).perfis ?? []).some((p) => p.user_id === operador && p.is_master === true);
  ok("Administração: liga para outra pessoa", virou);

  await trocarLogin(page, "operador@zaytanhub.demo");
  await ir(page, "/configuracoes", 1500);
  const secoes = await page.evaluate(() => document.querySelector("nav[aria-label='Seções das configurações']")?.innerText ?? "");
  ok("Administração: a pessoa passa a ver Empresas e cargos nas Configurações",
    /Empresas e cargos/.test(secoes), secoes.split("\n").filter(Boolean).join(" · "));
  ok("Sem erros de página ao ligar a administração", erros.length === 0, erros.join(" | "));
  await ctx.close();
}

// ── P) Excluir login mantendo o registro de alterações ───────────────────
{
  const { ctx, page, erros } = await abrir("diretoria@zaytanhub.demo");
  await ir(page, "/configuracoes?secao=usuarios");
  const semBotaoProprio = await page.evaluate(() => {
    const linha = [...document.querySelectorAll("tr")].find((tr) => (tr.textContent || "").includes("diretoria@zaytanhub.demo"));
    return !!linha && !linha.querySelector('button[title="Excluir login"]');
  });
  ok("Excluir login: o botão não aparece no próprio login", semBotaoProprio);

  const abriu = await page.evaluate(() => {
    const linha = [...document.querySelectorAll("tr")].find((tr) => (tr.textContent || "").includes("leitura@zaytanhub.demo"));
    const b = linha?.querySelector('button[title="Excluir login"]');
    if (b) b.click();
    return !!b;
  });
  await espera(800);
  await digitar(page, '[role="dialog"] input[aria-label="Confirmar e-mail"]', "leitura@zaytanhub.demo");
  await espera(300);
  const excluiu = await clicarTexto(page, '[role="dialog"] button', /^\s*Excluir login\s*$/);
  await espera(2500);
  const lista = await page.evaluate(() => document.body.innerText);
  ok("Excluir login: some da lista", abriu && excluiu && !lista.includes("leitura@zaytanhub.demo"));

  await page.click('[role="tab"][id$="-trigger-historico"]');
  await espera(1500);
  const registro = await page.evaluate(() => document.body.innerText);
  ok("Registro de alterações: mostra a exclusão com o que a pessoa tinha",
    /Login excluído/.test(registro) && registro.includes("leitura@zaytanhub.demo") && /Laportec \(Visualizador\)/.test(registro));
  ok("Sem erros de página ao excluir login", erros.length === 0, erros.join(" | "));

  await page.evaluate(() => localStorage.removeItem("zaytan.prototipo.sessao.v1"));
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#email", { timeout: 60000 });
  await page.type("#email", "leitura@zaytanhub.demo");
  await page.type("#password", "demo1234");
  await page.click('button[type="submit"]');
  await espera(2500);
  ok("Login excluído não entra mais", new URL(page.url()).pathname.startsWith("/login"));
  await ctx.close();
}

// ── L) Dashboard: histórico do extrato, com os números batendo ───────────
{
  const { ctx, page, erros } = await abrir("diretoria@zaytanhub.demo");
  await ir(page, "/", 2600);
  const tela = await page.evaluate(() => document.body.innerText);
  const acha = (re) => (tela.match(re) || [])[1] ?? "";

  // O cartão do topo e as duas listas leem o MESMO extrato: os totais têm de
  // ser iguais (era o que divergia quando a lista vinha dos compromissos).
  const cartaoEntrou = acha(/Receita recebida\s+(R\$[\s\S]{1,14}?)\s+\d+ entradas/);
  const cartaoSaiu = acha(/Já saiu\s+(R\$[\s\S]{1,14}?)\s+\d+ saídas/);
  const listaEntrou = acha(/Entradas do extrato[\s\S]{0,60}?·\s*(R\$[^\s]*\s?[\d.,]+) em/);
  const listaSaiu = acha(/Saídas do extrato[\s\S]{0,60}?·\s*(R\$[^\s]*\s?[\d.,]+) em/);
  ok("Dashboard: o cartão do período e as listas mostram o mesmo total",
    !!cartaoEntrou && cartaoEntrou === listaEntrou && !!cartaoSaiu && cartaoSaiu === listaSaiu,
    `cartão ${cartaoEntrou}/${cartaoSaiu} · listas ${listaEntrou}/${listaSaiu}`);

  // Só o trecho das listas: "Projeção de caixa" agora é o nome de uma aba.
  const listas = tela.slice(tela.indexOf("Entradas do extrato"));
  ok("Dashboard: as listas são do extrato, sem previsto nem projeção",
    /Entradas do extrato/.test(tela) && /Saídas do extrato/.test(tela)
    && !/Detalhamento de (entradas|saídas)/.test(tela) && !/Projeção|Previsto|Vencido/.test(listas));

  // Lançar conta a pagar/receber é das telas donas — não daqui.
  ok("Dashboard: não lança conta a pagar nem a receber", !/Nova (entrada|saída)/.test(tela));

  // Clicar na barra do gráfico filtra a lista de baixo; clicar de novo desfaz.
  const totalSaidas = (txt) => (txt.match(/Saídas do extrato[\s\S]{0,80}?·\s*(R\$[^\s]*\s?[\d.,]+) em (\d+)/) || []).slice(1).join(" em ");
  const antesFiltro = totalSaidas(tela);
  const clicouBarra = await page.evaluate(() => {
    const h = [...document.querySelectorAll("h3")].find((x) => x.textContent.trim() === "Despesas");
    const barra = h?.closest("div")?.querySelector("path.recharts-rectangle");
    if (!barra) return false;
    barra.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return true;
  });
  await espera(1200);
  const comFiltro = await page.evaluate(() => document.body.innerText);
  ok("Dashboard: clicar na barra filtra só a lista daquele gráfico",
    clicouBarra && totalSaidas(comFiltro) !== antesFiltro
      && /Entradas do extrato[\s\S]{0,80}?em 11 lançamentos|Entradas do extrato/.test(comFiltro),
    `${antesFiltro} → ${totalSaidas(comFiltro)}`);
  await page.evaluate(() => {
    const h = [...document.querySelectorAll("h3")].find((x) => x.textContent.trim() === "Despesas");
    h?.closest("div")?.querySelector("path.recharts-rectangle")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await espera(1000);
  ok("Dashboard: clicar de novo na mesma barra desfaz o filtro",
    totalSaidas(await page.evaluate(() => document.body.innerText)) === antesFiltro);

  // Mês anterior: mesma leitura, com o saldo do fim do período.
  await clicarTexto(page, '[role="tab"]', /^\s*Mês anterior\s*$/);
  await espera(2200);
  const anterior = await page.evaluate(() => document.body.innerText);
  ok("Dashboard: mês que já passou mostra o saldo do fim do período",
    /Saldo no fim do período/.test(anterior) && /o que já passou pelo extrato/.test(anterior));

  // Seletor de conta: com 2+ contas, dá para ler o resultado de uma só sem sair daqui.
  await clicarTexto(page, '[role="tab"]', /^\s*Mês atual\s*$/);
  await espera(2200);
  const comTodas = await page.evaluate(() => document.body.innerText);
  const abriuContas = await clicarNoMenu(page, '[title="Ver os números de uma conta ou de todas"]', /Todas as contas/);
  await espera(700);
  const escolheuConta = await clicarNoMenu(page, '[role="menuitem"]', /Conta Recebimentos/);
  await espera(2400);
  const comUmaConta = await page.evaluate(() => document.body.innerText);
  ok("Dashboard: dá para trocar a conta que está sendo lida",
    abriuContas && escolheuConta && /Conta Recebimentos/.test(comUmaConta)
      && (totalSaidas(comUmaConta) !== totalSaidas(comTodas) || /Nenhuma saída no extrato/.test(comUmaConta)),
    `${totalSaidas(comTodas)} → ${totalSaidas(comUmaConta)}`);

  // O mesmo seletor existe na Projeção de caixa e nas Análises financeiras.
  await ir(page, "/?aba=projecao", 2400);
  const naProjecao = await page.evaluate(() => !!document.querySelector('[title="Ver os números de uma conta ou de todas"]'));
  await ir(page, "/financeiro/caixa?aba=analises", 2400);
  const nasAnalises = await page.evaluate(() => !!document.querySelector('[title="Ver os números de uma conta ou de todas"]'));
  ok("Projeção e Análises também trocam de conta na própria tela", naProjecao && nasAnalises,
    `projeção ${naProjecao} · análises ${nasAnalises}`);

  ok("Sem erros de página no Dashboard", erros.length === 0, erros.join(" | "));
  await ctx.close();
}

// ── M) Funcionalidade opcional: Dívidas e acordos liga e desliga ─────────
{
  const { ctx, page, erros } = await abrir("diretoria@zaytanhub.demo");
  await ir(page, "/financeiro/pagamentos", 1800);
  const abasAntes = await abasDaPagina(page);
  ok("Pagamentos: o Pix do dia é a primeira aba", abasAntes.startsWith("Pix do dia"), abasAntes);
  ok("Pagamentos: Visão geral e Recorrências não voltaram como aba",
    abasAntes === "Pix do dia|Contas do mês|Dívidas e acordos", abasAntes);

  await ir(page, "/configuracoes?secao=funcionalidades", 1500);
  const desligou = await page.evaluate(() => {
    const sw = document.querySelector('[role="switch"][aria-label="Dívidas e acordos"]');
    if (!sw) return false;
    sw.click();
    return true;
  });
  await espera(2000);
  await ir(page, "/financeiro/pagamentos", 1800);
  const abasDepois = await abasDaPagina(page);
  ok("Funcionalidades: desligar Dívidas e acordos tira a aba do Pagamentos",
    desligou && abasDepois === "Pix do dia|Contas do mês", abasDepois);

  const acordos = (await db(page)).pagamentos_processos ?? [];
  ok("Funcionalidades: desligar não apaga os acordos cadastrados", acordos.length > 0, `${acordos.length} acordo(s)`);

  await ir(page, "/configuracoes?secao=funcionalidades", 1500);
  await page.evaluate(() => document.querySelector('[role="switch"][aria-label="Dívidas e acordos"]')?.click());
  await espera(2000);
  await ir(page, "/financeiro/pagamentos", 1800);
  const abasFinal = await abasDaPagina(page);
  ok("Funcionalidades: religar traz a aba de volta",
    abasFinal === "Pix do dia|Contas do mês|Dívidas e acordos", abasFinal);

  ok("Sem erros de página nas Funcionalidades", erros.length === 0, erros.join(" | "));
  await ctx.close();
}

// ── N) Configurações: uma área só, com as seções de cada parte ───────────
{
  const { ctx, page, erros } = await abrir("diretoria@zaytanhub.demo");
  await ir(page, "/configuracoes", 1500);
  const secoes = await page.evaluate(() => document.querySelector("nav[aria-label='Seções das configurações']")?.innerText ?? "");
  ok("Configurações: reúne Financeiro, RH, usuários, empresas e funcionalidades",
    /Ajustes do Financeiro/.test(secoes) && /Plano de contas/.test(secoes) && /Configurações do RH/.test(secoes)
    && /Usuários/.test(secoes) && /Empresas e cargos/.test(secoes) && /Funcionalidades/.test(secoes), secoes.replace(/\n/g, " · "));

  const menu = await page.evaluate(() => [...document.querySelectorAll('[data-sidebar="menu-button"]')].map((a) => a.textContent.trim().replace(/\d+$/, "")).join("|"));
  ok("Menu: Gestão vem primeiro e não sobrou configuração no menu lateral",
    menu.startsWith("Dashboard") && !/Ajustes|Plano de contas|Usuários|Empresas e cargos|Configurações do RH/.test(menu), menu);

  const engrenagem = await page.evaluate(() => !!document.querySelector('header a[aria-label="Configurações"]'));
  ok("Configurações: a engrenagem fica no canto superior direito", engrenagem);

  ok("Sem erros de página nas Configurações", erros.length === 0, erros.join(" | "));
  await ctx.close();
}

// ── O) Recorrência de Folha com o valor vindo do RH ──────────────────────
{
  const { ctx, page, erros } = await abrir("diretoria@zaytanhub.demo");
  await ir(page, "/financeiro/pagamentos?aba=contas", 2200);

  const antes = await page.evaluate((k) => {
    const db = JSON.parse(localStorage.getItem(k) || "{}");
    const rec = (db.recorrentes || []).find((r) => /Folha de pagamento/i.test(r.descricao));
    return { id: rec?.id ?? null, valor: rec?.valor ?? null };
  }, CHAVE_DB);

  const abriu = await page.evaluate(() => {
    const linha = [...document.querySelectorAll("tr")].find((tr) =>
      /Folha de pagamento/i.test(tr.textContent || "") && tr.querySelector('button[title^="Editar"]'));
    linha?.querySelector('button[title^="Editar"]')?.click();
    return !!linha;
  });
  await espera(1100);

  await page.evaluate(() => {
    const g = [...document.querySelectorAll('[role="dialog"] [role="combobox"]')]
      .find((x) => /Valor fixo|Folha|Salários|Adiantamento|Vale/.test(x.textContent || ""));
    g?.click();
  });
  await espera(700);
  const escolheu = await page.evaluate(() => {
    const o = [...document.querySelectorAll('[role="option"]')].find((x) => /líquido a pagar/i.test(x.textContent || ""));
    if (!o) return false;
    o.click();
    return true;
  });
  await espera(900);

  const previa = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? "");
  ok("Recorrência do RH: o diálogo mostra o total do mês antes de salvar",
    abriu && escolheu && /Este mês:\s*R\$/.test(previa) && /pessoa\(s\)/.test(previa));

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /Salvar altera/.test(x.textContent || ""));
    b?.click();
  });
  await espera(3000);

  const depois = await page.evaluate((k) => {
    const db = JSON.parse(localStorage.getItem(k) || "{}");
    const rec = (db.recorrentes || []).find((r) => /Folha de pagamento/i.test(r.descricao));
    const prev = (db.previstos || []).filter((x) => x.recorrente_id === rec?.id).sort((a, b) => a.data.localeCompare(b.data));
    return {
      fonte: rec?.fonte_rh ?? null,
      valor: rec?.valor ?? null,
      pagos: prev.filter((x) => x.pago).map((x) => x.valor),
      abertos: prev.filter((x) => !x.pago).map((x) => x.valor),
    };
  }, CHAVE_DB);

  ok("Recorrência do RH: a regra grava a fonte e o total do RH", depois.fonte === "folha_liquida" && depois.valor > 0, JSON.stringify(depois.fonte));
  ok("Recorrência do RH: as contas EM ABERTO passam a valer o total do RH",
    depois.abertos.length > 0 && depois.abertos.every((v) => Math.abs(v - depois.valor) < 0.01),
    `abertos=${[...new Set(depois.abertos)].join("/")} valor=${depois.valor}`);
  ok("Recorrência do RH: conta JÁ PAGA não é mexida",
    depois.pagos.every((v) => Math.abs(v - antes.valor) < 0.01),
    `pagos=${[...new Set(depois.pagos)].join("/")} antes=${antes.valor}`);

  // Com a recorrência cobrindo a folha, a lista por pessoa some dos próximos
  // movimentos (o mesmo dinheiro não aparece duas vezes).
  await ir(page, "/", 2600);
  const dash = await page.evaluate(() => document.body.innerText);
  const proximos = dash.slice(dash.indexOf("Próximos movimentos"));
  ok("Próximos movimentos: com a recorrência ligada, a folha do RH não aparece duas vezes",
    !/RH · folha/.test(proximos) && /RH ·/.test(proximos), proximos.slice(0, 200).replace(/\n+/g, " | "));

  ok("Sem erros de página na recorrência do RH", erros.length === 0, erros.join(" | "));
  await ctx.close();
}

// ── P) Venda avulsa parcelada vira cobrança e entrada prevista ───────────
{
  const { ctx, page, erros } = await abrir("diretoria@zaytanhub.demo");
  await ir(page, "/financeiro/receitas?aba=vendas", 2200);

  const antes = (await db(page)).cobrancas.length;
  await clicarTexto(page, "button", /Nova venda/);
  await espera(1100);

  // Cliente do cadastro (obrigatório), descrição e valor.
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const gatilho = [...d.querySelectorAll('[role="combobox"]')]
      .find((g) => /Escolha o cliente|cliente/i.test(g.textContent || ""));
    gatilho?.click();
  });
  await espera(600);
  const escolheuCliente = await page.evaluate(() => {
    const o = document.querySelector('[role="option"]');
    if (!o) return "";
    const nome = o.textContent.trim();
    o.click();
    return nome;
  });
  await espera(500);

  await digitar(page, '[role="dialog"] input[placeholder^="Ex.: Desenvolvimento"]', "Projeto de teste");
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const nums = [...d.querySelectorAll('input[type="number"]')];
    set.call(nums[0], "9000");
    nums[0].dispatchEvent(new Event("input", { bubbles: true }));
  });
  await espera(500);

  await clicarTexto(page, '[role="dialog"] button', /Parcelas iguais/);
  await espera(500);
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const qtd = [...d.querySelectorAll('input[type="number"]')].find((i) => i.className.includes("w-24"));
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(qtd, "3");
    qtd.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await espera(800);

  const previa = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? "");
  ok("Venda: o parcelamento mostra a soma antes de salvar",
    !!escolheuCliente && /Soma das parcelas/.test(previa) && /1\/3/.test(previa));

  await clicarTexto(page, '[role="dialog"] button', /Registrar venda/);
  await espera(3000);

  const depois = await db(page);
  const geradas = depois.cobrancas.filter((c) => /Projeto de teste/.test(c.descricao ?? ""));
  ok("Venda: gera as cobranças ligadas ao cliente e à venda",
    depois.cobrancas.length === antes + 3 && geradas.length === 3
      && geradas.every((c) => c.venda_id && c.cliente_id && c.parcelas_total === 3),
    `${antes} → ${depois.cobrancas.length}`);
  ok("Venda: as parcelas somam o valor da venda",
    Math.abs(geradas.reduce((s, c) => s + Number(c.valor), 0) - 9000) < 0.01,
    geradas.map((c) => c.valor).join(" + "));

  // A cobrança aparece na lista de contas a receber.
  await ir(page, "/financeiro/receitas?aba=cobrancas", 2000);
  const tela = await page.evaluate(() => document.body.innerText);
  ok("Cobranças: a parcela da venda aparece com cliente, origem e parcela",
    /Projeto de teste/.test(tela) && /Venda · 1\/3|Venda · 2\/3|Venda · 3\/3/.test(tela));

  // E entra na previsão do Caixa como entrada a receber.
  await ir(page, "/?aba=projecao", 2600);
  const proj = await page.evaluate(() => document.body.innerText);
  ok("Previsão do Caixa: a cobrança da venda entra como entrada a receber",
    /Vai entrar/.test(proj) && /Projeto de teste|Cobrança de cliente/.test(proj));

  ok("Sem erros de página no fluxo de venda parcelada", erros.length === 0, erros.join(" | "));
  await ctx.close();
}

// ── Q) Caixa › Cartões: demonstrativo da fatura ──────────────────────────
{
  const { ctx, page, erros } = await abrir("diretoria@zaytanhub.demo");
  // O endereço antigo (Pagamentos › Cartões) leva para o Caixa.
  await ir(page, "/financeiro/pagamentos?aba=cartoes", 2200);
  ok("Cartões: o link antigo de Pagamentos abre em Caixa › Cartões",
    /\/financeiro\/caixa/.test(page.url()) && /aba=cartoes/.test(page.url()), page.url());
  await clicarTexto(page, 'button[role="tab"]', /Cart(ã|a)o PJ/);
  await espera(800);
  const tela = await page.evaluate(() => document.body.innerText);
  ok("Cartões: demonstrativo com as compras importadas e os gastos por categoria",
    /ANTHROPIC CLAUDE/.test(tela) && /Gastos por categoria/.test(tela) && /Compras da fatura/.test(tela), "");
  ok("Cartões: valor positivo aparece como pagamento da fatura, fora das categorias",
    /Pagamento da fatura/.test(tela) && /Pagamentos da fatura/.test(tela) && !/Assinaturas e parcelas previstas/.test(tela));
  ok("Sem erros de página nos cartões", erros.length === 0, erros.join(" | "));
  await ctx.close();
}

// ── Q2) Importar extrato do cartão: o cartão é um destino ao lado dos bancos ─
{
  const { ctx, page, erros } = await abrir("diretoria@zaytanhub.demo");
  // Planilha de fatura no formato comum dos cartões: compra com valor POSITIVO.
  const fs = await import("node:fs");
  const os = await import("node:os");
  const pathMod = await import("node:path");
  const arq = pathMod.join(os.tmpdir(), `fatura-e2e-${Date.now()}.csv`);
  // Cabeçalho sem acento: o CSV é lido como Latin-1 (o padrão dos bancos no Windows).
  fs.writeFileSync(arq, "data;descricao;valor\n05/09/2026;NOTION LABS;96,00\n07/09/2026;AMAZON WEB SERVICES;412,30\n");

  await ir(page, "/financeiro/extratos?aba=importar", 1500);
  const antes = await db(page);
  const pendentesAntes = antes.movimentacoes.filter((m) => m.categoria_status === "pendente").length;
  const cartaoAntes = antes.cartao_lancamentos.length;

  const input = await page.$('input[type="file"]');
  await input.uploadFile(arq);
  await espera(2500);
  // Escolhe o cartão no seletor de destino (na prévia ou no passo de atribuir).
  await page.click('button[role="combobox"]');
  await espera(400);
  const opcoes = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent));
  await clicarTexto(page, '[role="option"]', /Cart(ã|a)o PJ/);
  await espera(1500);
  if (await clicarTexto(page, "button", /^Continuar$/)) await espera(1500);
  const telaPrevia = await page.evaluate(() => document.body.innerText);
  ok("Importar: o seletor de destino lista os cartões junto com as contas",
    opcoes.some((o) => /Cart(ã|a)o PJ/.test(o)) && opcoes.some((o) => /Conta|Inter|Ita|Bradesco|Nubank|C6/i.test(o)), opcoes.join(" | "));
  ok("Importar: planilha do cartão com valor positivo é lida como compra",
    /valores positivos lidos como compras/.test(telaPrevia) && /Importar 2 no cart(ã|a)o/.test(telaPrevia));

  await clicarTexto(page, "button", /Importar 2 no cart(ã|a)o/);
  await espera(2500);
  const depois = await db(page);
  const novas = depois.cartao_lancamentos.filter((l) => /NOTION LABS|AMAZON WEB SERVICES/.test(l.descricao));
  ok("Importar: as compras vão para o cartão, não para a revisão do banco",
    depois.cartao_lancamentos.length === cartaoAntes + 2 && novas.every((l) => l.tipo === "out")
      && depois.movimentacoes.filter((m) => m.categoria_status === "pendente").length === pendentesAntes,
    `${cartaoAntes}→${depois.cartao_lancamentos.length} · tipos ${novas.map((l) => l.tipo).join(",")}`);
  ok("Importar: depois de importar abre o demonstrativo do cartão", /aba=cartoes/.test(page.url()), page.url());
  ok("Sem erros de página na importação do cartão", erros.length === 0, erros.join(" | "));
  fs.unlinkSync(arq);
  await ctx.close();
}

// ── R) Mais de uma mensalidade por cliente, cada uma com o seu atraso ────
{
  const { ctx, page, erros } = await abrir("diretoria@zaytanhub.demo");
  await ir(page, "/financeiro/receitas?aba=clientes", 2500);
  const d0 = await db(page);
  const beta = d0.clientes.find((c) => /Beta Servi/.test(c.nome));
  const alfa = d0.clientes.find((c) => /Alfa Com/.test(c.nome));

  // O Beta já tem duas: a mensalidade em dia e o suporte com o mês passado em aberto.
  const cartaoBeta = await page.evaluate((id) => document.querySelector('[data-mensalidades="' + id + '"]')?.innerText ?? "", beta.id);
  ok("Clientes: o cartão lista as duas mensalidades do cliente",
    /Mensalidade/.test(cartaoBeta) && /Suporte técnico/.test(cartaoBeta), cartaoBeta.replace(/\s+/g, " ").slice(0, 160));
  ok("Clientes: cada mensalidade mostra o próprio atraso",
    /em dia/.test(cartaoBeta) && /\d+d de atraso/.test(cartaoBeta));
  ok("Clientes: a coluna do cliente é a soma das mensalidades ativas",
    Number(beta.mensalidade) === d0.cliente_mensalidades.filter((m) => m.cliente_id === beta.id && m.ativo)
      .reduce((s, m) => s + Number(m.valor), 0), String(beta.mensalidade));

  // Adicionar uma segunda mensalidade ao Alfa.
  const antesMens = d0.cliente_mensalidades.length;
  await page.evaluate((id) => {
    const b = [...document.querySelectorAll('[data-mensalidades="' + id + '"] button')].find((x) => /Adicionar/.test(x.textContent || ""));
    b?.click();
  }, alfa.id);
  await espera(800);
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const texto = d.querySelector('input[placeholder="Ex.: Suporte técnico"]');
    set.call(texto, "Gestão de tráfego");
    texto.dispatchEvent(new Event("input", { bubbles: true }));
    const [valor, dia] = [...d.querySelectorAll('input[type="number"]')];
    set.call(valor, "2500");
    valor.dispatchEvent(new Event("input", { bubbles: true }));
    set.call(dia, "15");
    dia.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await espera(400);
  await clicarTexto(page, '[role="dialog"] button', /^Adicionar$/);
  await espera(2500);

  const d1 = await db(page);
  const nova = d1.cliente_mensalidades.find((m) => m.cliente_id === alfa.id && m.descricao === "Gestão de tráfego");
  const cobNova = d1.cobrancas.filter((c) => nova && c.mensalidade_id === nova.id);
  ok("Mensalidade nova: grava com valor e dia", d1.cliente_mensalidades.length === antesMens + 1 && nova
    && Number(nova.valor) === 2500 && Number(nova.dia_vencimento) === 15, nova ? JSON.stringify({ v: nova.valor, d: nova.dia_vencimento }) : "não gravou");
  ok("Mensalidade nova: gera as próprias cobranças a partir deste mês, sem atrasados para trás",
    cobNova.length === 2 && cobNova.every((c) => c.valor === 2500 && c.status === "aberto" && /-15$|-1[0-4]$/.test(c.vencimento)),
    cobNova.map((c) => c.competencia + "=" + c.vencimento).join(", "));
  const alfaDepois = d1.clientes.find((c) => c.id === alfa.id);
  ok("Mensalidade nova: o total do cliente passa a somar as duas",
    Number(alfaDepois.mensalidade) === Number(alfa.mensalidade) + 2500, String(alfaDepois.mensalidade));
  const cartaoAlfa = await page.evaluate((id) => document.querySelector('[data-mensalidades="' + id + '"]')?.innerText ?? "", alfa.id);
  ok("Mensalidade nova: aparece no cartão, com o total por mês", /Gestão de tráfego/.test(cartaoAlfa) && /Mensalidades ·/i.test(cartaoAlfa));

  // Encerrar: para de cobrar do mês que vem em diante e mantém a deste mês.
  await page.evaluate((id) => {
    const li = [...document.querySelectorAll('[data-mensalidades="' + id + '"] li')].find((x) => /Gestão de tráfego/.test(x.textContent || ""));
    li?.querySelector('button[title="Encerrar mensalidade"]')?.click();
  }, alfa.id);
  await espera(700);
  await clicarTexto(page, '[role="alertdialog"] button', /^Encerrar$/);
  await espera(2000);
  const d2 = await db(page);
  const enc = d2.cliente_mensalidades.find((m) => m.id === nova.id);
  const restantes = d2.cobrancas.filter((c) => c.mensalidade_id === nova.id);
  ok("Encerrar: a mensalidade fica inativa e só a cobrança deste mês continua",
    enc && enc.ativo === false && restantes.length === 1, restantes.map((c) => c.competencia).join(", "));
  ok("Encerrar: o total do cliente volta ao que era",
    Number(d2.clientes.find((c) => c.id === alfa.id).mensalidade) === Number(alfa.mensalidade));

  // Cobranças do cliente dizem a que mensalidade cada uma se refere.
  await page.evaluate((id) => {
    const card = document.querySelector('[data-mensalidades="' + id + '"]')?.parentElement;
    [...(card?.querySelectorAll("button") ?? [])].find((b) => /Ver cobranças/.test(b.textContent || ""))?.click();
  }, beta.id);
  await espera(800);
  const dlg = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? "");
  ok("Cobranças do cliente: coluna 'Referente a' separa as mensalidades", /Referente a/i.test(dlg) && /Suporte técnico/.test(dlg));

  ok("Sem erros de página nas mensalidades", erros.length === 0, erros.join(" | "));
  await ctx.close();
}

// Conectado (BROWSER_URL), fechar mataria o navegador de quem chamou.
if (process.env.BROWSER_URL) await browser.disconnect();
else await browser.close();
for (const r of resultados) console.log(`${r.ok ? "OK   " : "FALHA"} ${r.nome}${r.detalhe ? ` — ${r.detalhe}` : ""}`);
const falhas = resultados.filter((r) => !r.ok).length;
console.log(`\n${resultados.length - falhas}/${resultados.length} interações OK`);
process.exitCode = falhas ? 1 : 0;
