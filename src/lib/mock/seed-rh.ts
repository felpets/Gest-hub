// ─── Dados FICTÍCIOS do RH (protótipo) ─────────────────────────────────────
// Mesmo formato das tabelas do projeto "ZAYTAN CRM RH": tabelas-documento
// (id + colunas de busca + `data` jsonb) e as tabelas oficiais da folha
// (extratos_mensais + folha_eventos). Pessoas, CPFs e valores são inventados;
// os CPFs têm dígitos verificadores válidos só para passar nas validações.
import type { Row, Tables } from "./db";
import { uuid } from "./db";
import { feriadosNacionais } from "./rpc";

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
const rid = (rnd: () => number) => Date.now().toString(36).slice(-4) + Math.floor(rnd() * 36 ** 6).toString(36).padStart(6, "0");

function cpfFicticio(rnd: () => number): string {
  const d = Array.from({ length: 9 }, () => Math.floor(rnd() * 10));
  const dv = (arr: number[]) => {
    const s = arr.reduce((acc, n, i) => acc + n * (arr.length + 1 - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  d.push(dv(d));
  d.push(dv(d));
  return d.join("");
}

// INSS progressivo aproximado (tabela ilustrativa, só para o exemplo fechar a conta).
function inss(sal: number): number {
  const faixas: [number, number][] = [[1518, 0.075], [2793.88, 0.09], [4190.83, 0.12], [8157.41, 0.14]];
  let ant = 0, total = 0;
  for (const [teto, aliq] of faixas) {
    if (sal <= ant) break;
    total += (Math.min(sal, teto) - ant) * aliq;
    ant = teto;
  }
  return r2(total);
}

type Pessoa = {
  nome: string; empresa: string; cargo: string; depto: string; sal: number; contrato: string;
  mesesCasa: number; vt?: number; vr?: boolean; status?: string; desligadoHa?: number; treinoDiasAtras?: number;
  convenio?: number; adiant?: boolean;
};

const PESSOAS: Pessoa[] = [
  { nome: "Ana Beatriz Moura", empresa: "Laportec", cargo: "Gerente", depto: "Comercial", sal: 6200, contrato: "CLT Ativo", mesesCasa: 40, vt: 0, vr: true, convenio: 480 },
  { nome: "Carlos Eduardo Ramos", empresa: "Laportec", cargo: "Supervisor(a)", depto: "Comercial", sal: 4100, contrato: "CLT Ativo", mesesCasa: 26, vt: 2, vr: true },
  { nome: "Daniela Freitas", empresa: "Laportec", cargo: "Atendente de Negócio", depto: "Comercial", sal: 2050, contrato: "CLT Ativo", mesesCasa: 14, vt: 2, vr: true, adiant: true },
  { nome: "Eduardo Nogueira", empresa: "Laportec", cargo: "Atendente de Negócio", depto: "Comercial", sal: 2050, contrato: "CLT Ativo", mesesCasa: 9, vt: 4, vr: true, adiant: true },
  { nome: "Fernanda Lopes", empresa: "Laportec", cargo: "Atendente de Negócio", depto: "Comercial", sal: 2000, contrato: "CLT Ativo", mesesCasa: 7, vt: 2, vr: true, adiant: true, status: "Férias" },
  { nome: "Gabriel Teixeira", empresa: "Laportec", cargo: "Analista", depto: "Financeiro", sal: 3600, contrato: "CLT Ativo", mesesCasa: 31, vt: 2, vr: true },
  { nome: "Helena Castro", empresa: "Laportec", cargo: "Assistente", depto: "RH", sal: 2600, contrato: "CLT Ativo", mesesCasa: 18, vt: 2, vr: true, adiant: true },
  { nome: "Igor Batista", empresa: "Laportec", cargo: "Auxiliar", depto: "Operacional", sal: 1900, contrato: "CLT Ativo", mesesCasa: 5, vt: 4, vr: true, adiant: true, status: "Afastado" },
  { nome: "Juliana Prates", empresa: "Laportec", cargo: "Estagiário(a)", depto: "Jurídico", sal: 1400, contrato: "Estágio", mesesCasa: 6, vt: 2, vr: false },
  { nome: "Lucas Martins", empresa: "Laportec", cargo: "Recepcionista", depto: "Administrativo", sal: 1850, contrato: "CLT Ativo", mesesCasa: 12, vt: 2, vr: true, adiant: true },
  { nome: "Mariana Duarte", empresa: "Laportec", cargo: "Atendente de Negócio", depto: "Comercial", sal: 2000, contrato: "Treinamento", mesesCasa: 0, vt: 2, vr: true, treinoDiasAtras: 12 },
  { nome: "Henrique Batista", empresa: "Laportec", cargo: "Atendente de Negócio", depto: "Comercial", sal: 2000, contrato: "Treinamento", mesesCasa: 0, vt: 4, vr: true, treinoDiasAtras: 26 },
  { nome: "Olívia Santana", empresa: "Laportec", cargo: "Consultor", depto: "Comercial", sal: 3200, contrato: "PJ", mesesCasa: 11 },
  { nome: "Pedro Henrique Lima", empresa: "Laportec", cargo: "Atendente de Negócio", depto: "Comercial", sal: 2000, contrato: "CLT Ativo", mesesCasa: 8, vt: 2, vr: true, status: "Desligado", desligadoHa: 6 },
  { nome: "Rafaela Cunha", empresa: "Avora", cargo: "Coordenador", depto: "Marketing", sal: 5200, contrato: "CLT Ativo", mesesCasa: 22, vt: 0, vr: true, convenio: 420 },
  { nome: "Samuel Oliveira", empresa: "Avora", cargo: "Analista", depto: "TI", sal: 4300, contrato: "CLT Ativo", mesesCasa: 15, vt: 2, vr: true },
  { nome: "Tatiane Rocha", empresa: "Avora", cargo: "Assistente", depto: "Administrativo", sal: 2400, contrato: "CLT Ativo", mesesCasa: 4, vt: 2, vr: true, adiant: true },
  { nome: "Ulisses Pereira", empresa: "Avora", cargo: "Auxiliar", depto: "Operacional", sal: 1700, contrato: "Jovem Aprendiz", mesesCasa: 3, vt: 2, vr: false },
  { nome: "Vanessa Brito", empresa: "Avora", cargo: "Atendente de Negócio", depto: "Comercial", sal: 2000, contrato: "Treinamento", mesesCasa: 0, vt: 2, vr: true, treinoDiasAtras: 4 },
  { nome: "William Correia", empresa: "Avora", cargo: "Atendente de Negócio", depto: "Comercial", sal: 2000, contrato: "CLT Ativo", mesesCasa: 10, vt: 2, vr: true, status: "Desligado", desligadoHa: 40 },
  { nome: "Yasmin Albuquerque", empresa: "Zaytan", cargo: "Diretor", depto: "Diretoria", sal: 9800, contrato: "CLT Ativo", mesesCasa: 48, vt: 0, vr: true, convenio: 650 },
  { nome: "Bruno Siqueira", empresa: "Zaytan", cargo: "Analista", depto: "Financeiro", sal: 3900, contrato: "CLT Ativo", mesesCasa: 20, vt: 2, vr: true },
  { nome: "Camila Rezende", empresa: "Zaytan", cargo: "Estagiário(a)", depto: "Marketing", sal: 1300, contrato: "Estágio", mesesCasa: 2, vt: 2, vr: false },
  { nome: "Diego Fontes", empresa: "Zaytan", cargo: "Assistente", depto: "Administrativo", sal: 2300, contrato: "CLT Ativo", mesesCasa: 1, vt: 2, vr: true, adiant: true },
];

const CANDIDATOS: [string, string, string, string, number][] = [
  // nome, vaga, status (coluna do Kanban), origem, estrelas
  ["Alice Monteiro", "Atendente de Negócio", "Novos Candidatos", "Meta", 0],
  ["Breno Vasconcelos", "Atendente de Negócio", "Novos Candidatos", "WhatsApp Ads", 0],
  ["Cecília Barros", "Assistente Administrativo", "Novos Candidatos", "Site", 0],
  ["Davi Pacheco", "Atendente de Negócio", "Não respondeu", "Meta", 0],
  ["Elisa Guimarães", "Analista Financeiro", "Triagem", "LinkedIn", 3],
  ["Fábio Moreira", "Atendente de Negócio", "Triagem", "Indicação", 3],
  ["Giovana Tavares", "Estagiário Jurídico", "Entrevista Agendada", "Nube", 0],
  ["Hugo Carvalho", "Atendente de Negócio", "Entrevista Agendada", "Meta", 0],
  ["Isabela Ramalho", "Supervisor Comercial", "Entrevista Agendada", "LinkedIn", 0],
  ["João Victor Leal", "Atendente de Negócio", "Não compareceu", "WhatsApp Ads", 0],
  ["Karina Peixoto", "Analista de TI", "Entrevista Realizada", "LinkedIn", 4],
  ["Leonardo Azevedo", "Atendente de Negócio", "Entrevista Realizada", "Indicação", 3],
  ["Manuela Pires", "Assistente de RH", "Qualificados", "Site", 5],
  ["Natan Ribeiro", "Atendente de Negócio", "Qualificados", "Meta", 4],
  ["Otávio Mendonça", "Atendente de Negócio", "Não Qualificados", "WhatsApp Ads", 2],
  ["Priscila Arantes", "Atendente de Negócio", "Contratados", "Meta", 4],
  ["Quésia Lacerda", "Recepcionista", "Qualificados", "Indicação", 4],
  ["Renan Dias", "Estagiário Marketing", "Triagem", "Nube", 0],
];

export function seedRh(): Tables {
  const rnd = prng(8202609);
  const hoje = new Date();
  const hojeISO = iso(hoje);
  const agora = hoje.toISOString();
  const y = hoje.getFullYear();
  const feriados = [...feriadosNacionais(y - 1), ...feriadosNacionais(y)];
  const comp = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  const mesAnt = new Date(y, hoje.getMonth() - 1, 1);
  const mesAnt2 = new Date(y, hoje.getMonth() - 2, 1);

  const funcionarios: Row[] = [];
  const porNome = new Map<string, Row>();

  PESSOAS.forEach((p, i) => {
    const id = rid(rnd);
    const adm = new Date(y, hoje.getMonth() - p.mesesCasa, 3 + (i % 20));
    const treinoIni = p.treinoDiasAtras != null ? new Date(y, hoje.getMonth(), hoje.getDate() - p.treinoDiasAtras) : null;
    const admISO = iso(treinoIni ?? adm);
    const cpf = cpfFicticio(rnd);
    const primeiro = p.nome.split(" ")[0].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const vtAtivo = (p.vt ?? 0) > 0;
    const f: Row = {
      id, empresa: p.empresa, nome: p.nome, matricula: String(100 + i),
      cpf, rg: String(200000000 + Math.floor(rnd() * 99999999)), pis: String(12000000000 + Math.floor(rnd() * 999999999)),
      ctps: String(1000000 + i), cnh: "", cep: "01310100", telefone: `11${90000000 + Math.floor(rnd() * 9999999)}`,
      agencia: "0001", conta: String(10000 + i * 7),
      dataNascimento: iso(new Date(1985 + (i % 18), i % 12, 5 + (i % 20))), dataAdmissao: admISO,
      dataFimContrato: p.contrato === "Estágio" ? iso(new Date(y + 1, adm.getMonth(), adm.getDate())) : "",
      dataRegistro: p.contrato === "CLT Ativo" || p.contrato === "Jovem Aprendiz" ? admISO : "",
      salarioBase: p.sal, gestor: p.empresa === "Laportec" ? "Ana Beatriz Moura" : p.empresa === "Avora" ? "Rafaela Cunha" : "Yasmin Albuquerque",
      status: p.status ?? "Ativo", dependentes: i % 3, email: `${primeiro}.${i}@exemplo.com`,
      tipoContrato: p.contrato, treinamentoDias: 30,
      cargo: p.cargo, departamento: p.depto,
      banco: ["Banco Demo", "Banco Exemplo", "Banco Fictício"][i % 3], tipoConta: "Corrente",
      chavePix: cpf, tipoChavePix: "CPF", titular: p.nome,
      rua: "Rua das Flores (exemplo)", numero: String(10 + i), complemento: "", bairro: "Centro", cidade: "São Paulo", estado: "SP",
      pastasDoc: [],
      beneficios: {
        vt: {
          ativo: vtAtivo, modo: "passagens", valorDia: 0, frequencia: "mensal", ultimoPagamento: "", pagamentos: [] as Row[],
          conducoes: { onibus: { qtd: Math.min(p.vt ?? 0, 2), valor: 5 }, trolebus: { qtd: 0, valor: 0 }, metro: { qtd: Math.max((p.vt ?? 0) - 2, 0), valor: 5.2 }, trem: { qtd: 0, valor: 0 } },
        },
        vr: { ativo: !!p.vr, diasTrabalhados: "", frequencia: "mensal", ultimoPagamento: "", pagamentos: [] as Row[] },
        adiantamento: { ativo: p.contrato !== "PJ", tipo: "padrao", percentual: 40, valorManual: 0 },
      },
      beneficiosHistorico: [],
      experiencia: { prorrogado: false, efetivado: false, encerrado: false },
      convenio: p.convenio
        ? { ativo: true, nome: "Plano Saúde Exemplo", valorMensal: p.convenio, percentualFunc: 20, percentualEmpresa: 80 }
        : { ativo: false, nome: "", valorMensal: 0, percentualFunc: 0, percentualEmpresa: 100 },
      rescisao: null,
      repasse: {},
      complementos: [],
    };

    // VT/VR do mês corrente: parte já paga (mostra coberturas diferentes no controle).
    const ben = f.beneficios as { vt: Row; vr: Row };
    const iniMes = `${comp(hoje)}-01`;
    if (vtAtivo && i % 4 !== 1 && !treinoIni) {
      const valorDia = (p.vt ?? 0) >= 3 ? 20.4 : 10;
      ben.vt.pagamentos = [{ id: rid(rnd), numero: 1, status: "pago", data: iniMes, periodo_de: iniMes, periodo_ate: `${comp(hoje)}-15`, valor: r2(valorDia * 11), forma: "Pix", obs: "", por: "Helena Castro", criadoEm: agora, atualizadoEm: agora, em: agora, editLog: [] }];
      ben.vt.ultimoPagamento = iniMes;
    }
    if (p.vr && i % 3 !== 2 && !treinoIni) {
      const fim = i % 2 ? `${comp(hoje)}-15` : iso(new Date(y, hoje.getMonth() + 1, 0));
      ben.vr.pagamentos = [{ id: rid(rnd), numero: 1, status: "pago", data: iniMes, periodo_de: iniMes, periodo_ate: fim, valor: r2(27.2 * (i % 2 ? 11 : 22)), forma: "Cartão", obs: "", por: "Helena Castro", criadoEm: agora, atualizadoEm: agora, em: agora, editLog: [] }];
      ben.vr.ultimoPagamento = iniMes;
    }

    // Trainee: bloco de treinamento (etapa de admissão, antes do registro).
    if (treinoIni) {
      const fimT = new Date(treinoIni);
      fimT.setDate(fimT.getDate() + 30);
      f.treinamento = {
        data_inicio: iso(treinoIni), dias_treinamento: 30, data_fim: iso(fimT), dias_corridos: 30,
        vt_ativo: vtAtivo, vr_ativo: !!p.vr, outros_beneficios: 0, status: "Em andamento",
        responsavel: "Carlos Eduardo Ramos", observacoes: "Treinamento de admissão (exemplo).", prorrogacao: "",
        atualizado_em: hojeISO, historico: [{ id: rid(rnd), evento: "Início do treinamento", por: "Helena Castro", em: `${iso(treinoIni)} 09:00` }],
        pagamentos_salario: (p.treinoDiasAtras ?? 0) > 20
          ? [{ id: rid(rnd), data: iso(new Date(y, hoje.getMonth(), hoje.getDate() - 5)), periodo_de: iso(treinoIni), periodo_ate: iso(new Date(y, hoje.getMonth(), hoje.getDate() - 6)), dias_ref: 15, valor: 1000, por: "Ana Souza", em: agora }]
          : [],
        pagamentos_outros: [],
      };
    }

    // Desligados: rescisão (uma pendente, uma já quitada).
    if (p.status === "Desligado") {
      const deslig = new Date(y, hoje.getMonth(), hoje.getDate() - (p.desligadoHa ?? 10));
      const pagar = new Date(deslig);
      pagar.setDate(pagar.getDate() + 10);
      const bruto = r2(p.sal * 1.35);
      const inssR = inss(p.sal);
      const liquido = r2(bruto - inssR);
      const quitada = (p.desligadoHa ?? 0) > 20;
      f.rescisao = {
        dataDesligamento: iso(deslig), dataPagamento: iso(pagar), motivo: quitada ? "Pedido do colaborador (exemplo)" : "Fim do período de experiência (exemplo)",
        tipo: quitada ? "Pedido de demissão" : "Término de contrato", descontarDia: false,
        valorBruto: bruto, valorInss: inssR, valorFgts: r2(p.sal * 0.08), valorLiquido: liquido,
        destino: "Pix", observacoes: "", acerto: null,
        pagamentos: quitada ? [{ id: rid(rnd), numero: 1, status: "pago", data: iso(pagar), valor: liquido, forma: "Pix", obs: "", por: "Ana Souza", criadoEm: agora, atualizadoEm: agora, editLog: [] }] : [],
        pago: quitada,
      };
    }

    funcionarios.push(f);
    porNome.set(p.nome, f);
  });

  // ─── Extratos oficiais (2 competências) + adiantamentos + repasses ───────
  const extratos: Row[] = [];
  const eventos: Row[] = [];
  const importacoes: Row[] = [];
  const pagamentos: Row[] = [];
  const cnpjs: Record<string, string> = { Laportec: "12.345.678/0001-95", Avora: "23.456.789/0001-06", Zaytan: "34.567.890/0001-17" };

  for (const ref of [mesAnt2, mesAnt]) {
    const c = comp(ref);
    const importacaoId = uuid();
    const emissao = iso(new Date(ref.getFullYear(), ref.getMonth() + 1, 3));
    let qtd = 0;
    funcionarios.forEach((f, i) => {
      const adm = String(f.dataAdmissao);
      const desligada = f.rescisao && String((f.rescisao as Row).dataDesligamento) < `${c}-01`;
      if (f.tipoContrato === "Treinamento" || f.tipoContrato === "PJ" || f.tipoContrato === "Estágio" || adm > `${c}-28` || desligada) return;
      const sal = Number(f.salarioBase);
      const ben = f.beneficios as { vt: Row; adiantamento: Row };
      const conducoes = (ben.vt.conducoes ?? {}) as Record<string, { qtd: number; valor: number }>;
      const vtDia = Object.values(conducoes).reduce((s, x) => s + Number(x.qtd) * Number(x.valor), 0);
      const temVT = !!ben.vt.ativo;
      const vInss = inss(sal);
      const vAdi = ben.adiantamento.ativo ? r2(sal * 0.4) : 0;
      const vVT = temVT ? r2(Math.min(sal * 0.06, vtDia * 22)) : 0;
      const descontos = r2(vInss + vAdi + vVT);
      const liquido = r2(sal - descontos);
      const exId = uuid();
      qtd++;
      extratos.push({
        id: exId, competencia: c, empresa: f.empresa, cnpj: cnpjs[String(f.empresa)], filial: "", funcionario_id: f.id,
        nome: String(f.nome).toUpperCase(), cpf: f.cpf, cargo: String(f.cargo).toUpperCase(), cbo: "411010",
        departamento: f.departamento, centro_custo: "1", vinculo: f.tipoContrato === "Jovem Aprendiz" ? "Aprendiz" : "Celetista",
        situacao: f.status === "Afastado" ? "Afastado" : "Trabalhando", admissao: adm, horas_mensais: 220,
        salario_base: sal, proventos: sal, descontos, base_inss: sal, base_fgts: sal, valor_fgts: r2(sal * 0.08),
        base_irrf: r2(sal - vInss), liquido, pdf_url: null, importacao_id: importacaoId, data_importacao: `${emissao}T12:00:00.000Z`,
        criado_em: `${emissao}T12:00:00.000Z`, matricula: f.matricula, pagina: i + 1, layout: "extrato-mensal",
        arquivo: `extrato-mensal-${c}-demo.pdf`, arquivo_hash: `demo-${c}`, emissao, versao: 1,
      });
      const ev = (ordem: number, codigo: string, descricao: string, tipo: string, valor: number, ref = "") =>
        eventos.push({
          id: uuid(), extrato_id: exId, funcionario_id: f.id, competencia: c, codigo, descricao, tipo,
          quantidade: null, referencia: null, valor, origem: "extrato mensal", ordem, referencia_texto: ref, pagina: i + 1,
        });
      ev(1, "8781", "SALARIO", "provento", sal, "30,00");
      ev(2, "998", "I.N.S.S.", "desconto", vInss, "");
      if (vAdi) ev(3, "981", "DESC.ADIANT.SALARIAL", "desconto", vAdi, String(vAdi).replace(".", ","));
      if (vVT) ev(4, "48", "DESC. VALE TRANSPORTE", "desconto", vVT, "6,00");

      if (vAdi) {
        const dataVale = `${c}-20`;
        pagamentos.push({
          id: rid(rnd), funcionarioId: f.id, nome: f.nome, empresa: f.empresa, tipo: "Adiantamento", competencia: c,
          valor: vAdi, status: "Realizado", dataPrevista: dataVale, dataRealizada: dataVale, dataPagamento: dataVale,
          obs: "", ultimaMov: dataVale, confirmadoEm: `${dataVale} 10:00`, confirmadoPor: "Ana Souza",
        });
      }
      // Repasse do salário (pago no 5º dia útil do mês seguinte). No mês mais recente,
      // duas pessoas ficam pendentes para a tela mostrar os dois estados.
      const pendente = c === comp(mesAnt) && (i === 2 || i === 9);
      if (!pendente) {
        const dataPg = iso(new Date(ref.getFullYear(), ref.getMonth() + 1, 5));
        const rep = (f.repasse as Record<string, Row>);
        rep[c] = {
          pagamentos: [{
            id: rid(rnd), data: dataPg, valorCentavos: Math.round(liquido * 100), meio: "Pix", status: "confirmado",
            alocacoes: [{ alvo: "folha", valorCentavos: Math.round(liquido * 100) }], obs: "", competencia: c,
            criadoPor: "Ana Souza", criadoEm: `${dataPg} 09:00`, confirmadoPor: "Ana Souza", confirmadoEm: `${dataPg} 09:05`,
            canceladoPor: "", canceladoEm: "", motivoCancelamento: "", comprovante: null,
          }],
          ajustes: [], conferencia: null,
          historico: [{ em: `${dataPg} 09:05`, por: "Ana Souza", acao: "pagamento confirmado", detalhe: "Pix (exemplo)" }],
        };
      }
    });
    importacoes.push({
      id: importacaoId, competencia: c, arquivo: `extrato-mensal-${c}-demo.pdf`, pdf_url: null, qtd_funcionarios: qtd,
      qtd_avisos: 0, nao_encontrados: [], avisos: [], status: "Concluída", importado_por: "Helena Castro", criado_em: `${emissao}T12:00:00.000Z`,
    });
  }

  // Falta lançada no mês (gera linha financeira de desconto, como o sincronizarFalta faz).
  const lucas = porNome.get("Lucas Martins")!;
  const dataFalta = iso(new Date(y, hoje.getMonth(), Math.max(1, hoje.getDate() - 4)));
  const atestados: Row[] = [];
  const atFalta = rid(rnd);
  atestados.push({ id: atFalta, funcId: lucas.id, nome: lucas.nome, tipo: "Falta", dataInicio: dataFalta, dataFim: dataFalta, qtdDias: 1, motivo: "Falta sem justificativa (exemplo)", observacoes: "", cid: "", horaInicio: "", horaFim: "", horaSaida: "", horasAusentes: "", comAtestado: false, anexos: [], dataRegistro: dataFalta });
  pagamentos.push({
    id: rid(rnd), funcionarioId: lucas.id, nome: lucas.nome, empresa: lucas.empresa, tipo: "Desconto Falta", competencia: comp(hoje),
    valor: r2(Number(lucas.salarioBase) / 30), status: "Pendente", dataPrevista: "", dataRealizada: "", dataPagamento: "",
    obs: "", ultimaMov: dataFalta, origem: "falta", faltaId: atFalta, compFalta: comp(hoje), categoria: "Salário", descricao: "Falta 1 dia",
  });
  const at = (nome: string, tipo: string, diasAtras: number, dias: number, extra: Row = {}) => {
    const f = porNome.get(nome)!;
    const ini = new Date(y, hoje.getMonth(), Math.max(1, hoje.getDate() - diasAtras));
    const fim = new Date(ini);
    fim.setDate(fim.getDate() + dias - 1);
    atestados.push({
      id: rid(rnd), funcId: f.id, nome: f.nome, tipo, dataInicio: iso(ini), dataFim: iso(fim), qtdDias: dias, motivo: "", observacoes: "",
      cid: "", horaInicio: "", horaFim: "", horaSaida: "", horasAusentes: "", comAtestado: false, anexos: [], dataRegistro: iso(ini), ...extra,
    });
  };
  at("Daniela Freitas", "Atestado Médico", 9, 2, { cid: "J11", motivo: "Gripe (exemplo)", comAtestado: true });
  at("Gabriel Teixeira", "Declaração de Comparecimento", 6, 1, { horaInicio: "08:30", horaFim: "11:00", motivo: "Consulta (exemplo)" });
  at("Helena Castro", "Home Office", 2, 1, { motivo: "Combinado com a gestão" });
  at("Samuel Oliveira", "Saída Antecipada", 3, 1, { horaSaida: "16:00", motivo: "Compromisso pessoal (exemplo)" });
  at("Igor Batista", "Atestado Médico", 12, 15, { cid: "M54", motivo: "Afastamento (exemplo)", comAtestado: true });

  // ─── Recrutamento ────────────────────────────────────────────────────────
  const candidatos: Row[] = CANDIDATOS.map(([nome, vaga, status, origem, estrelas], i) => {
    const id = rid(rnd);
    const cad = new Date(y, hoje.getMonth(), hoje.getDate() - (30 - i));
    const hist: Row[] = [];
    const movs: Row[] = [{ id: rid(rnd), de: "", para: "Novos Candidatos", data: iso(cad), hora: "09:00", motivo: "Cadastro" }];
    if (["Entrevista Agendada", "Entrevista Realizada", "Não compareceu", "Qualificados", "Não Qualificados", "Contratados"].includes(status)) {
      // Uma entrevista agendada ficou no passado sem atualização → notificação de pendência.
      const delta = status === "Entrevista Agendada" ? (i === 7 ? -2 : i + 1) : -(i % 6) - 2;
      const dataEnt = new Date(y, hoje.getMonth(), hoje.getDate() + delta);
      hist.push({
        id: rid(rnd), data: iso(dataEnt), hora: `${pad2(9 + (i % 7))}:00`, tipo: i % 2 ? "Online" : "Presencial",
        empresa: i % 3 === 0 ? "Avora" : "Laportec", cargo: vaga, departamento: "Comercial", avaliador: "Helena Castro",
        local: i % 2 ? "Videochamada" : "Sede (exemplo)",
        status: status === "Entrevista Agendada" ? "Agendada" : status === "Não compareceu" ? "Não compareceu" : "Realizada",
        respostas: {}, observacoes: "", notaFinal: estrelas ? estrelas * 2 : "",
      });
      movs.push({ id: rid(rnd), de: "Triagem", para: "Entrevista Agendada", data: iso(new Date(dataEnt.getTime() - 3 * 86400000)), hora: "14:00", motivo: "" });
      if (status !== "Entrevista Agendada") movs.push({ id: rid(rnd), de: "Entrevista Agendada", para: status, data: iso(dataEnt), hora: "17:00", motivo: "" });
    }
    return {
      id, nome, vaga, area: /financeir/i.test(vaga) ? "Financeiro" : /jur/i.test(vaga) ? "Estágio" : /TI/.test(vaga) ? "Tecnologia da Informação" : /RH/.test(vaga) ? "Recursos Humanos" : /Recepcion/.test(vaga) ? "Atendimento" : /Marketing/.test(vaga) ? "Estágio" : /Administrativo/.test(vaga) ? "Administrativo" : "Comercial",
      empresa: i % 3 === 0 ? "Avora" : "Laportec", cidade: "São Paulo", estado: "SP", cpf: "",
      email: `candidato${i + 1}@exemplo.com`, telefone: `11${91000000 + i * 137}`, whatsapp: "",
      origem, indicadoPor: origem === "Indicação" ? "Carlos Eduardo Ramos" : "", status,
      notaGeral: estrelas ? estrelas * 2 : "", estrelas, observacoesRH: "", motivo: status === "Não Qualificados" ? "Perfil não aderente (exemplo)" : "",
      bancoTalentos: estrelas >= 4, curriculo: null, historicoEntrevistas: hist, movimentacoes: movs,
      dataCadastro: iso(cad), dataMovimentacao: hojeISO, funcionarioId: "",
    };
  });
  // O candidato contratado já virou ficha (trainee Mariana).
  const contratado = candidatos.find((c) => c.status === "Contratados");
  const mariana = porNome.get("Mariana Duarte")!;
  if (contratado) {
    contratado.funcionarioId = mariana.id;
    mariana.candidatoId = contratado.id;
  }

  // ─── Turma de treinamento ────────────────────────────────────────────────
  const trainees = funcionarios.filter((f) => f.tipoContrato === "Treinamento");
  const ini = trainees.map((f) => String((f.treinamento as Row).data_inicio)).sort()[0] ?? hojeISO;
  const fimTurma = new Date(ini + "T00:00:00");
  fimTurma.setDate(fimTurma.getDate() + 30);
  const treinamentos: Row[] = [{
    id: rid(rnd), nome: "Formação de Atendentes de Negócio", turma: `T${pad2(hoje.getMonth() + 1)}/${y}`, empresa: "Laportec",
    local: "Sala de treinamento (exemplo)", dataInicio: ini, dataFim: iso(fimTurma),
    participantes: trainees.filter((f) => f.empresa === "Laportec").map((f) => f.id), vtManual: false, vtValor: 0,
    custos: [{ id: rid(rnd), descricao: "Material didático", valor: 180 }, { id: rid(rnd), descricao: "Coffee break", valor: 240 }],
    obs: "Turma fictícia para demonstração.", atualizadoEm: agora,
  }];

  // ─── Documentos (metadados; os arquivos são simulados) ───────────────────
  const documentos: Row[] = ["Ana Beatriz Moura", "Carlos Eduardo Ramos", "Daniela Freitas"].flatMap((n, i) => {
    const f = porNome.get(n)!;
    return ["RG", "CTPS"].map((cat, j) => ({
      id: rid(rnd), funcId: f.id, categoria: cat, pasta: cat, nome: `${cat.toLowerCase()}-exemplo-${i + 1}.pdf`, tipo: "application/pdf",
      tamanho: 120000 + j * 1000, dataUpload: iso(new Date(y, hoje.getMonth() - 1, 10 + i)), storagePath: `${f.id}/demo_${cat}.pdf`,
      historico: [{ id: rid(rnd), data: iso(new Date(y, hoje.getMonth() - 1, 10 + i)), acao: "Enviado" }],
    }));
  });

  // ─── Pagamentos avulsos do RH (Pix/dinheiro, sem competência) ────────────
  const diarios: Row[] = [
    [0, "Pix", "Reembolso de combustível", "Carlos Eduardo Ramos", "Laportec", 86.5, false],
    [0, "Dinheiro", "Diária de evento", "Lucas Martins", "Laportec", 120, false],
    [-1, "Pix", "Diferença rescisão", "Pedro Henrique Lima", "Laportec", 210, true],
    [-3, "Transferência", "Ajuda de custo", "Samuel Oliveira", "Avora", 150, true],
    [-9, "Pix", "Reembolso de material", "Diego Fontes", "Zaytan", 64.9, true],
  ].map(([dias, forma, descricao, pessoa, empresa, valor, pago]) => {
    const f = porNome.get(String(pessoa));
    return {
      id: rid(rnd), dataPagamento: iso(new Date(y, hoje.getMonth(), hoje.getDate() + Number(dias))), formaPagamento: forma,
      descricao, pessoa, pix: f?.cpf ?? "", empresa, valor, pago,
    };
  });

  // ─── Linhas das tabelas-documento ────────────────────────────────────────
  const doc = (extra: (r: Row) => Row) => (r: Row): Row => ({ id: r.id, ...extra(r), data: r, updated_at: agora });
  const funcById = new Map(funcionarios.map((f) => [f.id, f]));
  return {
    "rh.funcionarios": funcionarios.map(doc((f) => ({ nome: f.nome, empresa: f.empresa, cargo: f.cargo, departamento: f.departamento, status: f.status }))),
    "rh.candidatos": candidatos.map(doc((c) => ({ nome: c.nome, empresa: c.empresa, telefone: c.telefone, area: c.area, vaga: c.vaga, origem: c.origem, status: c.status }))),
    "rh.pagamentos": pagamentos.map(doc((p) => ({ funcionario_id: p.funcionarioId, empresa: p.empresa, competencia: p.competencia, tipo: p.tipo, valor: p.valor }))),
    "rh.documentos": documentos.map(doc((d) => ({ func_id: d.funcId, empresa: funcById.get(d.funcId)?.empresa ?? "", categoria: d.categoria }))),
    "rh.atestados": atestados.map(doc((a) => ({ func_id: a.funcId, empresa: funcById.get(a.funcId)?.empresa ?? "", tipo: a.tipo }))),
    "rh.perguntas": [],
    "rh.treinamentos": treinamentos.map(doc((t) => ({ nome: t.nome, empresa: t.empresa, data_inicio: t.dataInicio }))),
    "rh.pagamentos_diarios": diarios.map(doc((p) => ({ data_pagamento: p.dataPagamento, empresa: p.empresa, pessoa: p.pessoa, valor: p.valor }))),
    "rh.config": [{ id: 1, data: { nomeEmpresa: "Grupo Zaytan", feriados, tiposAusencia: [] } }],
    "rh.app_state": [],
    "rh.extratos_mensais": extratos,
    "rh.folha_eventos": eventos,
    "rh.folha_importacoes": importacoes,
    "rh.folhas": [],
    "rh.folha_itens": [],
    "rh.backups": [],
    "rh.beneficios_mensais": [],
    "rh.pagamentos_beneficios": [],
  };
}
