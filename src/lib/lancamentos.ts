// ─── Compromissos financeiros: uma lista, várias origens ───────────────────
// Fonte única da verdade para o Dashboard. Junta, sem copiar nada, tudo o que
// tem data e valor e ainda não passou (ou acabou de passar) pelo caixa:
//
//   previstos      contas a pagar e receber (avulsas e geradas por recorrência)
//   cobranças      mensalidades dos clientes
//   pix            lista de Pix do dia do Financeiro
//   acordos        parcelas de dívidas/acordos (funcionalidade opcional)
//   RH             adiantamento, salário e pagamento diário vindos do RH
//
// REALIZADO × PROJETADO — a regra que vale em todo o app:
//   • Realizado é o EXTRATO (movimentações). Só ele mexe no saldo.
//   • Compromisso é promessa: entra na projeção enquanto está em aberto e SAI
//     dela quando é liquidado (aí o dinheiro aparece no extrato). Sem isso o
//     mesmo pagamento seria contado duas vezes.
//
// Sem React e sem Supabase: dá para testar linha a linha.

export type OrigemCompromisso =
  | "conta"
  | "recorrencia"
  | "cobranca"
  | "pix"
  | "acordo"
  | "rh_adiantamento"
  | "rh_salario"
  | "rh_diario";

export type Compromisso = {
  id: string;
  refId: string;                 // id na tabela de origem
  tipo: "in" | "out";
  data: string;                  // YYYY-MM-DD — vencimento/data prevista
  descricao: string;
  detalhe: string;
  categoria: string;
  valor: number;
  liquidado: boolean;            // pago/recebido: já saiu da projeção
  liquidadoEm: string | null;
  origem: OrigemCompromisso;
  pessoa: string;                // cliente, funcionário ou titular, quando existe
  responsavel: string;           // quem lançou — só onde o sistema registra
  projecao: boolean;             // valor calculado (ainda não lançado na origem)
  editavel: boolean;             // dá para editar/dar baixa direto no dashboard
};

export type MovLike = { dataISO: string; tipo: "in" | "out"; valor: number; cat?: string; ia?: string; desc?: string };

type PrevistoLike = {
  id: string; data: string; descricao: string; categoria: string; valor: number;
  tipo: "in" | "out"; recorrenteId: string | null; pago: boolean; pagoEm: string | null; pagoValor: number | null;
};
type CobrancaLike = {
  id: string; clienteId: string; competencia: string; vencimento: string; valor: number;
  status: "aberto" | "pago" | "cancelado"; pagoEm: string | null; pagoValor: number | null;
  descricao?: string; vendaId?: string | null; // o nome da mensalidade ("Suporte técnico")
};
type PixLike = {
  id: string; data: string; titular: string; descricao: string; valor: number;
  pago: boolean; pagoEm: string | null; estornado: boolean;
};
type AcordoLike = {
  id: string; nome: string; valor: number; diaPagamento: number;
  parcelaAtual: number; parcelasTotal: number; ativo: boolean;
};
export type CompromissoRH = {
  id: string; origem: "adiantamento" | "salario" | "diario"; fonte: "rh_pagamentos" | "rh_pagamentos_diarios" | "projecao";
  pessoa: string; funcionarioId: string | null; competencia: string; data: string;
  valor: number; status: "projetado" | "realizado"; descricao: string; empresaRH: string;
};

export type Fontes = {
  previstos?: PrevistoLike[];
  cobrancas?: CobrancaLike[];
  pix?: PixLike[];
  acordos?: AcordoLike[];
  rh?: CompromissoRH[];
  // Apoio: nome do cliente da cobrança e quem lançou cada Pix.
  nomeCliente?: (clienteId: string) => string;
  autorPix?: (pixId: string) => string;
  // Rubricas do RH que já entram por uma recorrência do Financeiro (migração
  // 49). Sem isto, a folha apareceria duas vezes: uma na conta do mês, outra
  // linha a linha pelo RH.
  origensRHCobertas?: Set<OrigemCompromisso>;
};

export type JanelaPeriodo = { de: string; ate: string };

const pad2 = (n: number) => String(n).padStart(2, "0");
const r2 = (n: number) => Math.round(n * 100) / 100;
const dentro = (j: JanelaPeriodo, iso: string) => !!iso && iso >= j.de && iso <= j.ate;

// Próximo vencimento de um acordo parcelado dentro da janela: o cadastro guarda
// o DIA do mês, não a data de cada parcela. Uma parcela por mês da janela.
export function parcelasDoAcordo(a: AcordoLike, j: JanelaPeriodo): string[] {
  const out: string[] = [];
  let ym = j.de.slice(0, 7);
  const fim = j.ate.slice(0, 7);
  for (let i = 0; i < 240 && ym <= fim; i++) {
    const [y, m] = ym.split("-").map(Number);
    const ultimo = new Date(y, m, 0).getDate();
    const iso = `${ym}-${pad2(Math.min(Math.max(a.diaPagamento, 1), ultimo))}`;
    if (dentro(j, iso)) out.push(iso);
    ym = m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`;
  }
  return out;
}

export function montarCompromissos(fontes: Fontes, j: JanelaPeriodo): Compromisso[] {
  const out: Compromisso[] = [];

  for (const p of fontes.previstos ?? []) {
    // Conta paga aparece pela data do pagamento; em aberto, pelo vencimento.
    const quando = p.pago && p.pagoEm ? p.pagoEm : p.data;
    if (!dentro(j, quando)) continue;
    out.push({
      id: `prev-${p.id}`,
      refId: p.id,
      tipo: p.tipo,
      data: p.data,
      descricao: p.descricao,
      detalhe: p.recorrenteId ? "Recorrência" : "Avulso",
      categoria: p.categoria || "",
      valor: p.pago && p.pagoValor != null ? p.pagoValor : p.valor,
      liquidado: p.pago,
      liquidadoEm: p.pagoEm,
      origem: p.recorrenteId ? "recorrencia" : "conta",
      pessoa: "",
      responsavel: "",
      projecao: false,
      editavel: !p.pago && !p.recorrenteId,
    });
  }

  for (const c of fontes.cobrancas ?? []) {
    if (c.status === "cancelado") continue;
    const quando = c.status === "pago" && c.pagoEm ? c.pagoEm : c.vencimento;
    if (!dentro(j, quando)) continue;
    const nome = fontes.nomeCliente?.(c.clienteId) ?? "";
    // Cliente com mais de uma mensalidade: o nome dela diz qual é.
    const base = !c.vendaId && c.descricao ? c.descricao : "Mensalidade";
    out.push({
      id: `cob-${c.id}`,
      refId: c.id,
      tipo: "in",
      data: c.vencimento,
      descricao: nome ? `${base} · ${nome}` : base,
      detalhe: `Competência ${c.competencia.slice(0, 7)}`,
      categoria: "",
      valor: c.status === "pago" && c.pagoValor != null ? c.pagoValor : c.valor,
      liquidado: c.status === "pago",
      liquidadoEm: c.pagoEm,
      origem: "cobranca",
      pessoa: nome,
      responsavel: "",
      projecao: false,
      editavel: false,
    });
  }

  for (const p of fontes.pix ?? []) {
    if (p.estornado) continue;               // estorno não é dinheiro saindo
    const quando = p.pago && p.pagoEm ? p.pagoEm.slice(0, 10) : p.data;
    if (!dentro(j, quando)) continue;
    out.push({
      id: `pix-${p.id}`,
      refId: p.id,
      tipo: "out",
      data: p.data,
      descricao: p.titular || "Pix",
      detalhe: p.descricao || "Pix do dia",
      categoria: "",
      valor: p.valor,
      liquidado: p.pago,
      liquidadoEm: p.pagoEm,
      origem: "pix",
      pessoa: p.titular,
      responsavel: fontes.autorPix?.(p.id) ?? "",
      projecao: false,
      editavel: false,
    });
  }

  for (const a of fontes.acordos ?? []) {
    if (!a.ativo) continue;
    for (const data of parcelasDoAcordo(a, j)) {
      out.push({
        id: `acordo-${a.id}-${data}`,
        refId: a.id,
        tipo: "out",
        data,
        descricao: a.nome,
        detalhe: `Parcela ${a.parcelaAtual} de ${a.parcelasTotal}`,
        categoria: "",
        valor: a.valor,
        liquidado: false,
        liquidadoEm: null,
        origem: "acordo",
        pessoa: "",
        responsavel: "",
        projecao: false,
        editavel: false,
      });
    }
  }

  for (const r of fontes.rh ?? []) {
    if (!dentro(j, r.data)) continue;
    const origem: OrigemCompromisso =
      r.origem === "adiantamento" ? "rh_adiantamento" : r.origem === "salario" ? "rh_salario" : "rh_diario";
    // A recorrência daquela rubrica já cobre esse dinheiro.
    if (fontes.origensRHCobertas?.has(origem)) continue;
    out.push({
      id: `rh-${r.id}`,
      refId: r.funcionarioId ?? r.id,
      tipo: "out",
      data: r.data,
      descricao: r.pessoa || r.descricao,
      detalhe: r.descricao,
      categoria: "",
      valor: r.valor,
      liquidado: r.status === "realizado",
      liquidadoEm: r.status === "realizado" ? r.data : null,
      origem,
      pessoa: r.pessoa,
      responsavel: "",
      // Projeção = o RH ainda não lançou; o valor sai do salário × percentual.
      projecao: r.fonte === "projecao",
      editavel: false,
    });
  }

  return out.sort((a, b) => a.data.localeCompare(b.data) || a.descricao.localeCompare(b.descricao, "pt-BR"));
}

// ─── Resumo do período ─────────────────────────────────────────────────────
export type ResumoPeriodo = {
  entradasRealizadas: number;
  saidasRealizadas: number;
  resultadoRealizado: number;
  entradasPrevistas: number;   // compromissos de entrada AINDA em aberto
  saidasPrevistas: number;     // compromissos de saída AINDA em aberto
  resultadoPrevisto: number;   // realizado + em aberto
};

export function resumoPeriodo(
  movs: MovLike[],
  compromissos: Compromisso[],
  j: JanelaPeriodo,
  // Período fechado: o que passou, passou — nada em aberto continua projetando.
  fechado = false
): ResumoPeriodo {
  let entradasRealizadas = 0;
  let saidasRealizadas = 0;
  for (const m of movs) {
    if (!dentro(j, m.dataISO)) continue;
    if (m.tipo === "in") entradasRealizadas += m.valor;
    else saidasRealizadas += m.valor;
  }
  let entradasPrevistas = 0;
  let saidasPrevistas = 0;
  if (!fechado) {
    for (const c of compromissos) {
      if (c.liquidado) continue;
      if (c.tipo === "in") entradasPrevistas += c.valor;
      else saidasPrevistas += c.valor;
    }
  }
  entradasRealizadas = r2(entradasRealizadas);
  saidasRealizadas = r2(saidasRealizadas);
  entradasPrevistas = r2(entradasPrevistas);
  saidasPrevistas = r2(saidasPrevistas);
  return {
    entradasRealizadas,
    saidasRealizadas,
    resultadoRealizado: r2(entradasRealizadas - saidasRealizadas),
    entradasPrevistas,
    saidasPrevistas,
    resultadoPrevisto: r2(entradasRealizadas + entradasPrevistas - saidasRealizadas - saidasPrevistas),
  };
}

// ─── Série do gráfico Entradas × Saídas ────────────────────────────────────
export type PontoFluxo = {
  chave: string;   // YYYY-MM-DD ou YYYY-MM
  rotulo: string;  // dd/MM ou mmm
  entradas: number;
  saidas: number;
  entradasPrevistas: number;
  saidasPrevistas: number;
};

const MESES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function serieFluxo(
  movs: MovLike[],
  compromissos: Compromisso[],
  j: JanelaPeriodo,
  agrupar: "dia" | "mes" = "dia",
  fechado = false
): PontoFluxo[] {
  const chaveDe = (iso: string) => (agrupar === "mes" ? iso.slice(0, 7) : iso);
  const rotuloDe = (chave: string) =>
    agrupar === "mes"
      ? `${MESES_CURTO[Number(chave.slice(5, 7)) - 1]}/${chave.slice(2, 4)}`
      : `${chave.slice(8, 10)}/${chave.slice(5, 7)}`;

  const mapa = new Map<string, PontoFluxo>();
  const ponto = (iso: string) => {
    const chave = chaveDe(iso);
    let p = mapa.get(chave);
    if (!p) {
      p = { chave, rotulo: rotuloDe(chave), entradas: 0, saidas: 0, entradasPrevistas: 0, saidasPrevistas: 0 };
      mapa.set(chave, p);
    }
    return p;
  };

  for (const m of movs) {
    if (!dentro(j, m.dataISO)) continue;
    const p = ponto(m.dataISO);
    if (m.tipo === "in") p.entradas += m.valor;
    else p.saidas += m.valor;
  }
  if (!fechado) {
    for (const c of compromissos) {
      if (c.liquidado || !dentro(j, c.data)) continue;
      const p = ponto(c.data);
      if (c.tipo === "in") p.entradasPrevistas += c.valor;
      else p.saidasPrevistas += c.valor;
    }
  }

  return [...mapa.values()]
    .map((p) => ({
      ...p,
      entradas: r2(p.entradas),
      saidas: r2(p.saidas),
      entradasPrevistas: r2(p.entradasPrevistas),
      saidasPrevistas: r2(p.saidasPrevistas),
    }))
    .sort((a, b) => a.chave.localeCompare(b.chave));
}

// Rótulo curto de cada origem (usado nas etiquetas das tabelas).
export const ROTULO_ORIGEM: Record<OrigemCompromisso, string> = {
  conta: "Conta avulsa",
  recorrencia: "Recorrência",
  cobranca: "Mensalidade",
  pix: "Pix do dia",
  acordo: "Acordo",
  rh_adiantamento: "RH · adiantamento",
  rh_salario: "RH · folha",
  rh_diario: "RH · pagamento diário",
};

export const ORIGEM_DO_RH = (o: OrigemCompromisso) => o.startsWith("rh_");
