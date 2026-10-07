import { describe, it, expect } from "vitest";
import {
  CAPACIDADES, TODAS_CAPACIDADES, rotaCapacidade, rotaCapacidades, podeAcessar, primeiraRotaPermitida,
  podeGerirUsuarios, podeVerGestao,
} from "@/lib/permissoes";
import { ABAS, MENU, SECOES_CONFIG, abaRenomeada, destinoRH, modulosRH, secaoConfigAtiva, SECOES_RH } from "@/lib/navegacao";

// Cargo "Pagamentos Diários" da migração 39: uma capacidade e mais nenhuma.
const SO_PAGAMENTOS = new Set(["pag_diario_gerir"]);
const SO_RH = new Set(["rh_acessar"]);
const MASTER = new Set<string>(TODAS_CAPACIDADES);
const SEM_NADA = new Set<string>();

describe("catálogo de capacidades", () => {
  it("não tem chave repetida", () => {
    expect(new Set(TODAS_CAPACIDADES).size).toBe(TODAS_CAPACIDADES.length);
  });

  it("RH e Gestão não são capacidades de cargo: não aparecem no catálogo, só no conjunto derivado", () => {
    expect(CAPACIDADES.map((c) => c.chave)).not.toContain("rh_acessar");
    expect(CAPACIDADES.map((c) => c.chave)).not.toContain("gestao_acessar");
    expect(TODAS_CAPACIDADES).toContain("rh_acessar");
    expect(TODAS_CAPACIDADES).toContain("gestao_acessar");
    expect(TODAS_CAPACIDADES).toHaveLength(CAPACIDADES.length + 2);
  });

  it("toda rota protegida aponta só para capacidades do catálogo", () => {
    const rotas = ["/", "/financeiro/caixa", "/financeiro/extratos", "/financeiro/pagamentos", "/financeiro/receitas", "/financeiro/ajustes", "/rh"];
    for (const r of rotas) {
      const caps = rotaCapacidades(r);
      expect(caps, r).not.toBeNull();
      for (const c of caps!) expect(TODAS_CAPACIDADES, r).toContain(c);
    }
  });

  it("toda aba e todo item de menu pedem capacidades existentes", () => {
    for (const lista of Object.values(ABAS)) {
      for (const a of lista) for (const c of a.caps ?? []) expect(TODAS_CAPACIDADES, a.id).toContain(c);
    }
    for (const g of MENU) for (const i of g.itens) expect(i.url.startsWith("/"), i.url).toBe(true);
  });
});

describe("podeAcessar", () => {
  it("o cargo de pagamentos abre Pagamentos (onde fica o Pix) e mais nenhuma área", () => {
    expect(podeAcessar(SO_PAGAMENTOS, "/financeiro/pagamentos")).toBe(true);
    for (const r of ["/", "/financeiro/caixa", "/financeiro/receitas", "/financeiro/ajustes", "/rh"]) {
      expect(podeAcessar(SO_PAGAMENTOS, r), r).toBe(false);
    }
  });

  it("dentro de Pagamentos, o cargo de Pix só enxerga a aba do Pix", () => {
    const abas = ABAS.pagamentos.filter((a) => (a.caps ?? []).some((c) => SO_PAGAMENTOS.has(c))).map((a) => a.id);
    expect(abas).toEqual(["pix"]);
  });

  it("prefixo só casa em fronteira de segmento", () => {
    expect(rotaCapacidade("/rh/folha")).toBe("rh_acessar");
    expect(rotaCapacidades("/rhx")).toBeNull();
    expect(podeAcessar(new Set(["contas_gerir"]), "/rh/funcionarios")).toBe(false);
  });

  it("quem tem tudo abre tudo", () => {
    for (const r of ["/", "/financeiro/pagamentos", "/financeiro/receitas", "/financeiro/ajustes", "/rh/folha"]) {
      expect(podeAcessar(MASTER, r), r).toBe(true);
    }
  });

  it("o RH é fechado para quem não tem a capacidade do RH", () => {
    expect(podeAcessar(new Set(["ver_dashboard", "mov_gerir"]), "/rh")).toBe(false);
    expect(podeAcessar(SO_RH, "/rh/recrutamento")).toBe(true);
  });
});

describe("primeiraRotaPermitida", () => {
  it("manda o cargo enxuto para a área dele, não para o Dashboard", () => {
    expect(primeiraRotaPermitida(SO_PAGAMENTOS)).toBe("/financeiro/pagamentos");
    expect(primeiraRotaPermitida(new Set(["vendas_gerir"]))).toBe("/financeiro/receitas");
    expect(primeiraRotaPermitida(SO_RH)).toBe("/rh");
  });

  it("quem enxerga a Gestão entra por ela", () => {
    expect(primeiraRotaPermitida(MASTER)).toBe("/");
    expect(primeiraRotaPermitida(new Set(["gestao_acessar", "mov_gerir"]))).toBe("/");
  });

  it("Operador e Visualizador (sem a Gestão) entram pela área deles", () => {
    expect(primeiraRotaPermitida(new Set(["ver_dashboard", "ver_relatorios", "mov_gerir", "contas_gerir"]))).toBe("/financeiro/caixa");
    expect(primeiraRotaPermitida(new Set(["ver_dashboard", "ver_relatorios"]))).toBe("/financeiro/relatorios");
  });

  it("sem capacidade nenhuma cai em '/' (e lá a tela avisa)", () => {
    expect(primeiraRotaPermitida(SEM_NADA)).toBe("/");
  });
});

describe("podeGerirUsuarios", () => {
  it("só master e admin", () => {
    expect(podeGerirUsuarios(true, "visualizador")).toBe(true); // master ignora o cargo
    expect(podeGerirUsuarios(false, "admin")).toBe(true);
    expect(podeGerirUsuarios(false, "operador")).toBe(false);
    expect(podeGerirUsuarios(false, "visualizador")).toBe(false);
  });

  it("cargo personalizado não entra, nem com todas as capacidades", () => {
    // A aba Usuários fica fora do catálogo de capacidades justamente para
    // que trocar senha não vire um checkbox de cargo.
    expect(podeGerirUsuarios(false, "pagador")).toBe(false);
    expect(podeGerirUsuarios(false, "c_ab12cd34")).toBe(false);
  });

  it("nenhuma rota do catálogo aponta para a aba Usuários", () => {
    expect(rotaCapacidade("/gestao/usuarios")).toBeNull();
  });
});

describe("abas de Pagamentos", () => {
  it("o Pix do dia é a primeira aba — é a tarefa do dia", () => {
    expect(ABAS.pagamentos[0].id).toBe("pix");
  });

  it("as abas repetidas saíram: Visão geral e Recorrências viraram parte de outra tela", () => {
    expect(ABAS.pagamentos.map((a) => a.id)).toEqual(["pix", "contas", "dividas"]);
    expect(ABAS.caixa.map((a) => a.id)).toEqual(["movimentacoes", "fluxo", "analises", "cartoes"]);
  });

  it("links antigos continuam abrindo na aba certa", () => {
    expect(abaRenomeada("pagamentos", "visao")).toBe("pix");
    expect(abaRenomeada("pagamentos", "recorrencias")).toBe("contas");
    expect(abaRenomeada("pagamentos", "contas")).toBe("contas");
    expect(abaRenomeada("pagamentos", undefined)).toBeUndefined();
    expect(abaRenomeada("caixa", "fluxo")).toBe("fluxo");
  });

  it("Dívidas e acordos é a única aba opcional", () => {
    const opcionais = ABAS.pagamentos.filter((a) => a.funcionalidade);
    expect(opcionais.map((a) => a.id)).toEqual(["dividas"]);
    expect(opcionais[0].funcionalidade).toBe("dividas_acordos");
  });
});

describe("ordem do menu e área única de Configurações", () => {
  it("a Gestão é o primeiro pilar do menu", () => {
    expect(MENU.map((g) => g.pilar)).toEqual(["gestao", "financeiro", "rh"]);
  });

  it("a Gestão ficou só com o Dashboard — usuários e empresas foram para Configurações", () => {
    const gestao = MENU.find((g) => g.pilar === "gestao")!;
    expect(gestao.itens.map((i) => i.url)).toEqual(["/"]);
    expect(SECOES_CONFIG.map((s) => s.id)).toContain("usuarios");
    expect(SECOES_CONFIG.map((s) => s.id)).toContain("empresas");
  });

  it("nenhum item de configuração sobrou no menu lateral", () => {
    const urls = MENU.flatMap((g) => g.itens.map((i) => i.url));
    for (const fora of ["/financeiro/ajustes", "/financeiro/plano-de-contas", "/gestao/usuarios", "/gestao/empresas", "/rh/configuracoes"]) {
      expect(urls).not.toContain(fora);
    }
  });

  it("as seções de configuração não repetem id", () => {
    const ids = SECOES_CONFIG.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a página cai na primeira seção permitida quando a URL pede uma que não abre", () => {
    const permitidas = SECOES_CONFIG.filter((s) => s.id === "geral" || s.id === "plano");
    expect(secaoConfigAtiva(permitidas, "empresas")?.id).toBe("geral");
    expect(secaoConfigAtiva(permitidas, "plano")?.id).toBe("plano");
    expect(secaoConfigAtiva([], "geral")).toBeUndefined();
  });

  it("quem só mexe em configuração entra pela área de Configurações", () => {
    expect(primeiraRotaPermitida(new Set(["plano_gerir"]))).toBe("/configuracoes");
    expect(primeiraRotaPermitida(new Set(["config_gerir"]))).toBe("/configuracoes");
  });
});

describe("navegação do RH dentro do Zaytan Hub", () => {
  it("todo módulo/sub do RHApp tem uma rota", () => {
    const pares: [string, string][] = [
      ["dashboard", ""], ["funcionarios", "lista"], ["funcionarios", "documentos"], ["funcionarios", "treinamento"],
      ["funcionarios", "turmas"], ["recrutamento", "candidatos"], ["recrutamento", "agenda"], ["recrutamento", "talentos"],
      ["recrutamento", "roteiro"], ["atestados", ""], ["pagamentos", "demonstrativos"], ["pagamentos", "folha"],
      ["pagamentos", "diario"], ["pagamentos", "treinamento"], ["pagamentos", "beneficios"], ["pagamentos", "rescisoes"],
    ];
    for (const [m, s] of pares) {
      const d = destinoRH(m, s);
      const secao = d.to.replace(/^\/rh\/?/, "");
      const def = SECOES_RH[secao];
      expect(def, `${m}/${s}`).toBeTruthy();
      const aba = def.abas.find((a) => a.id === (d.search?.aba ?? def.abas[0].id))!;
      expect([aba.modulo, aba.sub], `${m}/${s}`).toEqual([m, s]);
    }
  });

  it("o treinamento, antes espalhado em duas áreas, vive numa seção só", () => {
    expect(destinoRH("funcionarios", "treinamento").to).toBe("/rh/treinamento");
    expect(destinoRH("pagamentos", "treinamento").to).toBe("/rh/treinamento");
  });

  it("as Configurações do RH abrem na área única de Configurações", () => {
    expect(destinoRH("config", "")).toEqual({ to: "/configuracoes", search: { secao: "rh" } });
  });

  it("ausências viraram aba de Funcionários — e o caminho do RHApp acompanha", () => {
    expect(SECOES_RH.atestados).toBeUndefined();
    expect(SECOES_RH.funcionarios.abas.map((a) => a.id)).toEqual(["lista", "documentos", "atestados"]);
    expect(destinoRH("atestados", "")).toEqual({ to: "/rh/funcionarios", search: { aba: "atestados" } });
    expect(MENU.find((g) => g.pilar === "rh")!.itens.map((i) => i.url)).toEqual([
      "/rh", "/rh/funcionarios", "/rh/treinamento", "/rh/recrutamento", "/rh/folha",
    ]);
  });

  it("indicadores e relatórios do RH abrem no Dashboard da Gestão", () => {
    expect(destinoRH("indicadores", "")).toEqual({ to: "/", search: { aba: "pessoas", visao: "indicadores" } });
    expect(destinoRH("relatorios", "")).toEqual({ to: "/", search: { aba: "pessoas", visao: "relatorios" } });
  });

  it("o atalho 'entrevistas' do painel (sub que não existia) cai na agenda", () => {
    expect(destinoRH("recrutamento", "entrevistas")).toEqual({ to: "/rh/recrutamento", search: { aba: "agenda" } });
  });

  it("perfis do RH: recrutamento vê pouco; perfil desconhecido falha fechado", () => {
    expect(modulosRH("")).toBeNull();
    expect(modulosRH("recrutamento")).toEqual(["dashboard", "recrutamento"]);
    expect(modulosRH("xyz")).toEqual(["dashboard"]);
    expect(modulosRH("rh")).not.toContain("config");
  });
});

describe("Gestão: Administrador ou liberado em Usuários", () => {
  it("master e Administrador veem; os outros cargos, só se liberados", () => {
    expect(podeVerGestao(true, "visualizador", false)).toBe(true);
    expect(podeVerGestao(false, "admin", false)).toBe(true);
    expect(podeVerGestao(false, "operador", false)).toBe(false);
    expect(podeVerGestao(false, "visualizador", false)).toBe(false);
    expect(podeVerGestao(false, "operador", true)).toBe(true);
  });

  it("a rota da Gestão pede gestao_acessar — ver_dashboard não basta", () => {
    expect(podeAcessar(new Set(["ver_dashboard", "ver_relatorios"]), "/")).toBe(false);
    expect(podeAcessar(new Set(["gestao_acessar"]), "/")).toBe(true);
    expect(ABAS.dashboard.find((a) => a.id === "visao")?.caps).toEqual(["gestao_acessar"]);
  });
});

describe("Projeção e Análises trocaram de lugar", () => {
  it("a Projeção de caixa é aba da Gestão, ao lado do Histórico", () => {
    expect(ABAS.dashboard.map((a) => a.id)).toEqual(["visao", "projecao", "pessoas"]);
    expect(ABAS.dashboard[0].titulo).toBe("Histórico");
  });

  it("as Análises financeiras são aba do Caixa", () => {
    expect(ABAS.caixa.find((a) => a.id === "analises")?.caps).toEqual(["ver_relatorios"]);
    expect(ABAS.dashboard.some((a) => a.id === "analises")).toBe(false);
    expect(ABAS.caixa.some((a) => a.id === "projecao")).toBe(false);
  });

  it("quem só vê relatórios consegue abrir o Caixa", () => {
    expect(podeAcessar(new Set(["ver_relatorios"]), "/financeiro/caixa")).toBe(true);
  });
});
