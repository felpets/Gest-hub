// ─── Dados FICTÍCIOS do Financeiro (protótipo) ─────────────────────────────
// Gera ~6 meses de histórico relativos à data de hoje, com as mesmas colunas
// das tabelas reais. Gerador determinístico (mesma semente = mesmos dados),
// para a demonstração ser reproduzível.
import type { Row, Tables } from "./db";
import { uuid } from "./db";
import { E1, E2, E3, EMPRESAS_DEMO, USUARIOS_DEMO, SENHA_DEMO } from "./demo";
import { chaveEstabelecimento, feriadosNacionais, normalizaDescricao } from "./rpc";
import { diaUtilAnterior, nthDiaUtil } from "@/lib/datas";

// ─── Utilitários ───────────────────────────────────────────────────────────
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pad2 = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const r2 = (v: number) => Math.round(v * 100) / 100;
const ts = (dataISO: string, h = 10) => new Date(`${dataISO}T${pad2(h)}:00:00`).toISOString();

function feriadosSet(): Set<string> {
  const y = new Date().getFullYear();
  return new Set([...feriadosNacionais(y - 1), ...feriadosNacionais(y), ...feriadosNacionais(y + 1), ...feriadosNacionais(y + 2)]);
}

// ─── Plano de contas ───────────────────────────────────────────────────────
type NoPlano = { codigo: string; nome: string; tipo: "receita" | "despesa"; oculto?: boolean; comp?: string; filhos?: [string, string][] };
const PLANO: NoPlano[] = [
  { codigo: "1", nome: "Receitas", tipo: "receita", filhos: [["1.1", "Mensalidades"], ["1.2", "Serviços Avulsos"], ["1.3", "Rendimentos"]] },
  { codigo: "2", nome: "Folha De Pagamento", tipo: "despesa", filhos: [["2.1", "Salários"], ["2.2", "Vale Transporte"], ["2.3", "Vale Refeição"], ["2.4", "Encargos"], ["2.5", "Rescisões"]] },
  { codigo: "3", nome: "Ocupação", tipo: "despesa", filhos: [["3.1", "Aluguel"], ["3.2", "Energia"], ["3.3", "Internet E Telefonia"]] },
  { codigo: "4", nome: "Administrativo", tipo: "despesa", filhos: [["4.1", "Contabilidade"], ["4.2", "Softwares"], ["4.3", "Material De Escritório"], ["4.4", "Acordos E Processos"]] },
  { codigo: "5", nome: "Impostos", tipo: "despesa", comp: "anterior", filhos: [["5.1", "Simples Nacional"]] },
  { codigo: "6", nome: "Marketing", tipo: "despesa", filhos: [["6.1", "Anúncios"]] },
  { codigo: "7", nome: "Financeiro", tipo: "despesa", filhos: [["7.1", "Tarifas Bancárias"]] },
  { codigo: "8", nome: "Transferências", tipo: "despesa", oculto: true, filhos: [["8.1", "Entre Contas"]] },
];

function gerarPlano(empresaId: string) {
  const rows: Row[] = [];
  const porCaminho = new Map<string, string>();
  for (const no of PLANO) {
    const pid = uuid();
    rows.push({
      id: pid, empresa_id: empresaId, nome: no.nome, tipo: no.tipo, codigo: no.codigo, parent_id: null,
      criado_em: new Date().toISOString(), oculto_relatorios: !!no.oculto,
      competencia_modo: no.comp ?? "pagamento", competencia_dia_corte: null,
    });
    porCaminho.set(no.nome, pid);
    for (const [codigo, nome] of no.filhos ?? []) {
      const id = uuid();
      rows.push({
        id, empresa_id: empresaId, nome, tipo: no.tipo, codigo, parent_id: pid,
        criado_em: new Date().toISOString(), oculto_relatorios: !!no.oculto,
        competencia_modo: no.comp ?? "pagamento", competencia_dia_corte: null,
      });
      porCaminho.set(`${no.nome} / ${nome}`, id);
    }
  }
  return { rows, porCaminho };
}

// ─── Clientes fictícios ────────────────────────────────────────────────────
type ClienteSemente = {
  nome: string; mens: number; dia: number; chave: string; inadimplente?: boolean;
  extra?: { descricao: string; valor: number; dia: number; mesesAtras: number; emAberto: number };
};
const CLIENTES: ClienteSemente[] = [
  { nome: "Alfa Comércio Ltda", mens: 8900, dia: 5, chave: "ALFA COMERCIO" },
  // Dois clientes com uma 2ª mensalidade (migração 52): a do Beta tem o mês
  // passado em aberto, para a tela mostrar o atraso de cada mensalidade.
  { nome: "Beta Serviços Eireli", mens: 6400, dia: 10, chave: "BETA SERVICOS",
    extra: { descricao: "Suporte técnico", valor: 1200, dia: 20, mesesAtras: 3, emAberto: 1 } },
  { nome: "Gama Indústria S/A", mens: 12500, dia: 5, chave: "GAMA INDUSTRIA" },
  { nome: "Delta Logística", mens: 7200, dia: 15, chave: "DELTA LOGISTICA",
    extra: { descricao: "Hospedagem do site", valor: 350, dia: 10, mesesAtras: 5, emAberto: 0 } },
  { nome: "Épsilon Clínica", mens: 5300, dia: 10, chave: "EPSILON CLINICA" },
  { nome: "Zeta Educação", mens: 9800, dia: 20, chave: "ZETA EDUCACAO" },
  { nome: "Ômega Construtora", mens: 14200, dia: 5, chave: "OMEGA CONSTRUTORA", inadimplente: true },
  { nome: "Sigma Tecnologia", mens: 4600, dia: 25, chave: "SIGMA TECNOLOGIA" },
];

// Despesas mensais: [descrição, caminho, valor base, variação, dia | "util:N"].
const DESPESAS: [string, string, number, number, number | string][] = [
  ["PAGTO ALUGUEL IMOBILIARIA HORIZONTE", "Ocupação / Aluguel", 6500, 0, 5],
  ["DEBITO CONTA ENERGIA LUZ DEMO", "Ocupação / Energia", 920, 0.18, 12],
  ["PAG*FIBRANET INTERNET EMPRESARIAL", "Ocupação / Internet E Telefonia", 299.9, 0, 15],
  ["PIX ENVIADO CONTABIL NORTE ASSESSORIA", "Administrativo / Contabilidade", 1850, 0, 10],
  ["CARTAO NUVEMSOFT ASSINATURA", "Administrativo / Softwares", 489, 0.05, 20],
  ["SISPAG SALARIOS FOLHA", "Folha De Pagamento / Salários", 41200, 0.03, "util:5"],
  ["PAGTO VALETRANS RECARGA VT", "Folha De Pagamento / Vale Transporte", 3280, 0.06, "util:1"],
  ["PAGTO REFEICARD CREDITO VR", "Folha De Pagamento / Vale Refeição", 4150, 0.04, "util:1"],
  ["DARF GPS INSS FGTS ENCARGOS", "Folha De Pagamento / Encargos", 9600, 0.05, 20],
  ["DAS SIMPLES NACIONAL", "Impostos / Simples Nacional", 6300, 0.08, 20],
  ["COMPRA ANUNCIOSPRO MIDIA DIGITAL", "Marketing / Anúncios", 2400, 0.25, 8],
  ["TARIFA PACOTE SERVICOS", "Financeiro / Tarifas Bancárias", 64.9, 0, 3],
  ["COMPRA PAPELARIA CENTRAL", "Administrativo / Material De Escritório", 310, 0.4, 18],
];

export function seedFinanceiro(): Tables {
  const rnd = prng(20260916);
  const hoje = new Date();
  const hojeISO = iso(hoje);
  const feriados = feriadosSet();
  const agora = new Date().toISOString();

  const t: Tables = {
    // As três empresas da demonstração usam o Financeiro e o RH (migração 44).
    empresas: EMPRESAS_DEMO.map((e, i) => ({
      id: e.id, nome: e.nome, modulos: ["financeiro", "rh"], criado_em: ts(iso(new Date(hoje.getFullYear() - 1, i, 1))),
    })),
    "auth.users": USUARIOS_DEMO.map((u, i) => ({
      id: u.id, email: u.email, senha: SENHA_DEMO, nome: u.nome,
      user_metadata: { nome: u.nome },
      app_metadata: {},
      created_at: ts(iso(new Date(hoje.getFullYear(), 0, 2 + i))), last_sign_in_at: null,
    })),
    perfis: USUARIOS_DEMO.map((u) => ({ user_id: u.id, is_master: u.papel === "master", criado_em: agora, nome: u.nome })),
    empresa_membros: USUARIOS_DEMO.flatMap((u) =>
      u.empresas.map((e) => ({ empresa_id: e, user_id: u.id, papel: u.papel === "master" ? "admin" : u.papel, criado_em: agora }))
    ),
    cargos: [
      { chave: "admin", nome: "Administrador", is_sistema: true, ordem: 1, criado_em: agora },
      { chave: "operador", nome: "Operador", is_sistema: true, ordem: 2, criado_em: agora },
      { chave: "visualizador", nome: "Visualizador", is_sistema: true, ordem: 3, criado_em: agora },
      { chave: "pagador", nome: "Pagamentos Diários", is_sistema: false, ordem: 4, criado_em: agora },
    ],
    cargo_capacidades: [
      ...["clientes_gerir", "config_gerir", "contas_gerir", "mov_gerir", "pag_diario_gerir", "plano_gerir", "vendas_gerir", "ver_dashboard", "ver_relatorios"]
        .map((c) => ({ cargo_chave: "admin", capacidade: c })),
      ...["clientes_gerir", "contas_gerir", "mov_gerir", "vendas_gerir", "ver_dashboard", "ver_relatorios"]
        .map((c) => ({ cargo_chave: "operador", capacidade: c })),
      ...["ver_dashboard", "ver_relatorios"].map((c) => ({ cargo_chave: "visualizador", capacidade: c })),
      { cargo_chave: "pagador", capacidade: "pag_diario_gerir" },
    ],
    // Quem entra no RH (migração 42): por usuário, sem precisar de cargo no Financeiro. O master entra sempre.
    rh_acessos: USUARIOS_DEMO.filter((u) => u.rh).map((u) => ({
      user_id: u.id, perfil: u.rh?.perfil ?? null, empresas: u.rh?.empresas ?? null, criado_em: agora, criado_por: null,
    })),
    plano_contas: [], contas_bancarias: [], movimentacoes: [], clientes: [], cliente_mensalidades: [], cobrancas: [], recorrentes: [],
    previstos: [], regras: [], regras_categorizacao: [], configuracoes: [], feriados: [], vendas: [],
    pagamentos_diarios: [], pagamentos_diarios_historico: [], pagamentos_processos: [],
    pagamentos_processos_parcelas: [], orcamentos: [], integracoes_inter: [], planejamento_meses: [], planejamento_itens: [],
    cartoes: [], cartao_lancamentos: [], gestao_acessos: [],
  };

  for (const e of EMPRESAS_DEMO) {
    t.configuracoes.push({ empresa_id: e.id, saldo_inicial: 0, saldo_inicial_data: hojeISO, funcionalidades: {}, atualizado_em: agora });
  }

  // ─── Empresa principal (E1): conjunto completo ───────────────────────────
  const { rows: plano1, porCaminho: cat1 } = gerarPlano(E1);
  t.plano_contas.push(...plano1);

  const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 6, 1);
  const inicioISO = iso(inicio);
  const contaPrincipal = uuid();
  const contaRecebimentos = uuid();
  t.contas_bancarias.push(
    {
      id: contaPrincipal, empresa_id: E1, nome: "Conta Principal", banco: "Banco Demo", bank_id: "0999",
      acct_id: "12345-6", acct_type: "CHECKING", saldo_inicial: 58000, saldo_inicial_data: iso(new Date(inicio.getTime() - 86400000)),
      ativo: true, ordem: 0, cor: "#FF4D1C", criado_em: ts(inicioISO), saldo_ajustado_em: null, saldo_ajustado_por: null, saldo_ajuste_motivo: null,
    },
    {
      id: contaRecebimentos, empresa_id: E1, nome: "Conta Recebimentos", banco: "Banco Exemplo", bank_id: "0888",
      acct_id: "98765-4", acct_type: "CHECKING", saldo_inicial: 12000, saldo_inicial_data: iso(new Date(inicio.getTime() - 86400000)),
      ativo: true, ordem: 1, cor: "#1F7A3A", criado_em: ts(inicioISO), saldo_ajustado_em: null, saldo_ajustado_por: null, saldo_ajuste_motivo: null,
    }
  );
  t.feriados.push({ id: uuid(), empresa_id: E1, data: `${hoje.getFullYear()}-08-15`, nome: "Feriado municipal (exemplo)", criado_em: agora });

  const mov = (m: Omit<Row, "id">): Row => ({
    id: uuid(), descricao_ia: null, confianca: 1, status: "Realizado", criado_em: ts(String(m.data)),
    fitid: `DEMO${Math.floor(rnd() * 1e10)}`, categoria_sugerida_id: m.categoria ? cat1.get(String(m.categoria)) ?? null : null,
    categoria_status: "confirmada", lote_id: null, ...m,
  });

  // Clientes + cobranças + entradas conciliáveis.
  const desde = iso(new Date(hoje.getFullYear(), hoje.getMonth() - 5, 1));
  const fimCobranca = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
  let clienteDaVenda = "";
  let nomeClienteDaVenda = "";
  CLIENTES.forEach((c, idx) => {
    const cid = uuid();
    if (idx === 0) { clienteDaVenda = cid; nomeClienteDaVenda = c.nome; }
    const mensalidades = [
      { descricao: "Mensalidade", valor: c.mens, dia: c.dia, inicio: desde, emAberto: -1 },
      ...(c.extra ? [{
        descricao: c.extra.descricao, valor: c.extra.valor, dia: c.extra.dia,
        inicio: iso(new Date(hoje.getFullYear(), hoje.getMonth() - c.extra.mesesAtras, 1)), emAberto: c.extra.emAberto,
      }] : []),
    ];
    t.clientes.push({
      id: cid, empresa_id: E1, nome: c.nome, status: "Pago",
      mensalidade: mensalidades.reduce((s, m) => s + m.valor, 0), ticket: c.mens, atraso: 0,
      criado_em: ts(desde), dia_vencimento: c.dia, cliente_desde: desde, chave_ofx: c.chave, ativo: true,
    });
    mensalidades.forEach((ms, k) => {
      const mid = uuid();
      t.cliente_mensalidades.push({
        id: mid, empresa_id: E1, cliente_id: cid, descricao: ms.descricao, valor: ms.valor,
        dia_vencimento: ms.dia, inicio: ms.inicio, ativo: true,
        criado_em: new Date(Date.parse(ts(desde)) + k * 1000).toISOString(), criado_por: null,
      });
      for (let d = new Date(ms.inicio + "T00:00:00"); d <= fimCobranca; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        const comp = iso(d);
        const venc = diaUtilAnterior(`${comp.slice(0, 8)}${pad2(ms.dia)}`, feriados);
        const cob: Row = {
          id: uuid(), empresa_id: E1, cliente_id: cid, mensalidade_id: mid, competencia: comp, vencimento: venc, valor: ms.valor,
          status: "aberto", pago_em: null, pago_valor: null, movimentacao_id: null, criado_em: ts(comp),
          venda_id: null, parcela: null, parcelas_total: null, forma_pagamento: "pix",
          descricao: ms.descricao, criado_por: null,
        };
        const mesesAtras = (hoje.getFullYear() - d.getFullYear()) * 12 + hoje.getMonth() - d.getMonth();
        const atrasado = k === 0
          ? c.inadimplente && mesesAtras <= 1
          : mesesAtras >= 1 && mesesAtras <= ms.emAberto;
        const pagou = venc <= hojeISO && !atrasado && !(k === 0 && idx === 3 && mesesAtras === 0);
        if (pagou) {
          const atraso = Math.floor(rnd() * 3);
          const dt = new Date(venc + "T00:00:00");
          dt.setDate(dt.getDate() + atraso);
          const dataPg = iso(dt) > hojeISO ? venc : iso(dt);
          const m = mov({
            empresa_id: E1, conta_id: idx % 3 === 0 ? contaRecebimentos : contaPrincipal, data: dataPg,
            descricao: `PIX RECEBIDO ${c.chave} LTDA`, categoria: "Receitas / Mensalidades", valor: ms.valor, tipo: "in",
          });
          t.movimentacoes.push(m);
          Object.assign(cob, { status: "pago", pago_em: dataPg, pago_valor: ms.valor, movimentacao_id: m.id });
        }
        t.cobrancas.push(cob);
      }
    });
  });

  // Despesas mensais, serviços avulsos, rendimentos e transferências.
  for (let d = new Date(inicio); d <= hoje; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const y = d.getFullYear(), mth = d.getMonth() + 1;
    for (const [desc, caminho, base, variacao, dia] of DESPESAS) {
      const data = typeof dia === "string"
        ? nthDiaUtil(y, mth, Number(dia.split(":")[1]), feriados)
        : diaUtilAnterior(`${y}-${pad2(mth)}-${pad2(dia)}`, feriados);
      if (data > hojeISO || data < inicioISO) continue;
      const valor = r2(base * (1 + (rnd() * 2 - 1) * variacao));
      t.movimentacoes.push(mov({ empresa_id: E1, conta_id: contaPrincipal, data, descricao: desc, categoria: caminho, valor, tipo: "out" }));
    }
    for (let k = 0; k < 3; k++) {
      const data = `${y}-${pad2(mth)}-${pad2(3 + Math.floor(rnd() * 24))}`;
      if (data > hojeISO) continue;
      t.movimentacoes.push(mov({
        empresa_id: E1, conta_id: contaRecebimentos, data,
        descricao: `TED RECEBIDA PROJETO ESPECIAL ${["NORTE", "SUL", "LESTE"][k]}`,
        categoria: "Receitas / Serviços Avulsos", valor: r2(2500 + rnd() * 6500), tipo: "in",
      }));
    }
    const fimMes = iso(new Date(y, mth, 0));
    if (fimMes <= hojeISO) {
      t.movimentacoes.push(mov({ empresa_id: E1, conta_id: contaPrincipal, data: fimMes, descricao: "RENDIMENTO APLICACAO AUTOMATICA", categoria: "Receitas / Rendimentos", valor: r2(180 + rnd() * 120), tipo: "in" }));
    }
    const dataTransf = diaUtilAnterior(`${y}-${pad2(mth)}-18`, feriados);
    if (dataTransf <= hojeISO) {
      const valor = 15000;
      t.movimentacoes.push(mov({ empresa_id: E1, conta_id: contaRecebimentos, data: dataTransf, descricao: "TRANSF ENTRE CONTAS MESMA TITULARIDADE", categoria: "Transferências / Entre Contas", valor, tipo: "out" }));
      t.movimentacoes.push(mov({ empresa_id: E1, conta_id: contaPrincipal, data: dataTransf, descricao: "TRANSF ENTRE CONTAS MESMA TITULARIDADE", categoria: "Transferências / Entre Contas", valor, tipo: "in" }));
    }
  }

  // Regras aprendidas a partir do histórico (mesma chave usada pelo banco real).
  const vistas = new Set<string>();
  for (const m of t.movimentacoes) {
    const chave = chaveEstabelecimento(m.descricao);
    const catId = cat1.get(String(m.categoria));
    if (!chave || chave.length < 4 || !catId || vistas.has(chave)) continue;
    vistas.add(chave);
    const n = t.movimentacoes.filter((x) => chaveEstabelecimento(x.descricao) === chave).length;
    t.regras_categorizacao.push({
      id: uuid(), empresa_id: E1, padrao: chave, tipo_match: "contem", categoria_id: catId,
      origem: "aprendida", acertos: n, ativo: true, criado_em: agora, atualizado_em: agora,
    });
  }

  // Lote importado aguardando revisão (pendentes, com e sem sugestão).
  const loteId = uuid();
  const PENDENTES: [string, number, "in" | "out"][] = [
    ["PAGTO ALUGUEL IMOBILIARIA HORIZONTE COMPLEMENTO", 450, "out"],
    ["CARTAO NUVEMSOFT USUARIO ADICIONAL", 89, "out"],
    ["COMPRA ANUNCIOSPRO IMPULSIONAMENTO", 680, "out"],
    ["PIX ENVIADO MOTOBOY EXPRESSO ENTREGAS", 145, "out"],
    ["COMPRA SUPERMERCADO COPA E COZINHA", 238.4, "out"],
    ["TED RECEBIDA PROJETO ESPECIAL OESTE", 4800, "in"],
    ["PIX RECEBIDO REEMBOLSO DESPESAS VIAGEM", 612.3, "in"],
    ["TARIFA TED AVULSA", 12.5, "out"],
    ["PAG*CHAVEIRO CENTRO", 95, "out"],
    ["DEBITO CONTA AGUA SANEAMENTO", 184.7, "out"],
  ];
  PENDENTES.forEach(([descricao, valor, tipo], i) => {
    const dt = new Date(hoje);
    dt.setDate(dt.getDate() - (i % 4));
    const norm = normalizaDescricao(descricao);
    const regra = t.regras_categorizacao.find((r) => norm.includes(String(r.padrao)));
    t.movimentacoes.push({
      id: uuid(), empresa_id: E1, conta_id: contaPrincipal, data: iso(dt), descricao, descricao_ia: null,
      categoria: null, confianca: 1, valor, tipo, status: "Realizado", criado_em: agora,
      fitid: `DEMOPEND${i}`, categoria_sugerida_id: regra?.categoria_id ?? null,
      categoria_status: "pendente", lote_id: loteId,
    });
  });

  // Recorrentes → previstos (mesma materialização da tela Contas a Pagar).
  type Rec = { descricao: string; categoria: string; valor: number; tipo: "in" | "out"; modo: "fixo" | "dia_util" | "quinzenal"; dia: number; dia2?: number; n?: number; meses?: number; boletos?: Row[] };
  const RECS: Rec[] = [
    { descricao: "Aluguel sede", categoria: "Ocupação / Aluguel", valor: 6500, tipo: "out", modo: "fixo", dia: 5, boletos: [{ tipo: "boleto", codigo: "23790.00000 00000.000000 00000.000000 1 00000000650000" }] },
    { descricao: "Internet empresarial", categoria: "Ocupação / Internet E Telefonia", valor: 299.9, tipo: "out", modo: "fixo", dia: 15 },
    { descricao: "Honorários contábeis", categoria: "Administrativo / Contabilidade", valor: 1850, tipo: "out", modo: "fixo", dia: 10, boletos: [{ tipo: "pix", codigo: "contabil.norte@exemplo.com" }] },
    { descricao: "Folha de pagamento", categoria: "Folha De Pagamento / Salários", valor: 41200, tipo: "out", modo: "dia_util", dia: 1, n: 5 },
    { descricao: "Vale-transporte", categoria: "Folha De Pagamento / Vale Transporte", valor: 3280, tipo: "out", modo: "dia_util", dia: 1, n: 1 },
    { descricao: "Vale-refeição", categoria: "Folha De Pagamento / Vale Refeição", valor: 4150, tipo: "out", modo: "dia_util", dia: 1, n: 1 },
    { descricao: "Encargos (INSS/FGTS)", categoria: "Folha De Pagamento / Encargos", valor: 9600, tipo: "out", modo: "fixo", dia: 20 },
    { descricao: "Simples Nacional", categoria: "Impostos / Simples Nacional", valor: 6300, tipo: "out", modo: "fixo", dia: 20 },
    { descricao: "Limpeza e conservação", categoria: "Ocupação / Aluguel", valor: 780, tipo: "out", modo: "quinzenal", dia: 1, dia2: 15 },
    { descricao: "Consórcio de equipamentos", categoria: "Administrativo / Softwares", valor: 1240, tipo: "out", modo: "fixo", dia: 25, meses: 12 },
    { descricao: "Sublocação de sala", categoria: "Receitas / Serviços Avulsos", valor: 1500, tipo: "in", modo: "fixo", dia: 8 },
  ];
  // Cartões: só para a tela de "Cartões e ferramentas" ter o que mostrar. A
  // fatura continua vindo pelo extrato; isto diz de que cartão cada item sai.
  const CARTAO_PJ = uuid();
  const CARTAO_MKT = uuid();
  t.cartoes.push(
    { id: CARTAO_PJ, empresa_id: E1, nome: "Cartão PJ", final: "4417", dia_fechamento: 28, dia_vencimento: 5, ativo: true, criado_em: agora, criado_por: null },
    { id: CARTAO_MKT, empresa_id: E1, nome: "Cartão Marketing", final: "8802", dia_fechamento: 20, dia_vencimento: 28, ativo: true, criado_em: agora, criado_por: null },
  );
  // Compras do extrato do cartão (migração 53): o demonstrativo em Caixa ›
  // Cartões. Não entram no saldo — a fatura paga é que sai da conta.
  const COMPRAS: [number, number, string, string | null, number, "in" | "out"][] = [
    // [meses atrás, dia, descrição, categoria, valor, tipo]
    [1, 3, "ANTHROPIC CLAUDE", "Administrativo / Softwares", 110, "out"],
    [1, 6, "META ADS", "Marketing / Anúncios", 1850, "out"],
    [1, 12, "KALUNGA", "Administrativo / Material De Escritório", 236.4, "out"],
    [1, 18, "GOOGLE WORKSPACE", "Administrativo / Softwares", 184, "out"],
    [1, 22, "UBER *TRIP", null, 48.9, "out"],
    [0, 2, "ANTHROPIC CLAUDE", "Administrativo / Softwares", 110, "out"],
    [0, 4, "META ADS", "Marketing / Anúncios", 2100, "out"],
    [0, 9, "PAGAMENTO DE FATURA", null, 2470.8, "in"],
    [0, 11, "GOOGLE WORKSPACE", "Administrativo / Softwares", 184, "out"],
    [0, 14, "IFOOD", null, 92.5, "out"],
  ];
  for (const [atras, dia, descricao, categoria, valor, tipo] of COMPRAS) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - atras, dia);
    if (d > hoje) continue;
    t.cartao_lancamentos.push({
      id: uuid(), empresa_id: E1, cartao_id: descricao === "META ADS" ? CARTAO_MKT : CARTAO_PJ, data: iso(d),
      descricao, valor, tipo, categoria, fitid: null, lote_id: null, criado_em: agora, criado_por: null,
    });
  }

  const cartaoDaRec = (descricao: string): string | null =>
    descricao === "Consórcio de equipamentos" ? CARTAO_PJ
    : descricao === "Internet empresarial" ? CARTAO_PJ
    : null;

  const mesAtual = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  for (const r of RECS) {
    const rid = uuid();
    const recInicio = new Date(hoje.getFullYear(), hoje.getMonth() - 3, 1);
    const fim = r.meses ? new Date(recInicio.getFullYear(), recInicio.getMonth() + r.meses - 1, 1) : null;
    t.recorrentes.push({
      id: rid, empresa_id: E1, descricao: r.descricao, categoria: r.categoria, valor: r.valor, tipo: r.tipo,
      dia: r.dia, inicio: iso(recInicio), fim: fim ? iso(fim) : null, criado_em: ts(iso(recInicio)),
      boletos: r.boletos ?? [], modo_dia: r.modo, dia_util_n: r.modo === "dia_util" ? r.n : null,
      dia2: r.modo === "quinzenal" ? r.dia2 : null, fonte_rh: null, cartao_id: cartaoDaRec(r.descricao),
    });
    const ultimo = fim ?? new Date(hoje.getFullYear(), hoje.getMonth() + 24, 1);
    // Mês anterior (para mostrar uma conta ATRASADA) + mês corrente em diante.
    for (let d = new Date(mesAtual.getFullYear(), mesAtual.getMonth() - 1, 1); d <= ultimo; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const y = d.getFullYear(), mth = d.getMonth() + 1;
      const datas = r.modo === "dia_util"
        ? [nthDiaUtil(y, mth, r.n ?? 1, feriados)]
        : r.modo === "quinzenal"
          ? [...new Set([diaUtilAnterior(`${y}-${pad2(mth)}-${pad2(r.dia)}`, feriados), diaUtilAnterior(`${y}-${pad2(mth)}-${pad2(r.dia2 ?? 28)}`, feriados)])]
          : [diaUtilAnterior(`${y}-${pad2(mth)}-${pad2(r.dia)}`, feriados)];
      for (const data of datas) {
        const mesPassado = d < mesAtual;
        // No mês anterior só fica a conta que ficou em aberto (vira "atrasada").
        if (mesPassado && r.descricao !== "Internet empresarial") continue;
        const pago = !mesPassado && data < hojeISO && r.tipo === "out";
        t.previstos.push({
          id: uuid(), empresa_id: E1, data, descricao: r.descricao, categoria: r.categoria, valor: r.valor, tipo: r.tipo,
          criado_em: agora, recorrente_id: rid, boletos: r.boletos ?? [], pago,
          pago_em: pago ? data : null, pago_valor: pago ? r.valor : null, cartao_id: cartaoDaRec(r.descricao),
        });
      }
    }
  }
  // Avulsos (sem recorrência), com código de pagamento.
  const avulso = (dias: number, descricao: string, categoria: string, valor: number, boletos: Row[] = []) => {
    const dt = new Date(hoje);
    dt.setDate(dt.getDate() + dias);
    t.previstos.push({
      id: uuid(), empresa_id: E1, data: iso(dt), descricao, categoria, valor, tipo: "out", criado_em: agora,
      recorrente_id: null, boletos, pago: false, pago_em: null, pago_valor: null,
    });
  };
  avulso(3, "Manutenção do ar-condicionado", "Ocupação / Aluguel", 1350, [{ tipo: "boleto", codigo: "34191.79001 01043.510047 91020.150008 5 00000000135000" }]);
  avulso(9, "Renovação certificado digital", "Administrativo / Softwares", 420, [{ tipo: "pix", codigo: "00020126580014BR.GOV.BCB.PIX0136demo-certificado" }]);
  avulso(17, "Evento de integração da equipe", "Marketing / Anúncios", 2800);

  // Vendas (controle à parte, não mexe no saldo).
  const VENDEDORES = ["Marina Costa", "Rafael Lima", "Juliana Rocha"];
  const FORMAS = ["pix", "credito", "boleto", "transferencia", "debito"];
  for (let i = 0; i < 46; i++) {
    const dt = new Date(hoje);
    dt.setDate(dt.getDate() - Math.floor(rnd() * 120));
    const bruto = r2(1500 + rnd() * 9000);
    const forma = FORMAS[Math.floor(rnd() * FORMAS.length)];
    t.vendas.push({
      id: uuid(), empresa_id: E1, data: iso(dt), cliente: `Cliente ${String.fromCharCode(65 + (i % 20))}${i}`,
      vendedor: VENDEDORES[i % 3], forma_pagamento: forma, valor_bruto: bruto,
      valor_liquido: r2(forma === "credito" ? bruto * 0.965 : forma === "boleto" ? bruto - 3.5 : bruto),
      observacao: i % 7 === 0 ? "Parcelado em 3x (exemplo)" : null, criado_em: ts(iso(dt)),
    });
  }

  // Uma venda avulsa PARCELADA, ligada ao cliente do cadastro: é ela que mostra
  // a corrente cliente → venda → cobrança → entrada prevista no caixa.
  {
    const vid = uuid();
    const dataVenda = new Date(hoje.getFullYear(), hoje.getMonth(), Math.min(hoje.getDate(), 5));
    t.vendas.push({
      id: vid, empresa_id: E1, data: iso(dataVenda), cliente_id: clienteDaVenda, cliente: nomeClienteDaVenda,
      descricao: "Desenvolvimento de site", vendedor: VENDEDORES[0], forma_pagamento: "boleto",
      valor_bruto: 6000, valor_liquido: 6000, observacao: null, criado_em: ts(iso(dataVenda)), criado_por: null,
    });
    for (let i = 0; i < 3; i++) {
      const venc = new Date(dataVenda.getFullYear(), dataVenda.getMonth() + i, 10);
      const vencISO = iso(venc);
      t.cobrancas.push({
        id: uuid(), empresa_id: E1, cliente_id: clienteDaVenda, venda_id: vid,
        competencia: `${vencISO.slice(0, 7)}-01`, vencimento: vencISO, valor: 2000,
        parcela: i + 1, parcelas_total: 3, forma_pagamento: "boleto",
        descricao: `Desenvolvimento de site · parcela ${i + 1}/3`,
        status: "aberto", pago_em: null, pago_valor: null, movimentacao_id: null,
        criado_por: null, criado_em: ts(iso(dataVenda)),
      });
    }
  }

  // Pagamentos diários (Pix) + histórico coerente com o gatilho.
  const diretoria = USUARIOS_DEMO[0];
  const PIX: [number, string, string, string, number, string, boolean][] = [
    [0, "Transportes Rápido ME", "12.345.678/0001-95", "cnpj", 380, "Frete de materiais", false],
    [0, "João Pereira da Silva", "joao.pereira@exemplo.com", "email", 250, "Diária de montagem", false],
    [0, "Oficina Boa Vista", "(11) 91234-5678", "telefone", 640, "Reparo do veículo", true],
    [0, "Maria Oliveira", "7f9c1b2e-3d4a-4b5c-8d6e-9f0a1b2c3d4e", "aleatoria", 180, "Reembolso de táxi", true],
    [-1, "Distribuidora Aurora", "98.765.432/0001-98", "cnpj", 1290, "Insumos de limpeza", true],
    [-1, "Pedro Henrique Santos", "pedro.santos@exemplo.com", "email", 320, "Serviço de elétrica", true],
    [-2, "Gráfica Expressa", "11.222.333/0001-81", "cnpj", 760, "Material impresso", true],
    [-8, "Carlos Eduardo Lima", "(21) 99876-5432", "telefone", 150, "Entrega urgente", true],
  ];
  const tipos: Record<string, string> = {};
  PIX.forEach(([dias, titular, chave, tipo, valor, descricao, pago], i) => {
    const dt = new Date(hoje);
    dt.setDate(dt.getDate() + dias);
    const data = iso(dt);
    const id = uuid();
    const chaveNorm = tipo === "cnpj" || tipo === "telefone" ? chave.replace(/\D/g, "") : chave.toLowerCase();
    tipos[id] = tipo;
    const criado = ts(data, 8 + i);
    const row: Row = {
      id, empresa_id: E1, data, titular, chave_pix: tipo === "telefone" ? `+55${chaveNorm}` : chaveNorm, tipo_chave: tipo, valor, descricao,
      pago, pago_em: pago ? ts(data, 11 + i) : null, pago_por: pago ? diretoria.id : null,
      estornado: false, estornado_em: null, estorno_motivo: null, criado_em: criado, criado_por: diretoria.id, atualizado_em: criado,
    };
    t.pagamentos_diarios.push(row);
    const base = { empresa_id: E1, pagamento_id: id, competencia: data.slice(0, 7), titular, chave_pix: row.chave_pix, valor, autor_id: diretoria.id, autor_email: diretoria.email };
    t.pagamentos_diarios_historico.push({ id: uuid(), ...base, acao: "criado", campos: [], dados_antes: null, dados_depois: { ...row, pago: false, pago_em: null }, ocorrido_em: criado });
    if (pago) {
      t.pagamentos_diarios_historico.push({ id: uuid(), ...base, acao: "pago", campos: ["pago", "pago_em", "pago_por"], dados_antes: { ...row, pago: false }, dados_depois: row, ocorrido_em: String(row.pago_em) });
    }
  });

  // Processos (acordos parcelados) + parcelas pagas.
  const PROCESSOS: [string, number, number, number, number, string][] = [
    ["Acordo trabalhista — Proc. 0001234-56.2025 (fictício)", 1800, 10, 4, 12, "acordo.exemplo@demo.com"],
    ["Parcelamento fornecedor — Contrato 88/2025 (fictício)", 2350, 15, 7, 10, "11.222.333/0001-81"],
    ["Acordo cível — Proc. 0009876-10.2024 (fictício)", 950, 25, 2, 6, "(11) 97777-6666"],
  ];
  PROCESSOS.forEach(([nome, valor, dia, atual, total, pix]) => {
    const pid = uuid();
    t.pagamentos_processos.push({
      id: pid, empresa_id: E1, nome, valor, dia_pagamento: dia, parcela_atual: atual, parcelas_total: total,
      chave_pix: pix, ativo: true, criado_em: ts(iso(new Date(hoje.getFullYear(), hoje.getMonth() - atual, dia))),
    });
    for (let n = 1; n < atual; n++) {
      const dt = new Date(hoje.getFullYear(), hoje.getMonth() - (atual - n), dia);
      t.pagamentos_processos_parcelas.push({
        id: uuid(), empresa_id: E1, processo_id: pid, numero: n, pago_em: iso(dt), valor,
        comprovante_path: n === atual - 1 ? `${E1}/processos/${pid}/${n}-demo-comprovante.pdf` : null,
        comprovante_nome: n === atual - 1 ? "comprovante-demo.pdf" : null, criado_em: ts(iso(dt)),
      });
      t.movimentacoes.push(mov({
        empresa_id: E1, conta_id: contaPrincipal, data: iso(dt), descricao: `PIX ENVIADO PARCELA ${n} ${nome.split(" — ")[0].toUpperCase()}`,
        categoria: "Administrativo / Acordos E Processos", valor, tipo: "out",
      }));
    }
  });

  // Metas de orçamento (dados preservados; a tela saiu do menu — ver docs).
  const metas: [string, number][] = [
    ["Marketing / Anúncios", 2500], ["Administrativo / Material De Escritório", 300], ["Ocupação / Energia", 950],
  ];
  for (const [caminho, valor] of metas) {
    t.orcamentos.push({ id: uuid(), empresa_id: E1, plano_conta_id: cat1.get(caminho), competencia: null, valor_meta: valor, criado_em: agora });
  }

  // ─── Segunda empresa (E2): operação menor ────────────────────────────────
  const { rows: plano2, porCaminho: cat2 } = gerarPlano(E2);
  t.plano_contas.push(...plano2);
  const contaE2 = uuid();
  const ini2 = new Date(hoje.getFullYear(), hoje.getMonth() - 3, 1);
  t.contas_bancarias.push({
    id: contaE2, empresa_id: E2, nome: "Conta Corrente", banco: "Banco Demo", bank_id: "0999", acct_id: "55555-0",
    acct_type: "CHECKING", saldo_inicial: 21000, saldo_inicial_data: iso(new Date(ini2.getTime() - 86400000)), ativo: true,
    ordem: 0, cor: null, criado_em: ts(iso(ini2)), saldo_ajustado_em: null, saldo_ajustado_por: null, saldo_ajuste_motivo: null,
  });
  for (let d = new Date(ini2); d <= hoje; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const y = d.getFullYear(), mth = d.getMonth() + 1;
    const itens: [number, string, string, number, "in" | "out"][] = [
      [6, "PIX RECEBIDO CONTRATO MENSAL KAPPA", "Receitas / Mensalidades", 18500, "in"],
      [12, "PIX RECEBIDO CONTRATO MENSAL LAMBDA", "Receitas / Mensalidades", 9700, "in"],
      [5, "PAGTO ALUGUEL SALA COMERCIAL", "Ocupação / Aluguel", 3900, "out"],
      [20, "DAS SIMPLES NACIONAL", "Impostos / Simples Nacional", 1650, "out"],
    ];
    for (const [dia, descricao, categoria, valor, tipo] of itens) {
      const data = diaUtilAnterior(`${y}-${pad2(mth)}-${pad2(dia)}`, feriados);
      if (data > hojeISO) continue;
      t.movimentacoes.push({
        id: uuid(), empresa_id: E2, conta_id: contaE2, data, descricao, descricao_ia: null, categoria, confianca: 1,
        valor, tipo, status: "Realizado", criado_em: ts(data), fitid: `DEMOE2${Math.floor(rnd() * 1e9)}`,
        categoria_sugerida_id: cat2.get(categoria) ?? null, categoria_status: "confirmada", lote_id: null,
      });
    }
    const salario = nthDiaUtil(y, mth, 5, feriados);
    if (salario <= hojeISO) {
      t.movimentacoes.push({
        id: uuid(), empresa_id: E2, conta_id: contaE2, data: salario, descricao: "SISPAG SALARIOS FOLHA", descricao_ia: null,
        categoria: "Folha De Pagamento / Salários", confianca: 1, valor: 14800, tipo: "out", status: "Realizado",
        criado_em: ts(salario), fitid: `DEMOE2S${mth}`, categoria_sugerida_id: cat2.get("Folha De Pagamento / Salários") ?? null,
        categoria_status: "confirmada", lote_id: null,
      });
    }
  }

  // ─── Terceira empresa (E3): recém-criada, só a estrutura ─────────────────
  const { rows: plano3 } = gerarPlano(E3);
  t.plano_contas.push(...plano3);
  t.contas_bancarias.push({
    id: uuid(), empresa_id: E3, nome: "Conta Operacional", banco: "Banco Exemplo", bank_id: null, acct_id: null,
    acct_type: null, saldo_inicial: 5000, saldo_inicial_data: hojeISO, ativo: true, ordem: 0, cor: null,
    criado_em: agora, saldo_ajustado_em: null, saldo_ajustado_por: null, saldo_ajuste_motivo: null,
  });

  return t;
}
