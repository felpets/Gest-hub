import { beforeEach, describe, expect, it } from "vitest";
import { createMockClient, mockApiUsuarios, restaurarDadosDemo } from "@/lib/mock";
import { E1, E2, SENHA_DEMO, USUARIOS_DEMO } from "@/lib/mock/demo";
import { empresaCorresponde } from "@/lib/mock/rpc";

const sb = createMockClient();
const rh = createMockClient("rh");

async function entrar(email: string) {
  await sb.auth.signOut();
  const { error } = await sb.auth.signInWithPassword({ email, password: SENHA_DEMO });
  expect(error).toBeNull();
}

beforeEach(async () => {
  restaurarDadosDemo();
  await entrar("diretoria@zaytanhub.demo");
});

describe("cliente simulado — leitura", () => {
  it("filtra, ordena e pagina como o PostgREST", async () => {
    const { data, error } = await sb
      .from("movimentacoes")
      .select("id, data, valor")
      .eq("empresa_id", E1)
      .eq("categoria_status", "confirmada")
      .order("data", { ascending: false })
      .order("id", { ascending: false })
      .range(0, 4);
    expect(error).toBeNull();
    const linhas = data as { data: string }[];
    expect(linhas).toHaveLength(5);
    expect(linhas[0].data >= linhas[4].data).toBe(true);
    expect(Object.keys(linhas[0]).sort()).toEqual(["data", "id", "valor"]);
  });

  it("conta com head:true sem devolver linhas", async () => {
    const r = await sb.from("movimentacoes").select("id", { count: "exact", head: true }).eq("empresa_id", E1).eq("categoria_status", "pendente");
    expect(r.data).toBeNull();
    expect(r.count).toBe(10);
  });

  it("maybeSingle devolve null e single acusa erro quando não há linha", async () => {
    const a = await sb.from("perfis").select("is_master").eq("user_id", "nao-existe").maybeSingle();
    expect(a.data).toBeNull();
    expect(a.error).toBeNull();
    const b = await sb.from("perfis").select("is_master").eq("user_id", "nao-existe").single();
    expect(b.error?.code).toBe("PGRST116");
  });
});

describe("cliente simulado — policies (RLS) por cargo", () => {
  it("operador não grava contas bancárias (config_gerir)", async () => {
    await entrar("operador@zaytanhub.demo");
    const r = await sb.from("contas_bancarias").insert({ empresa_id: E1, nome: "Teste" });
    expect(r.error?.code).toBe("42501");
  });

  it("cargo Pagamentos Diários só enxerga o Pix; os demais cargos sem a capacidade não veem nada", async () => {
    await entrar("pix@zaytanhub.demo");
    const pix = await sb.from("pagamentos_diarios").select("id").eq("empresa_id", E1);
    expect((pix.data as unknown[]).length).toBeGreaterThan(0);
    await entrar("leitura@zaytanhub.demo");
    const nada = await sb.from("pagamentos_diarios").select("id").eq("empresa_id", E1);
    expect(nada.data).toEqual([]);
  });

  it("quem não é membro da empresa não lê os dados dela", async () => {
    await entrar("operador@zaytanhub.demo");
    const r = await sb.from("movimentacoes").select("id").eq("empresa_id", E2);
    expect(r.data).toEqual([]);
  });
});

describe("regras do banco espelhadas", () => {
  it("Pix pago não pode ser excluído e o histórico registra a ação", async () => {
    const { data } = await sb.from("pagamentos_diarios").select("id, titular").eq("empresa_id", E1).eq("pago", true).limit(1);
    const alvo = (data as { id: string }[])[0];
    const del = await sb.from("pagamentos_diarios").delete().eq("id", alvo.id);
    expect(del.error?.message).toMatch(/não pode ser excluído/);
    const est = await sb.rpc("fn_estornar_pagamento_diario", { p_id: alvo.id, p_motivo: "teste" });
    expect(est.error).toBeNull();
    const hist = await sb.from("pagamentos_diarios_historico").select("acao").eq("pagamento_id", alvo.id);
    expect((hist.data as { acao: string }[]).map((h) => h.acao)).toContain("estornado");
  });

  it("aprovar um pendente confirma a categoria e aprende a regra", async () => {
    const { data: pend } = await sb.from("movimentacoes").select("id, descricao").eq("empresa_id", E1).eq("categoria_status", "pendente").limit(20);
    const chaveiro = (pend as { id: string; descricao: string }[]).find((p) => p.descricao.includes("CHAVEIRO"))!;
    const { data: cats } = await sb.from("plano_contas").select("id, nome").eq("empresa_id", E1);
    const cat = (cats as { id: string; nome: string }[]).find((c) => c.nome === "Material De Escritório")!;
    const n = await sb.rpc("fn_aprovar_lote", { p_aprovacoes: [{ id: chaveiro.id, categoria_id: cat.id }] });
    expect(n.data).toBe(1);
    const { data: mov } = await sb.from("movimentacoes").select("categoria, categoria_status").eq("id", chaveiro.id).single();
    expect(mov).toEqual({ categoria: "Administrativo / Material De Escritório", categoria_status: "confirmada" });
    const { data: regra } = await sb.from("regras_categorizacao").select("padrao, origem").eq("empresa_id", E1).eq("padrao", "CHAVEIRO");
    expect(regra).toEqual([{ padrao: "CHAVEIRO", origem: "aprendida" }]);
  });

  it("gera cobranças de forma idempotente", async () => {
    const primeira = await sb.rpc("fn_gerar_cobrancas", { p_empresa: E1 });
    expect(primeira.error).toBeNull();
    const segunda = await sb.rpc("fn_gerar_cobrancas", { p_empresa: E1 });
    expect(segunda.data).toBe(0);
  });

  it("excluir uma recorrência leva junto os previstos dela (cascade)", async () => {
    const { data: recs } = await sb.from("recorrentes").select("id").eq("empresa_id", E1).limit(1);
    const id = (recs as { id: string }[])[0].id;
    await sb.from("recorrentes").delete().eq("id", id);
    const { data } = await sb.from("previstos").select("id").eq("recorrente_id", id);
    expect(data).toEqual([]);
  });

  it("FITID repetido na mesma conta viola a unicidade (23505)", async () => {
    const { data } = await sb.from("movimentacoes").select("conta_id, fitid").eq("empresa_id", E1).limit(1);
    const m = (data as { conta_id: string; fitid: string }[])[0];
    const r = await sb.from("movimentacoes").insert({ empresa_id: E1, conta_id: m.conta_id, fitid: m.fitid, data: "2026-01-01", descricao: "x", valor: 1, tipo: "in" });
    expect(r.error?.code).toBe("23505");
  });

  it("feriados efetivos incluem os nacionais móveis (Páscoa)", async () => {
    const { data } = await sb.rpc("fn_feriados_efetivos", { p_empresa: E1, p_de: "2026-01-01", p_ate: "2026-12-31" });
    expect(data).toContain("2026-04-03"); // Sexta-feira Santa de 2026
    expect(data).toContain("2026-11-20");
  });
});

describe("namespace do RH", () => {
  it("lê as tabelas-documento do RH sem colidir com o Financeiro", async () => {
    const f = await rh.from("funcionarios").select("data");
    expect((f.data as unknown[]).length).toBeGreaterThan(20);
    const diariosRh = await rh.from("pagamentos_diarios").select("data");
    const diariosFin = await sb.from("pagamentos_diarios").select("id").eq("empresa_id", E1);
    expect((diariosRh.data as { data: { pessoa: string } }[])[0].data.pessoa).toBeTruthy();
    expect((diariosFin.data as unknown[]).length).toBeGreaterThan(0);
    const cfg = await rh.from("config").select("data").eq("id", 1).maybeSingle();
    expect((cfg.data as { data: { nomeEmpresa: string } }).data.nomeEmpresa).toBe("Grupo Zaytan");
  });

  it("extratos do RH fecham: proventos − descontos = líquido", async () => {
    const { data } = await rh.from("extratos_mensais").select("proventos, descontos, liquido");
    for (const e of data as { proventos: number; descontos: number; liquido: number }[]) {
      expect(Math.round((e.proventos - e.descontos) * 100)).toBe(Math.round(e.liquido * 100));
    }
  });
});

describe("acesso ao RH por pessoa (migração 42)", () => {
  const nomes = async (tabela: string) => ((await rh.from(tabela).select("empresa")).data ?? []) as { empresa: string }[];

  it("RH restrito à Laportec só lê registros da Laportec", async () => {
    const todos = await nomes("funcionarios");
    await entrar("rh@zaytanhub.demo");
    const meus = await nomes("funcionarios");
    expect(meus.length).toBeGreaterThan(0);
    expect(meus.length).toBeLessThan(todos.length);
    expect(new Set(meus.map((f) => f.empresa))).toEqual(new Set(["Laportec"]));
  });

  it("recrutamento lê candidatos e nada da folha", async () => {
    await entrar("recrutamento@zaytanhub.demo");
    expect((await nomes("candidatos")).length).toBeGreaterThan(0);
    expect(await nomes("funcionarios")).toEqual([]);
    expect(await nomes("pagamentos_diarios")).toEqual([]);
  });

  it("quem não foi liberado não lê nem grava no RH", async () => {
    await entrar("operador@zaytanhub.demo");
    expect(await nomes("funcionarios")).toEqual([]);
    const r = await rh.from("pagamentos_diarios").insert({ id: "x1", empresa: "Laportec", data: {} });
    expect(r.error?.code).toBe("42501");
  });

  it("só o master libera o RH para alguém", async () => {
    const operador = USUARIOS_DEMO.find((u) => u.email === "operador@zaytanhub.demo")!;
    await entrar("financeiro@zaytanhub.demo");
    const negado = await sb.from("rh_acessos").upsert({ user_id: operador.id, perfil: null, empresas: null }, { onConflict: "user_id" });
    expect(negado.error?.code).toBe("42501");
    await entrar("diretoria@zaytanhub.demo");
    const ok = await sb.from("rh_acessos").upsert({ user_id: operador.id, perfil: "rh", empresas: null }, { onConflict: "user_id" });
    expect(ok.error).toBeNull();
    await entrar("operador@zaytanhub.demo");
    expect((await nomes("funcionarios")).length).toBeGreaterThan(0);
  });
});

describe("Pix do dia × pagamentos diários do RH (migração 43)", () => {
  const hoje = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const periodo = () => ({ p_empresa: E1, p_de: `${hoje().slice(0, 8)}01`, p_ate: hoje() });

  it("quem cuida do Pix enxerga o que o RH lançou para a empresa, sem abrir o RH", async () => {
    await entrar("pix@zaytanhub.demo");
    const { data, error } = await sb.rpc("fn_rh_pagamentos_para_pix", { p_empresa: E1, p_de: "2000-01-01", p_ate: hoje() });
    expect(error).toBeNull();
    const itens = data as { empresa_rh: string; pessoa: string; valor: number; pago: boolean }[];
    expect(itens.length).toBeGreaterThan(0);
    expect(new Set(itens.map((i) => i.empresa_rh))).toEqual(new Set(["Laportec"]));
    expect(itens.some((i) => !i.pago)).toBe(true);
    expect((await rh.from("funcionarios").select("id")).data).toEqual([]);
  });

  it("o RH não enxerga o Pix do Financeiro", async () => {
    await entrar("rh@zaytanhub.demo");
    expect((await sb.from("pagamentos_diarios").select("id").eq("empresa_id", E1)).data).toEqual([]);
    const r = await sb.rpc("fn_rh_pagamentos_para_pix", periodo());
    expect(r.error?.code).toBe("42501");
  });

  it("o Financeiro enxerga os compromissos do RH, sem lançar nada duas vezes", async () => {
    await entrar("diretoria@zaytanhub.demo");
    const ate = `${hoje().slice(0, 8)}28`;
    const { data, error } = await sb.rpc("fn_rh_compromissos_financeiros", {
      p_empresa: E1, p_de: `${hoje().slice(0, 8)}01`, p_ate: ate,
    });
    expect(error).toBeNull();
    const itens = data as { id: string; origem: string; fonte: string; pessoa: string; valor: number; status: string; competencia: string; funcionario_id: string | null }[];
    expect(itens.length).toBeGreaterThan(0);
    // Só empresa certa, só saída de gente, valor sempre positivo.
    expect(itens.every((i) => i.valor > 0)).toBe(true);
    expect(new Set(itens.map((i) => i.origem)).size).toBeGreaterThan(0);
    // A projeção nunca concorre com um lançamento do RH da mesma pessoa/competência.
    const lancados = new Set(itens.filter((i) => i.fonte === "rh_pagamentos").map((i) => `${i.funcionario_id}|${i.competencia}|${i.origem}`));
    const projetados = itens.filter((i) => i.fonte === "projecao");
    for (const p of projetados) {
      expect(lancados.has(`${p.funcionario_id}|${p.competencia}|${p.origem}`)).toBe(false);
    }
    // Nenhum id repetido (o dashboard usa o id como chave de linha).
    expect(new Set(itens.map((i) => i.id)).size).toBe(itens.length);
  });

  it("quem não vê dinheiro da empresa também não vê a folha por pessoa", async () => {
    await entrar("rh@zaytanhub.demo");
    const r = await sb.rpc("fn_rh_compromissos_financeiros", periodo());
    expect(r.error?.code).toBe("42501");
  });

  it("o cargo de Pix recebe só os pagamentos diários — salário de terceiro não é assunto dele", async () => {
    await entrar("pix@zaytanhub.demo");
    const { data, error } = await sb.rpc("fn_rh_compromissos_financeiros", {
      p_empresa: E1, p_de: "2000-01-01", p_ate: `${hoje().slice(0, 8)}28`,
    });
    expect(error).toBeNull();
    const origens = new Set((data as { origem: string }[]).map((i) => i.origem));
    expect(origens.has("adiantamento")).toBe(false);
    expect(origens.has("salario")).toBe(false);
  });

  it("os totais mensais do RH somam folha, adiantamento, VT e VR", async () => {
    await entrar("diretoria@zaytanhub.demo");
    const mes = hoje().slice(0, 7);
    const { data, error } = await sb.rpc("fn_rh_totais_mensais", {
      p_empresa: E1, p_de: `${mes}-01`, p_ate: `${mes}-28`,
    });
    expect(error).toBeNull();
    const linhas = data as { competencia: string; salarios: number; adiantamento: number; vt: number; vr: number; pessoas: number }[];
    expect(linhas).toHaveLength(1);
    const t = linhas[0];
    expect(t.competencia).toBe(mes);
    expect(t.pessoas).toBeGreaterThan(0);
    expect(t.salarios).toBeGreaterThan(0);
    // O adiantamento é uma fração da folha, nunca maior que ela.
    expect(t.adiantamento).toBeGreaterThan(0);
    expect(t.adiantamento).toBeLessThan(t.salarios);
    expect(t.vt).toBeGreaterThanOrEqual(0);
    expect(t.vr).toBeGreaterThanOrEqual(0);
    // Líquido: o salário menos só o adiantamento pago — entre zero e o bruto.
    const liquido = (t as unknown as { folha_liquida: number }).folha_liquida;
    expect(liquido).toBeGreaterThanOrEqual(0);
    expect(liquido).toBeLessThanOrEqual(t.salarios);
  });

  it("os totais do RH não abrem para quem não vê o dinheiro da empresa", async () => {
    await entrar("pix@zaytanhub.demo");
    const mes = hoje().slice(0, 7);
    const r = await sb.rpc("fn_rh_totais_mensais", { p_empresa: E1, p_de: `${mes}-01`, p_ate: `${mes}-28` });
    expect(r.error?.code).toBe("42501");
  });

  it("casa a empresa do RH pelo nome", () => {
    expect(empresaCorresponde("Laportec", "laportec")).toBe(true);
    expect(empresaCorresponde("Laportec Assessoria", "Laportec")).toBe(true);
    expect(empresaCorresponde("Laportecx", "Laportec")).toBe(false);
    expect(empresaCorresponde("Laportec", "")).toBe(false);
    expect(empresaCorresponde("Avora", "Laportec")).toBe(false);
  });
});

describe("empresas por módulo e RH em várias empresas (migração 44)", () => {
  const nomesRH = async () => (((await sb.rpc("fn_empresas_rh")).data ?? []) as { nome: string }[]).map((e) => e.nome);

  it("o master cria uma empresa só do RH: entra no RH e não ganha estrutura do Financeiro", async () => {
    const { data: id, error } = await sb.rpc("criar_empresa", { p_nome: "Filial RH", p_modulos: ["rh"] });
    expect(error).toBeNull();
    expect(await nomesRH()).toContain("Filial RH");
    const empresa = (await sb.from("empresas").select("modulos").eq("id", id as string).single()).data as { modulos: string[] };
    expect(empresa.modulos).toEqual(["rh"]);
    expect((await sb.from("contas_bancarias").select("id").eq("empresa_id", id as string)).data).toEqual([]);
  });

  it("empresa só do Financeiro não aparece no RH e ganha a conta principal", async () => {
    const { data: id } = await sb.rpc("criar_empresa", { p_nome: "Filial Financeiro", p_modulos: ["financeiro"] });
    expect(await nomesRH()).not.toContain("Filial Financeiro");
    expect(((await sb.from("contas_bancarias").select("id").eq("empresa_id", id as string)).data as unknown[]).length).toBe(1);
  });

  it("não deixa nome repetido, módulo inválido nem quem não é master", async () => {
    expect((await sb.rpc("criar_empresa", { p_nome: "laportec", p_modulos: ["rh"] })).error?.message).toMatch(/Já existe/);
    expect((await sb.rpc("criar_empresa", { p_nome: "X", p_modulos: ["vendas"] })).error?.message).toMatch(/Financeiro, RH/);
    await entrar("financeiro@zaytanhub.demo");
    expect((await sb.rpc("criar_empresa", { p_nome: "Y", p_modulos: ["rh"] })).error?.message).toMatch(/master/);
  });

  it("liga o RH numa empresa, mas não desliga um módulo que já tem dados", async () => {
    const { data: id } = await sb.rpc("criar_empresa", { p_nome: "Nova", p_modulos: ["financeiro"] });
    expect((await sb.rpc("fn_definir_modulos_empresa", { p_empresa: id, p_modulos: ["financeiro", "rh"] })).error).toBeNull();
    expect(await nomesRH()).toContain("Nova");
    const semFin = await sb.rpc("fn_definir_modulos_empresa", { p_empresa: E1, p_modulos: ["rh"] });
    expect(semFin.error?.message).toMatch(/lançamentos no Financeiro/);
    const semRh = await sb.rpc("fn_definir_modulos_empresa", { p_empresa: E1, p_modulos: ["financeiro"] });
    expect(semRh.error?.message).toMatch(/cadastros no RH/);
  });

  it("acesso ao RH em duas empresas: lê as duas e mais nenhuma", async () => {
    const operador = USUARIOS_DEMO.find((u) => u.email === "operador@zaytanhub.demo")!;
    await sb.from("rh_acessos").upsert({ user_id: operador.id, perfil: "rh", empresas: ["Laportec", "Zaytan"] }, { onConflict: "user_id" });
    await entrar("operador@zaytanhub.demo");
    expect(await nomesRH()).toEqual(["Laportec", "Zaytan"]);
    const empresas = new Set((((await rh.from("funcionarios").select("empresa")).data ?? []) as { empresa: string }[]).map((f) => f.empresa));
    expect(empresas).toEqual(new Set(["Laportec", "Zaytan"]));
  });
});

describe("acessos por pessoa: administração e login sem empresa (migração 45)", () => {
  const operador = () => USUARIOS_DEMO.find((u) => u.email === "operador@zaytanhub.demo")!;
  const diretoria = () => USUARIOS_DEMO.find((u) => u.email === "diretoria@zaytanhub.demo")!;

  it("o administrador dá a administração a outra pessoa, mas não tira a própria", async () => {
    expect((await sb.rpc("fn_definir_master", { p_user: diretoria().id, p_master: false })).error?.message).toMatch(/própria/);
    expect((await sb.rpc("fn_definir_master", { p_user: operador().id, p_master: true })).error).toBeNull();
    await entrar("operador@zaytanhub.demo");
    expect((await sb.rpc("criar_empresa", { p_nome: "Criada pelo operador", p_modulos: ["rh"] })).error).toBeNull();
  });

  it("quem não é administrador não mexe na administração", async () => {
    await entrar("financeiro@zaytanhub.demo");
    const r = await sb.rpc("fn_definir_master", { p_user: operador().id, p_master: true });
    expect(r.error?.message).toMatch(/Apenas o administrador/);
  });

  it("só o administrador cria login sem empresa", async () => {
    const semEmpresa = { email: "so.rh@zaytanhub.demo", senha: "senha-forte-1", nome: "Só RH", empresaId: null, papel: null };
    expect((await mockApiUsuarios("POST", semEmpresa)).ok).toBe(true);
    await entrar("financeiro@zaytanhub.demo");
    const r = await mockApiUsuarios("POST", { ...semEmpresa, email: "outro@zaytanhub.demo" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empresa/);
  });
});

describe("excluir login mantendo o registro de alterações (migração 46)", () => {
  const operador = () => USUARIOS_DEMO.find((u) => u.email === "operador@zaytanhub.demo")!;
  const historico = async () =>
    (((await sb.from("usuarios_historico").select("user_id, email, acao, detalhes, autor_email").order("ocorrido_em")).data ?? []) as {
      user_id: string; email: string; acao: string; detalhes: Record<string, unknown>; autor_email: string;
    }[]);

  it("exclui o login, tira os acessos e guarda a foto do que a pessoa tinha", async () => {
    await sb.from("rh_acessos").upsert({ user_id: operador().id, perfil: "rh", empresas: ["Laportec"] }, { onConflict: "user_id" });
    const r = await mockApiUsuarios("DELETE", { userId: operador().id, motivo: "saiu da empresa" });
    expect(r.ok).toBe(true);

    const exclusao = (await historico()).find((h) => h.acao === "excluido")!;
    expect(exclusao.email).toBe("operador@zaytanhub.demo");
    expect(exclusao.autor_email).toBe("diretoria@zaytanhub.demo");
    expect(exclusao.detalhes.motivo).toBe("saiu da empresa");
    expect(exclusao.detalhes.financeiro).toEqual([{ empresaId: E1, empresa: "Laportec", cargo: "Operador" }]);
    expect(exclusao.detalhes.rh).toEqual({ perfil: "rh", empresas: ["Laportec"] });

    expect((await sb.from("empresa_membros").select("user_id").eq("user_id", operador().id)).data).toEqual([]);
    const lista = ((await sb.rpc("listar_usuarios_gerenciaveis")).data ?? []) as { user_id: string }[];
    expect(lista.some((u) => u.user_id === operador().id)).toBe(false);

    await sb.auth.signOut();
    const login = await sb.auth.signInWithPassword({ email: "operador@zaytanhub.demo", password: SENHA_DEMO });
    expect(login.error).not.toBeNull();
  });

  it("o e-mail de um login excluído pode ser usado de novo", async () => {
    await mockApiUsuarios("DELETE", { userId: operador().id });
    const novo = await mockApiUsuarios("POST", {
      email: "operador@zaytanhub.demo", senha: "senha-forte-1", nome: "Novo operador", empresaId: E1, papel: "operador",
    });
    expect(novo.ok).toBe(true);
  });

  it("só o master exclui, e ninguém exclui o próprio login", async () => {
    const diretoria = USUARIOS_DEMO.find((u) => u.email === "diretoria@zaytanhub.demo")!;
    expect((await mockApiUsuarios("DELETE", { userId: diretoria.id })).error).toMatch(/próprio/);
    await entrar("financeiro@zaytanhub.demo");
    expect((await mockApiUsuarios("DELETE", { userId: operador().id })).error).toMatch(/master/);
  });

  it("mudanças de acesso pela tela entram no registro, e ninguém edita nem apaga o registro", async () => {
    await sb.rpc("definir_papel_membro", { p_empresa: E1, p_user: operador().id, p_papel: "visualizador" });
    await sb.from("rh_acessos").upsert({ user_id: operador().id, perfil: null, empresas: null }, { onConflict: "user_id" });
    await sb.rpc("fn_definir_master", { p_user: operador().id, p_master: true });
    const acoes = (await historico()).filter((h) => h.user_id === operador().id).map((h) => h.acao);
    expect(acoes).toEqual(["acesso_financeiro", "acesso_rh", "administracao"]);
    const primeira = (await historico())[0];
    expect(primeira.detalhes).toMatchObject({ empresa: "Laportec", antes: "Operador", depois: "Visualizador" });

    await sb.from("usuarios_historico").update({ acao: "criado" }).eq("user_id", operador().id);
    await sb.from("usuarios_historico").delete().eq("user_id", operador().id);
    const depois = (await historico()).filter((h) => h.user_id === operador().id).map((h) => h.acao);
    expect(depois).toEqual(["acesso_financeiro", "acesso_rh", "administracao"]);
  });
});
