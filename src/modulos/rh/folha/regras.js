/* ============================================================================
   REGRAS DA FOLHA DE PAGAMENTO — Extrato Mensal × Folha de Repasse
   ----------------------------------------------------------------------------
   Funções PURAS: sem React, sem Supabase, sem ler o relógio do sistema.
   Todo dinheiro circula em CENTAVOS INTEIROS. Nenhum cálculo intermediário usa
   float, e o único arredondamento de um valor proporcional acontece no fim —
   a diária nunca é arredondada antes de multiplicar.

   Três camadas que nunca se misturam:
     1. OFICIAL — o que veio do PDF da contabilidade. Somente leitura.
     2. INTERNO — períodos complementares e ajustes aprovados pela empresa.
     3. PAGO    — pagamentos efetivamente realizados, alocados aos valores devidos.

   Nada aqui decide "já foi pago" por existir um valor no PDF: pago é só o que
   tem registro de pagamento confirmado.
   ============================================================================ */

// ─── 1. DINHEIRO ─────────────────────────────────────────────────────────────

/** Converte reais (número) em centavos inteiros. Arredonda meio-para-cima de forma
 *  simétrica; o empurrão de 1e-7 corrige o float de valores como 1,005. */
export function centavos(valor) {
  if (valor === null || valor === undefined || valor === "") return 0;
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(n)) return 0;
  const abs = Math.round(Math.abs(n) * 100 + 1e-7);
  return n < 0 ? -abs : abs;
}
export const reais = (c) => c / 100;
export const somaCentavos = (lista, get = (x) => x) => (lista || []).reduce((s, x) => s + get(x), 0);

/** Divisão inteira com arredondamento meio-para-cima simétrico. Operandos inteiros:
 *  nada de float no caminho do dinheiro. */
export function dividirArredondado(numerador, denominador) {
  if (!denominador) throw new Error("Divisão por zero");
  const sinal = (numerador < 0) !== (denominador < 0) ? -1 : 1;
  const a = Math.abs(numerador), b = Math.abs(denominador);
  const q = Math.floor(a / b);
  const r = a - q * b;
  return sinal * (q + (r * 2 >= b ? 1 : 0));
}

export function formatarBRL(c) {
  if (c === null || c === undefined) return "—";
  const neg = c < 0, a = Math.abs(Math.trunc(c));
  const inteiro = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "-" : ""}R$ ${inteiro},${String(a % 100).padStart(2, "0")}`;
}
/** "1.234,56" → 1234.56 (reais). Texto sem número vira null — ausência não é zero. */
export function numeroBR(s) {
  const m = String(s ?? "").match(/-?[\d.]*\d,\d{2}|-?\d+/);
  if (!m) return null;
  const n = Number(m[0].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
/** Referência em horas "12:06" → 12,1 h (12 h + 6/60). Não é dinheiro. */
export function horasDecimais(hhmm) {
  const m = /^(\d{1,3}):(\d{2})$/.exec(String(hhmm ?? "").trim());
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
}

// ─── 2. CALENDÁRIO (sem fuso horário) ────────────────────────────────────────
// Datas são strings "AAAA-MM-DD" tratadas como datas de CALENDÁRIO. Nenhum
// objeto Date: um "2026-07-31" nunca vira 30/07 por causa do fuso.

export const bissexto = (a) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
export function diasNoMes(a, m) {
  return [31, bissexto(a) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}
export function lerData(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  if (!m) return null;
  const a = +m[1], mes = +m[2], d = +m[3];
  if (mes < 1 || mes > 12 || d < 1 || d > diasNoMes(a, mes)) return null;
  return { a, m: mes, d };
}
export const dataISO = (a, m, d) => `${String(a).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
export const competenciaDe = (iso) => String(iso ?? "").slice(0, 7);
export function diasDaCompetencia(comp) {
  const [a, m] = String(comp).split("-").map(Number);
  return diasNoMes(a, m);
}
// Número ordinal do dia (algoritmo de Howard Hinnant) — só aritmética inteira.
function ordinal({ a, m, d }) {
  const y = m <= 2 ? a - 1 : a;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe;
}
/** Dias corridos entre duas datas, CONTANDO a inicial e a final. */
export function diasCorridos(inicioISO, fimISO) {
  const i = lerData(inicioISO), f = lerData(fimISO);
  if (!i || !f) return 0;
  const n = ordinal(f) - ordinal(i) + 1;
  return n > 0 ? n : 0;
}
export function fimDoMes(iso) { const x = lerData(iso); return dataISO(x.a, x.m, diasNoMes(x.a, x.m)); }
export function diaSeguinte(iso) {
  const x = lerData(iso);
  if (x.d < diasNoMes(x.a, x.m)) return dataISO(x.a, x.m, x.d + 1);
  return x.m < 12 ? dataISO(x.a, x.m + 1, 1) : dataISO(x.a + 1, 1, 1);
}
/** Quebra um período em trechos por mês-calendário. Cada trecho carrega o divisor
 *  do PRÓPRIO mês — um período de 25/07 a 05/08 usa ÷31 em julho e ÷31 em agosto,
 *  e um de 25/01 a 05/02 usa ÷31 e ÷28 (ou ÷29 em ano bissexto). */
export function segmentarPorMes(inicioISO, fimISO) {
  if (!lerData(inicioISO) || !lerData(fimISO) || inicioISO > fimISO) return [];
  const out = [];
  let cur = inicioISO;
  while (cur <= fimISO) {
    const fm = fimDoMes(cur);
    const fimSeg = fm < fimISO ? fm : fimISO;
    const comp = competenciaDe(cur);
    out.push({ competencia: comp, inicio: cur, fim: fimSeg, diasCorridos: diasCorridos(cur, fimSeg), divisor: diasDaCompetencia(comp) });
    cur = diaSeguinte(fimSeg);
  }
  return out;
}

// ─── 3. CÁLCULO PROPORCIONAL (critério interno) ─────────────────────────────
// Critério INTERNO da empresa para períodos complementares, sujeito à validação
// da contabilidade — não é afirmação de regra legal universal. Não serve para
// recalcular eventos oficiais, nem férias, rescisão ou 13º.
//   divisor = dias reais do mês de referência (28, 29, 30 ou 31)
//   valor   = arredondar(salário mensal × dias remunerados ÷ divisor, 2)

export function valorProporcional(salarioMensalCentavos, diasRemunerados, divisor) {
  if (!(divisor > 0)) throw new Error("Divisor do mês inválido");
  return dividirArredondado(Math.trunc(salarioMensalCentavos) * Math.trunc(diasRemunerados), divisor);
}
/** Diária só para EXIBIR (8 casas). Nunca entra em conta. */
export function diariaExibicao(salarioMensalCentavos, divisor) {
  return `R$ ${(salarioMensalCentavos / divisor / 100).toFixed(8).replace(".", ",")}`;
}
export function memoriaProporcional(salarioMensalCentavos, diasRemunerados, divisor) {
  return `${formatarBRL(salarioMensalCentavos)} × ${diasRemunerados} dia(s) ÷ ${divisor} = ${formatarBRL(valorProporcional(salarioMensalCentavos, diasRemunerados, divisor))}`;
}

// ─── 4. PERÍODOS COMPLEMENTARES ──────────────────────────────────────────────
// Dias trabalhados que a folha importada ainda não contempla (ex.: pessoa que
// começou antes de ser registrada). Servem para rastrear e conferir — não
// substituem a regularização junto à contabilidade.

export const CRITERIOS_DIAS = {
  corridos: "Dias corridos do período (inclui a data inicial e a final)",
  informados: "Dias efetivamente trabalhados, informados por competência",
};
export const STATUS_COMPLEMENTO = {
  rascunho: "Rascunho",
  a_conferir: "A conferir",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
  cancelado: "Cancelado",
};
const COMPLEMENTO_INATIVO = new Set(["rejeitado", "cancelado"]);

/** Calcula um complemento. `salarioMensalCentavos` é o salário GRAVADO no próprio
 *  complemento — mudar o cadastro depois não altera o que já foi calculado. */
export function calcularComplemento(c) {
  const erros = [];
  const sal = Math.trunc(c?.salarioMensalCentavos || 0);
  if (!(sal > 0)) erros.push("Informe o salário mensal aplicável ao período.");
  const di = lerData(c?.inicio), df = lerData(c?.fim);
  if (!di) erros.push("Data de início inválida.");
  if (!df) erros.push("Data de fim inválida.");
  if (di && df && c.inicio > c.fim) erros.push("O início não pode ser depois do fim.");
  const criterio = c?.criterio === "informados" ? "informados" : "corridos";
  const segs = di && df && c.inicio <= c.fim ? segmentarPorMes(c.inicio, c.fim) : [];
  const segmentos = segs.map((s) => {
    let dias = s.diasCorridos;
    if (criterio === "informados") {
      const inf = c.diasInformados?.[s.competencia];
      const n = inf === undefined || inf === null || inf === "" ? NaN : Number(inf);
      if (!Number.isInteger(n) || n < 0) { erros.push(`Informe quantos dias foram trabalhados em ${s.competencia}.`); dias = 0; }
      else if (n > s.diasCorridos) { erros.push(`${s.competencia}: ${n} dia(s) informado(s), mas o trecho só tem ${s.diasCorridos} dia(s) corrido(s).`); dias = 0; }
      else dias = n;
    }
    const valorCentavos = sal > 0 ? valorProporcional(sal, dias, s.divisor) : 0;
    return {
      ...s, diasRemunerados: dias, valorCentavos,
      diaria: sal > 0 ? diariaExibicao(sal, s.divisor) : "—",
      memoria: sal > 0 ? memoriaProporcional(sal, dias, s.divisor) : "—",
    };
  });
  const ajustesVivos = (c?.ajustes || []).filter((a) => a && a.status !== "cancelado");
  for (const a of ajustesVivos) if (!String(a.justificativa || "").trim()) erros.push("Todo ajuste precisa de justificativa.");
  const calculadoCentavos = somaCentavos(segmentos, (s) => s.valorCentavos);
  const ajustesCentavos = somaCentavos(ajustesVivos, (a) => Math.trunc(a.valorCentavos || 0));
  return {
    valido: erros.length === 0, erros: [...new Set(erros)], criterio, segmentos,
    calculadoCentavos, ajustesCentavos, totalCentavos: calculadoCentavos + ajustesCentavos,
  };
}

export const intervalosSeSobrepoem = (a1, a2, b1, b2) => a1 <= b2 && b1 <= a2;

/** Sobreposição ENTRE complementos do mesmo funcionário — isso é bloqueado. */
export function sobreposicoesEntreComplementos(complementos) {
  const vivos = (complementos || []).filter((c) => c && !COMPLEMENTO_INATIVO.has(c.status) && lerData(c.inicio) && lerData(c.fim));
  const out = [];
  for (let i = 0; i < vivos.length; i++) {
    for (let j = i + 1; j < vivos.length; j++) {
      const a = vivos[i], b = vivos[j];
      if (intervalosSeSobrepoem(a.inicio, a.fim, b.inicio, b.fim)) {
        out.push({ a: a.id, b: b.id, inicio: a.inicio > b.inicio ? a.inicio : b.inicio, fim: a.fim < b.fim ? a.fim : b.fim });
      }
    }
  }
  return out;
}

/** Sobreposição com a folha OFICIAL — isso é sinalizado, não decidido.
 *  O PDF informa QUANTOS dias remunerou, não QUAIS — então a única prova segura
 *  de "não sobrepõe" é o trecho terminar antes da admissão impressa na folha.
 *  Nenhum intervalo é inventado a partir da quantidade de dias.
 *  `folhas`: registros oficiais DESTE funcionário, [{ competencia, admissao }]. */
export function conferirSobreposicaoComFolha(complemento, folhas) {
  if (!lerData(complemento?.inicio) || !lerData(complemento?.fim)) return [];
  return segmentarPorMes(complemento.inicio, complemento.fim).map((s) => {
    const folha = (folhas || []).find((f) => f.competencia === s.competencia);
    if (!folha) {
      return { competencia: s.competencia, situacao: "sem_folha", motivo: "Ainda não há folha oficial importada nesta competência. Quando ela chegar, este período volta para conferência." };
    }
    const adm = lerData(folha.admissao) ? folha.admissao : null;
    if (adm && s.fim < adm) {
      return { competencia: s.competencia, situacao: "sem_sobreposicao", motivo: `O trecho termina antes da admissão impressa na folha (${adm}). Esses dias não podem estar nela.` };
    }
    return {
      competencia: s.competencia, situacao: "possivel_sobreposicao",
      motivo: adm && s.inicio < adm
        ? `Parte do trecho (a partir de ${adm}) cai dentro do período da folha oficial. Limite o complemento ao dia anterior à admissão ou confira com a contabilidade.`
        : "A folha oficial desta competência pode já remunerar estes dias. O PDF traz a quantidade de dias, não as datas — confira antes de aprovar.",
    };
  });
}

// ─── 5. EVENTOS DO PDF: mapeamento semântico por layout ──────────────────────
// O MESMO código pode significar coisas diferentes em layouts diferentes. Prova
// real: o 201 é "DESCONTO DE FARMACIA" no Extrato Mensal da LAPORTEC e "VALE
// REFEICAO NÃO UTILIZADO" no Analítico de Rescisão da AVORA. Por isso o mapa é
// por LAYOUT, e cada empresa pode revisar o seu. O evento original é sempre
// preservado; o mapa só acrescenta um "papel".

export const LAYOUTS = {
  "extrato-mensal": "Extrato Mensal (contabilidade)",
  "analitico-rescisao": "Relatório Analítico do Cálculo de Rescisão",
  "relacao-liquidos": "Relação Geral dos Líquidos",
  "folha-mensal": "Folha Mensal (formato antigo)",
};
export function detectarLayout(texto) {
  const t = String(texto || "");
  if (/EXTRATO\s+MENSAL/i.test(t) && /(Empr|Contr)\.?:\s*\d+/.test(t)) return "extrato-mensal";
  if (/RELAT[ÓO]RIO\s+ANAL[ÍI]TICO\s+DO\s+C[ÁA]LCULO\s+DE\s+RESCIS[ÃA]O/i.test(t)) return "analitico-rescisao";
  if (/RELA[ÇC][ÃA]O\s+GERAL\s+DOS\s+L[ÍI]QUIDOS/i.test(t)) return "relacao-liquidos";
  if (/Folha\s+Mensal/i.test(t)) return "folha-mensal";
  return "";
}
/** A competência vem do CAMPO "Competência" — nunca da emissão nem do nome do arquivo. */
export function competenciaDoCampo(texto) {
  const m = String(texto || "").match(/Compet[eê]ncia:\s*(\d{2})\/(\d{4})/i);
  return m ? `${m[2]}-${m[1]}` : "";
}
/** Página do PDF em que um trecho aparece: a última marca "Página: N/M" antes dele. */
export function paginaNoTexto(texto, indice) {
  const antes = String(texto || "").slice(0, Math.max(0, indice));
  const todas = [...antes.matchAll(/P[áa]gina:\s*(\d+)\s*\/\s*\d+/gi)];
  return todas.length ? Number(todas[todas.length - 1][1]) : null;
}
/** Cabeçalho do documento: empresa, CNPJ, emissão, competência, tipo de cálculo,
 *  páginas e os totais gerais IMPRESSOS (usados só para conferir a soma dos
 *  funcionários — nunca são somados de novo). */
export function cabecalhoExtrato(texto) {
  const t = String(texto || "");
  const g = (re) => ((t.match(re) || [])[1] || "").trim();
  const em = t.match(/Emiss[ãa]o:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  const pags = [...t.matchAll(/P[áa]gina:\s*\d+\s*\/\s*(\d+)/gi)].map((m) => Number(m[1]));
  const tp = t.match(/Total\s+Geral\s+Proventos:\s*(-?[\d.]+,\d{2})\s+Total\s+Geral\s+Descontos:\s*(-?[\d.]+,\d{2})/i);
  const tl = t.match(/L[íi]quido\s+Geral:\s*(-?[\d.]+,\d{2})/i);
  return {
    empresa: g(/Empresa:\s*(?:\d+\s*-\s*)?([^\n]+?)\s+P[áa]gina:/i),
    cnpj: g(/CNPJ:\s*([\d.\/-]+)/),
    emissao: em ? `${em[3]}-${em[2]}-${em[1]}` : "",
    competencia: competenciaDoCampo(t),
    calculo: g(/C[áa]lculo:\s*(.+?)\s+Horas:/i) || g(/C[áa]lculo:\s*([^\n]+)/i),
    paginas: pags.length ? Math.max(...pags) : null,
    totalGeral: tp && tl ? { proventos: numeroBR(tp[1]), descontos: numeroBR(tp[2]), liquido: numeroBR(tl[1]) } : null,
  };
}

// Papéis — o que cada evento SIGNIFICA para a conciliação.
export const PAPEIS = {
  salario: "Salário do período",
  afastamento_remunerado: "Afastamento remunerado",
  salario_familia: "Salário-família",
  pro_labore: "Pró-labore",
  adiantamento: "Desconto do adiantamento salarial",
  adiantamento_troco: "Troco do adiantamento",
  troco_mes: "Troco do mês (arredondamento do líquido)",
  troco_mes_anterior: "Troco do mês anterior",
  inss: "INSS",
  inss_rescisao: "INSS sobre rescisão",
  inss_contribuinte: "INSS do contribuinte",
  vt_desconto: "Desconto de vale-transporte",
  vt_nao_utilizado: "VT não utilizado",
  vr_nao_utilizado: "VR não utilizado",
  falta: "Desconto de faltas",
  falta_dsr: "Desconto de DSR por falta",
  falta_horas: "Desconto de horas faltadas",
  liquido_rescisao: "Líquido de rescisão (pago pela rescisão)",
  estouro_rescisao: "Estouro de rescisão",
  saldo_salario_rescisao: "Saldo de salário (rescisão)",
  verba_rescisoria: "Verba rescisória",
  multa_estabilidade: "Multa de estabilidade",
  outro_desconto: "Outro desconto",
  outro_provento: "Outro provento",
};

const MAPA_EXTRATO_MENSAL = {
  "8781": { papel: "salario" },
  "8870": { papel: "afastamento_remunerado" },
  "995": { papel: "salario_familia" },
  "9380": { papel: "pro_labore" },
  "981": { papel: "adiantamento" },
  // 871 COMPÕE o adiantamento só depois de confirmado: a evidência (981 792,00 +
  // 871 8,00 = 800,00, o mesmo valor da Relação de Líquidos de adiantamento) é
  // forte, mas a prova é da empresa, não do código.
  "871": { papel: "adiantamento_troco", requerConfirmacao: true },
  "992": { papel: "troco_mes" },
  "993": { papel: "troco_mes_anterior" },
  "998": { papel: "inss" },
  "826": { papel: "inss_rescisao" },
  "989": { papel: "inss_rescisao" },
  "843": { papel: "inss_contribuinte" },
  "48": { papel: "vt_desconto" },
  "203": { papel: "vt_nao_utilizado" },
  "212": { papel: "vr_nao_utilizado" },
  "201": { papel: "outro_desconto", rotulo: "Desconto de farmácia" },
  "8111": { papel: "outro_desconto", rotulo: "Desconto de plano de saúde" },
  "8792": { papel: "falta" },
  "8794": { papel: "falta_dsr" },
  "8069": { papel: "falta_horas" },
  "51": { papel: "liquido_rescisao" },
  "8130": { papel: "estouro_rescisao" },
  "9180": { papel: "saldo_salario_rescisao" },
  "8550": { papel: "verba_rescisoria" }, "9592": { papel: "verba_rescisoria" },
  "29": { papel: "verba_rescisoria" }, "811": { papel: "verba_rescisoria" },
  "8126": { papel: "verba_rescisoria" }, "8169": { papel: "verba_rescisoria" },
  "9591": { papel: "verba_rescisoria" },
  "842": { papel: "multa_estabilidade" },
};
const MAPA_ANALITICO_RESCISAO = {
  "9180": { papel: "saldo_salario_rescisao" },
  "8550": { papel: "verba_rescisoria" }, "29": { papel: "verba_rescisoria" }, "8169": { papel: "verba_rescisoria" },
  "201": { papel: "vr_nao_utilizado" },      // ≠ Extrato Mensal, onde 201 é farmácia
  "202": { papel: "vt_nao_utilizado" },
  "826": { papel: "inss_rescisao" }, "989": { papel: "inss_rescisao" },
  "993": { papel: "troco_mes_anterior" },
  "48": { papel: "vt_desconto" },
};
export const MAPAS_PADRAO = { "extrato-mensal": MAPA_EXTRATO_MENSAL, "analitico-rescisao": MAPA_ANALITICO_RESCISAO };

/** Mapa efetivo = padrão do layout + revisões da empresa (inclusive a confirmação do 871). */
export function mapaEventos(layout, revisoes = {}) {
  const base = MAPAS_PADRAO[layout] || {};
  const out = {};
  for (const [cod, v] of Object.entries(base)) out[cod] = { ...v };
  for (const [cod, v] of Object.entries(revisoes || {})) out[cod] = { ...(out[cod] || {}), ...v };
  return out;
}
export function papelDoEvento(evento, mapa) {
  const m = mapa?.[String(evento?.codigo ?? "").trim()];
  if (m && m.papel) return m.papel;
  return evento?.tipo === "provento" ? "outro_provento" : "outro_desconto";
}
export function eventoReconhecido(evento, mapa) { return !!mapa?.[String(evento?.codigo ?? "").trim()]; }
/** 871 e afins: entram na conta só depois de confirmados. */
export function eventoConta(evento, mapa) {
  const m = mapa?.[String(evento?.codigo ?? "").trim()];
  return !(m && m.requerConfirmacao && !m.confirmado);
}
export function eventosNaoReconhecidos(eventos, mapa) { return (eventos || []).filter((e) => !eventoReconhecido(e, mapa)); }

// ─── 6. CLASSIFICAÇÃO DO REGISTRO: mensal, rescisão ou pró-labore ────────────
// Líquido ZERADO numa rescisão não é "nada a pagar": o valor da rescisão sai
// pelo controle de Rescisões (o evento 51 zera o mês justamente por isso). E um
// líquido zerado também não prova que alguém pagou. Por isso rescisão e
// pró-labore são separados e não entram no saldo salarial do repasse.

export function classificarRegistro(registro, eventos = [], mapa = {}) {
  const papeis = (eventos || []).map((e) => papelDoEvento(e, mapa));
  const tem = (p) => papeis.includes(p);
  const valorDo = (p) => somaCentavos((eventos || []).filter((_, i) => papeis[i] === p), (e) => centavos(e.valor));
  const proLabore = /diretor|s[óo]cio|contribuinte/i.test(registro?.vinculo || "") || tem("pro_labore");
  const demitido = /demit/i.test(registro?.situacao || "");
  const rescisao = !proLabore && (demitido || tem("liquido_rescisao") || tem("estouro_rescisao") || tem("saldo_salario_rescisao"));
  return {
    tipo: proLabore ? "pro_labore" : rescisao ? "rescisao" : "mensal",
    // null = não se sabe (sem o evento 51 não há valor de rescisão impresso) — NUNCA zero.
    liquidoRescisaoCentavos: tem("liquido_rescisao") ? valorDo("liquido_rescisao") : null,
    estouroRescisaoCentavos: valorDo("estouro_rescisao"),
  };
}

// ─── 7. CONCILIAÇÕES (nunca descontam nada sozinhas) ─────────────────────────

/** Adiantamento: compara o que a FOLHA descontou (981 + 871 confirmado) com o que o
 *  CRM registra como PAGO. Só informa. O líquido oficial já vem sem o adiantamento;
 *  descontá-lo de novo seria pagar a mesma conta duas vezes. */
export function conciliarAdiantamento({ eventos = [], mapa = {}, temVerbas = true, pagos = [] }) {
  const pagoCentavos = somaCentavos(pagos, (p) => Math.trunc(p.valorCentavos || 0));
  if (!temVerbas) {
    return { status: "sem_verbas", naFolhaCentavos: null, aConfirmarCentavos: 0, pagoCentavos, diferencaCentavos: null, composicao: [],
      mensagem: "As verbas deste extrato não foram lidas: não dá para saber se o adiantamento já foi descontado." };
  }
  const composicao = (eventos || [])
    .filter((e) => ["adiantamento", "adiantamento_troco"].includes(papelDoEvento(e, mapa)))
    .map((e) => ({ codigo: String(e.codigo), descricao: e.descricao, valorCentavos: centavos(e.valor), conta: eventoConta(e, mapa), papel: papelDoEvento(e, mapa) }));
  const naFolhaCentavos = somaCentavos(composicao.filter((x) => x.conta), (x) => x.valorCentavos);
  const aConfirmarCentavos = somaCentavos(composicao.filter((x) => !x.conta), (x) => x.valorCentavos);
  const diferencaCentavos = pagoCentavos - naFolhaCentavos;
  // Registro de "pago" criado pela importação do próprio PDF não prova pagamento: comparar a
  // folha com ela mesma sempre "bate". Por isso vira pedido de confirmação, não conciliação.
  const soDoPdf = pagos.length > 0 && pagos.every((p) => p && p.fonte === "pdf");
  let status, mensagem;
  if (soDoPdf && (naFolhaCentavos || aConfirmarCentavos)) {
    status = "confirmar_pagamento";
    mensagem = "O adiantamento consta como pago só porque veio da importação do PDF. Confirme que ele foi pago de verdade (aba Adiantamento).";
  } else if (!naFolhaCentavos && !aConfirmarCentavos && !pagoCentavos) { status = "sem_adiantamento"; mensagem = "Sem adiantamento nesta competência."; }
  else if (diferencaCentavos === 0) { status = "conciliado"; mensagem = "O que a folha descontou é exatamente o que foi pago."; }
  else if (aConfirmarCentavos && pagoCentavos === naFolhaCentavos + aConfirmarCentavos) {
    status = "pendente_mapeamento";
    mensagem = `Fecha exatamente se o evento de troco (${formatarBRL(aConfirmarCentavos)}) compuser o adiantamento. Confirme o mapeamento para conciliar.`;
  } else if (pagoCentavos && !naFolhaCentavos && !aConfirmarCentavos) {
    status = "divergente";
    mensagem = "Há adiantamento pago no CRM que não aparece na folha. Ele NÃO é descontado sozinho — revise; se deve abater, registre um ajuste aprovado.";
  } else {
    status = "divergente";
    mensagem = `A folha descontou ${formatarBRL(naFolhaCentavos)} e o CRM registra ${formatarBRL(pagoCentavos)} pagos. Revise antes de pagar.`;
  }
  return { status, naFolhaCentavos, aConfirmarCentavos, pagoCentavos, diferencaCentavos, composicao, mensagem };
}

const CATEGORIAS_FALTA_SALARIO = new Set(["Salário", "Horas"]);
/** Faltas: a folha oficial já traz as dela (8792, 8794, 8069). Uma falta lançada no
 *  CRM NUNCA é descontada sozinha — ou já está no líquido, ou é divergência para
 *  revisão. Só as linhas de salário/horas entram; VT/VR são conferidos no benefício. */
export function conciliarFaltas({ eventos = [], mapa = {}, temVerbas = true, faltasCRM = [] }) {
  const crm = (faltasCRM || []).filter((f) => !f.categoria || CATEGORIAS_FALTA_SALARIO.has(f.categoria));
  const crmCentavos = somaCentavos(crm, (f) => centavos(f.valor));
  if (!temVerbas) {
    return { status: crmCentavos ? "sem_verbas" : "sem_faltas", naFolhaCentavos: null, crmCentavos, diferencaCentavos: null,
      mensagem: crmCentavos ? "Há falta lançada no CRM, mas as verbas não foram lidas: não dá para saber se a folha já descontou." : "" };
  }
  const naFolha = (eventos || []).filter((e) => ["falta", "falta_dsr", "falta_horas"].includes(papelDoEvento(e, mapa)));
  const naFolhaCentavos = somaCentavos(naFolha, (e) => centavos(e.valor));
  const diferencaCentavos = crmCentavos - naFolhaCentavos;
  let status, mensagem;
  if (!crmCentavos && !naFolhaCentavos) { status = "sem_faltas"; mensagem = ""; }
  else if (!crmCentavos) { status = "so_na_folha"; mensagem = `A contabilidade já descontou ${formatarBRL(naFolhaCentavos)} de faltas nesta folha.`; }
  else if (diferencaCentavos === 0) { status = "conciliado"; mensagem = "As faltas do CRM batem com as descontadas na folha — já estão no líquido."; }
  else if (!naFolhaCentavos) { status = "divergente"; mensagem = `Falta lançada no CRM (${formatarBRL(crmCentavos)}) que não aparece na folha. Não é descontada sozinha: se deve abater, aprove um ajuste.`; }
  else { status = "divergente"; mensagem = `A folha descontou ${formatarBRL(naFolhaCentavos)} de faltas e o CRM tem ${formatarBRL(crmCentavos)}. Revise.`; }
  return { status, naFolhaCentavos, crmCentavos, diferencaCentavos, mensagem };
}

/** Benefício: concedido, pago, desconto importado e saldo — lado a lado, sem
 *  alarme por "concedido ≠ desconto" (o desconto de VT é 6% do salário, não o
 *  valor do benefício), e sem concluir que não houve VR só porque o PDF não tem
 *  desconto de VR. */
export function resumoBeneficio({ concedidoCentavos = null, pagoCentavos = 0, descontoImportadoCentavos = null, naoUtilizadoCentavos = null } = {}) {
  const concedido = concedidoCentavos === null ? null : Math.trunc(concedidoCentavos);
  const pago = Math.trunc(pagoCentavos || 0);
  return {
    concedidoCentavos: concedido, pagoCentavos: pago,
    saldoCentavos: concedido === null ? null : concedido - pago,
    descontoImportadoCentavos: descontoImportadoCentavos === null ? null : Math.trunc(descontoImportadoCentavos),
    naoUtilizadoCentavos: naoUtilizadoCentavos === null ? null : Math.trunc(naoUtilizadoCentavos),
    alertas: [],
  };
}

// ─── 8. PAGAMENTOS E ALOCAÇÕES ───────────────────────────────────────────────
// Um pagamento é uma transferência real. Ele se divide em ALOCAÇÕES, cada uma
// quitando um valor devido ("folha", "complemento:<id>", "vt", "vr"). As
// alocações precisam somar exatamente o valor da transferência: assim uma
// transferência que cobre salário + VT nunca é contada duas vezes.

export const CATEGORIA_DO_ALVO = (alvo) =>
  alvo === "folha" ? "salario" : String(alvo || "").startsWith("complemento:") ? "complemento" : String(alvo || "");
export const MEIOS_PAGAMENTO = ["Pix", "Transferência", "Dinheiro", "Boleto", "Outro"];
export const STATUS_PAGAMENTO = { pendente: "Pendente", confirmado: "Confirmado", cancelado: "Cancelado" };

export function validarPagamento(p, alvosPermitidos = null) {
  const erros = [];
  const valor = Math.trunc(p?.valorCentavos || 0);
  if (!(valor > 0)) erros.push("O valor do pagamento precisa ser maior que zero.");
  if (!lerData(p?.data)) erros.push("Informe a data efetiva do pagamento.");
  const aloc = (p?.alocacoes || []).filter(Boolean);
  if (!aloc.length) erros.push("Aloque o pagamento a pelo menos um valor devido.");
  const vistos = new Set();
  for (const a of aloc) {
    if (!(Math.trunc(a.valorCentavos || 0) > 0)) erros.push("Cada alocação precisa ter valor maior que zero.");
    if (alvosPermitidos && !alvosPermitidos.includes(a.alvo)) erros.push(`Alocação para um valor devido que não existe: ${a.alvo}.`);
    if (vistos.has(a.alvo)) erros.push("A mesma transferência não pode alocar duas vezes ao mesmo valor devido.");
    vistos.add(a.alvo);
  }
  const soma = somaCentavos(aloc, (a) => Math.trunc(a.valorCentavos || 0));
  if (aloc.length && valor > 0 && soma !== valor) {
    erros.push(`As alocações somam ${formatarBRL(soma)}, mas a transferência é de ${formatarBRL(valor)}. Precisam fechar exatamente — senão a transferência seria contada a mais ou a menos.`);
  }
  return { valido: erros.length === 0, erros: [...new Set(erros)] };
}

/** Quanto já foi pago a um alvo — só pagamentos CONFIRMADOS contam. */
export function pagoPara(pagamentos, alvo) {
  return somaCentavos((pagamentos || []).filter((p) => p && p.status === "confirmado"),
    (p) => somaCentavos((p.alocacoes || []).filter((a) => a && a.alvo === alvo), (a) => Math.trunc(a.valorCentavos || 0)));
}

/** Ajustes aprovados, sem duplicar: dois ajustes com a mesma referência (ex.: a
 *  mesma falta) contam uma vez só. */
export function ajustesValidos(ajustes) {
  const vistos = new Set(), out = [];
  for (const a of ajustes || []) {
    if (!a || a.status !== "aprovado") continue;
    const k = a.ref ? `ref:${a.ref}` : `id:${a.id}`;
    if (vistos.has(k)) continue;
    vistos.add(k); out.push(a);
  }
  return out;
}

/** Saldos do funcionário na competência.
 *   saldo da folha        = líquido oficial − pagamentos alocados à folha
 *   saldo complementar    = complemento APROVADO − pagamentos alocados a ele
 *   saldo salarial        = folha + complementos + ajustes aprovados − pagos
 *   VT e VR               = calculados à parte; só entram numa transferência se
 *                           forem alocados explicitamente
 *  `liquidoOficialCentavos: null` = sem folha contábil → é PRÉVIA, nunca o salário
 *  do cadastro fazendo papel de líquido. Saldo negativo é EXCEDENTE e aparece. */
export function calcularSaldos({ liquidoOficialCentavos = null, complementos = [], ajustes = [], pagamentos = [], vt = null, vr = null } = {}) {
  const temFolha = liquidoOficialCentavos !== null && liquidoOficialCentavos !== undefined;
  const folhaPago = pagoPara(pagamentos, "folha");
  const folha = {
    devidoCentavos: temFolha ? Math.trunc(liquidoOficialCentavos) : null,
    pagoCentavos: folhaPago,
    saldoCentavos: temFolha ? Math.trunc(liquidoOficialCentavos) - folhaPago : null,
  };
  const comps = (complementos || []).filter((c) => c && c.status === "aprovado").map((c) => {
    const devido = Math.trunc(c.totalCentavos || 0);
    const pago = pagoPara(pagamentos, `complemento:${c.id}`);
    return { id: c.id, devidoCentavos: devido, pagoCentavos: pago, saldoCentavos: devido - pago };
  });
  const aj = ajustesValidos(ajustes);
  const ajustesCentavos = somaCentavos(aj, (a) => Math.trunc(a.valorCentavos || 0));
  const salarialDevido = (temFolha ? folha.devidoCentavos : 0) + somaCentavos(comps, (c) => c.devidoCentavos) + ajustesCentavos;
  const salarialPago = folhaPago + somaCentavos(comps, (c) => c.pagoCentavos);
  const salarialSaldo = salarialDevido - salarialPago;
  const beneficio = (b, alvo) => {
    if (!b) return null;
    const devido = b.devidoCentavos === null || b.devidoCentavos === undefined ? null : Math.trunc(b.devidoCentavos);
    const pago = pagoPara(pagamentos, alvo) + Math.trunc(b.pagoForaDoRepasseCentavos || 0);
    return { devidoCentavos: devido, pagoCentavos: pago, saldoCentavos: devido === null ? null : devido - pago };
  };
  const excedentes = [];
  if (temFolha && folha.saldoCentavos < 0) excedentes.push({ alvo: "folha", valorCentavos: -folha.saldoCentavos });
  for (const c of comps) if (c.saldoCentavos < 0) excedentes.push({ alvo: `complemento:${c.id}`, valorCentavos: -c.saldoCentavos });
  return {
    previa: !temFolha, folha, complementos: comps, ajustesCentavos,
    salarial: { devidoCentavos: salarialDevido, pagoCentavos: salarialPago, saldoCentavos: salarialSaldo },
    vt: beneficio(vt, "vt"), vr: beneficio(vr, "vr"),
    excedentes,
  };
}

// ─── 9. IMPORTAÇÃO IDEMPOTENTE ───────────────────────────────────────────────

/** Identidade estável de um registro importado. CPF primeiro: é o que o banco já
 *  garante como único por competência (unique(competencia, cpf)). Sem CPF, a
 *  matrícula dentro da mesma empresa (CNPJ). Sem nenhum dos dois não há como
 *  garantir que reimportar não duplica → null, e o registro vai para revisão. */
export function chaveExtrato({ cnpj, competencia, matricula, cpf }) {
  const doc = String(cpf ?? "").replace(/\D/g, "");
  const mat = String(matricula ?? "").trim();
  const c = String(cnpj ?? "").replace(/\D/g, "");
  if (!competencia) return null;
  if (doc) return `${competencia}|cpf:${doc}`;
  if (mat) return `${competencia}|${c || "sem-cnpj"}|mat:${mat}`;
  return null;
}
/** Assinatura das verbas: muda se qualquer código, natureza ou valor mudar. */
export function assinaturaEventos(eventos) {
  return (eventos || []).map((e) => `${String(e.codigo ?? "").trim()}|${e.tipo}|${centavos(e.valor)}`).sort().join(";");
}
const CAMPOS_COMPARADOS = ["nome", "situacao", "salario_base", "proventos", "descontos", "liquido", "base_inss", "base_fgts", "valor_fgts", "base_irrf"];
const NUMERICOS = new Set(["salario_base", "proventos", "descontos", "liquido", "base_inss", "base_fgts", "valor_fgts", "base_irrf"]);
const normNomeImport = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** Diz o que uma nova importação faria, SEM fazer: inserir, atualizar (com o que
 *  mudou), deixar como está, mandar para revisão por falta de chave, ou barrar
 *  porque o mesmo CPF já está gravado em OUTRA empresa nessa competência. */
export function planejarImportacao({ existentes = [], novos = [] }) {
  const porChave = new Map();
  for (const e of existentes) { const k = chaveExtrato(e); if (k) porChave.set(k, e); }
  const plano = { inserir: [], atualizar: [], inalterados: [], semChave: [], duplicadosNoArquivo: [], conflitoEmpresa: [] };
  const vistosNoArquivo = new Set();
  const usados = new Set();
  const dig = (s) => String(s ?? "").replace(/\D/g, "");
  const mat = (x) => String(x?.matricula ?? "").trim();
  // Registro já gravado SEM o identificador que o novo traz (importado por um layout sem CPF, ou antes da
  // coluna matrícula existir no banco): casa só pelo NOME EXATO, na mesma competência e empresa, sem
  // identificador em conflito — e só se houver UM candidato. Sem isso, cada reimportação duplicaria a pessoa.
  const candidatosPorNome = (n) => {
    const nome = normNomeImport(n.nome);
    if (!nome) return [];
    return existentes.filter((e) => !usados.has(e) && e.competencia === n.competencia && normNomeImport(e.nome) === nome &&
      (!dig(e.cnpj) || !dig(n.cnpj) || dig(e.cnpj) === dig(n.cnpj)) &&
      // Empresa também: dois homônimos em empresas diferentes, ambos sem CPF/matrícula gravados,
      // seriam casados só pelo nome — um levaria a folha do outro.
      (!e.empresa || !n.empresa || String(e.empresa).trim() === String(n.empresa).trim()) &&
      (!dig(e.cpf) || !dig(n.cpf)) && (!mat(e) || !mat(n) || mat(e) === mat(n)));
  };
  for (const n of novos) {
    const k = chaveExtrato(n);
    if (!k) { plano.semChave.push(n); continue; }
    if (vistosNoArquivo.has(k)) { plano.duplicadosNoArquivo.push(n); continue; }
    vistosNoArquivo.add(k);
    let antes = porChave.get(k);
    if (antes && usados.has(antes)) antes = null;
    let viaNome = false;
    if (!antes) {
      const cands = candidatosPorNome(n);
      if (cands.length > 1) { plano.semChave.push(n); continue; }
      if (cands.length === 1) { antes = cands[0]; viaNome = true; }
    }
    if (!antes) { plano.inserir.push({ chave: k, depois: n }); continue; }
    usados.add(antes);
    if (dig(antes.cnpj) && dig(n.cnpj) && dig(antes.cnpj) !== dig(n.cnpj)) { plano.conflitoEmpresa.push({ chave: k, antes, depois: n }); continue; }
    const mudou = CAMPOS_COMPARADOS.filter((f) => (NUMERICOS.has(f)
      ? centavos(antes[f]) !== centavos(n[f])
      : String(antes[f] ?? "").trim() !== String(n[f] ?? "").trim()));
    // Arquivo que não traz verbas (só totais) não "apaga" as verbas já gravadas: só compara quando traz.
    if (Array.isArray(antes.eventos) && Array.isArray(n.eventos) && n.eventos.length && assinaturaEventos(antes.eventos) !== assinaturaEventos(n.eventos)) mudou.push("eventos");
    if (mudou.length) plano.atualizar.push({ chave: k, antes, depois: n, campos: mudou, viaNome });
    else plano.inalterados.push({ chave: k, antes, depois: n, viaNome });
  }
  return plano;
}

/** Confere os totais: por funcionário (proventos − descontos = líquido) e o total
 *  geral contra a SOMA dos funcionários — sem somar de novo o resumo do PDF. */
export function conferirTotais(registros, totalGeral = null) {
  const porFuncionario = (registros || []).map((r) => {
    const p = centavos(r.proventos), d = centavos(r.descontos), l = centavos(r.liquido);
    return { chave: r.matricula || r.cpf || r.nome, nome: r.nome, proventosMenosDescontos: p - d, liquido: l, bate: p - d === l };
  });
  const soma = {
    proventos: somaCentavos(registros, (r) => centavos(r.proventos)),
    descontos: somaCentavos(registros, (r) => centavos(r.descontos)),
    liquido: somaCentavos(registros, (r) => centavos(r.liquido)),
  };
  const geral = totalGeral ? { proventos: centavos(totalGeral.proventos), descontos: centavos(totalGeral.descontos), liquido: centavos(totalGeral.liquido) } : null;
  return {
    porFuncionario, divergentes: porFuncionario.filter((x) => !x.bate), soma, geral,
    geralCoerente: geral ? geral.proventos - geral.descontos === geral.liquido : null,
    somaBateComGeral: geral ? soma.proventos === geral.proventos && soma.descontos === geral.descontos && soma.liquido === geral.liquido : null,
  };
}

/** Vínculo com o cadastro por identificador CONFIÁVEL: CPF, ou matrícula dentro da
 *  MESMA empresa. Nome parecido nunca vincula sozinho — vira só sugestão. */
export function vincularFuncionario(registro, funcionarios, { empresa = "" } = {}) {
  const cpf = String(registro?.cpf ?? "").replace(/\D/g, "");
  const mat = String(registro?.matricula ?? "").trim();
  const lista = funcionarios || [];
  const mesmaEmpresa = (f) => !empresa || !f.empresa || f.empresa === empresa;
  if (cpf) {
    const porCpf = lista.filter((f) => String(f.cpf ?? "").replace(/\D/g, "") === cpf);
    if (porCpf.length === 1) return { funcionario: porCpf[0], via: "cpf", ambiguo: false, sugestoes: [] };
    if (porCpf.length > 1) {
      const naEmpresa = porCpf.filter(mesmaEmpresa);
      if (naEmpresa.length === 1) return { funcionario: naEmpresa[0], via: "cpf+empresa", ambiguo: false, sugestoes: [] };
      return { funcionario: null, via: null, ambiguo: true, sugestoes: porCpf };
    }
  }
  if (mat) {
    const porMat = lista.filter((f) => String(f.matricula ?? "").trim() === mat && mesmaEmpresa(f));
    if (porMat.length === 1 && empresa) return { funcionario: porMat[0], via: "matricula+empresa", ambiguo: false, sugestoes: [] };
    if (porMat.length) return { funcionario: null, via: null, ambiguo: porMat.length > 1 || !empresa, sugestoes: porMat };
  }
  const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const nome = norm(registro?.nome);
  const sugestoes = nome ? lista.filter((f) => norm(f.nome) === nome) : [];
  return { funcionario: null, via: null, ambiguo: false, sugestoes };
}

// ─── 10. REFERÊNCIA DECLARADA (ex.: "gastei R$ 22.312,21 em agosto") ──────────
// Um valor informado é REFERÊNCIA, não total calculado nem pagamento comprovado.
// Só é comparado depois que o escopo estiver confirmado, e a diferença nunca é
// forçada a zero nem distribuída entre funcionários.

export const ESCOPO_REFERENCIA = [
  { campo: "ano", rotulo: "Ano" },
  { campo: "mes", rotulo: "Mês" },
  { campo: "base", rotulo: "Mês trabalhado ou mês em que os pagamentos aconteceram" },
  { campo: "empresas", rotulo: "Empresas abrangidas" },
  { campo: "incluiAdiantamentos", rotulo: "Inclui adiantamentos?" },
  { campo: "incluiComplementos", rotulo: "Inclui complementos?" },
  { campo: "incluiProLabore", rotulo: "Inclui pró-labore?" },
  { campo: "incluiRescisoes", rotulo: "Inclui rescisões?" },
  { campo: "incluiVT", rotulo: "Inclui vale-transporte?" },
  { campo: "incluiVR", rotulo: "Inclui vale-refeição?" },
  { campo: "incluiAvulsos", rotulo: "Inclui pagamentos avulsos (Pagamento Diário)?" },
  { campo: "incluiTreinamento", rotulo: "Inclui pagamentos de treinamento?" },
];
export function faltandoNoEscopo(escopo = {}) {
  return ESCOPO_REFERENCIA.filter(({ campo }) => {
    const v = escopo?.[campo];
    if (campo === "empresas") return !Array.isArray(v) || v.length === 0;
    if (campo === "base") return v !== "mes_trabalhado" && v !== "mes_pagamento";
    if (campo === "ano") return !(Number(v) > 2000);
    if (campo === "mes") return !(Number(v) >= 1 && Number(v) <= 12);
    return typeof v !== "boolean";
  }).map((x) => x.rotulo);
}
function motivoForaDoEscopo(item, e) {
  const alvoComp = `${e.ano}-${String(e.mes).padStart(2, "0")}`;
  const comp = e.base === "mes_pagamento" ? competenciaDe(item.data) : (item.competencia || competenciaDe(item.data));
  if (comp !== alvoComp) return `fora do período (${e.base === "mes_pagamento" ? "pago em" : "trabalhado em"} ${comp || "?"})`;
  if (!e.empresas.includes(item.empresa)) return `empresa fora do escopo (${item.empresa || "sem empresa"})`;
  const regra = { adiantamento: "incluiAdiantamentos", complemento: "incluiComplementos", pro_labore: "incluiProLabore", rescisao: "incluiRescisoes", vt: "incluiVT", vr: "incluiVR", avulso: "incluiAvulsos", treinamento: "incluiTreinamento" }[item.categoria];
  if (regra && !e[regra]) return `${item.categoria} excluído do escopo`;
  return null;
}
/** `itens`: pagamentos já achatados por alocação — [{ valorCentavos, categoria,
 *  data, competencia, empresa, status, descricao }]. */
export function avaliarReferencia({ valorCentavos, escopo = {}, itens = [] }) {
  const faltando = faltandoNoEscopo(escopo);
  if (faltando.length || !escopo?.confirmado) {
    return { status: "pendente_classificacao", referenciaCentavos: valorCentavos, confirmadoCentavos: null, diferencaCentavos: null,
      faltando: escopo?.confirmado ? faltando : faltando.length ? faltando : ["Confirmação do escopo"], incluidos: [], excluidos: [], pendentes: [] };
  }
  const incluidos = [], excluidos = [], pendentes = [];
  for (const it of itens) {
    if (it.status !== "confirmado") { pendentes.push({ ...it, motivo: "pagamento ainda não confirmado" }); continue; }
    const motivo = motivoForaDoEscopo(it, escopo);
    if (motivo) excluidos.push({ ...it, motivo }); else incluidos.push(it);
  }
  const confirmadoCentavos = somaCentavos(incluidos, (i) => Math.trunc(i.valorCentavos || 0));
  const diferencaCentavos = confirmadoCentavos - Math.trunc(valorCentavos || 0);
  return {
    status: !incluidos.length ? "sem_pagamentos" : diferencaCentavos === 0 ? "conciliada" : "divergente",
    referenciaCentavos: valorCentavos, confirmadoCentavos, diferencaCentavos, faltando: [], incluidos, excluidos, pendentes,
  };
}

// ─── 11. FECHAMENTO ──────────────────────────────────────────────────────────
/** Divergência não resolvida impede fechar — salvo exceção explícita, autorizada
 *  por alguém e com motivo. */
export function avaliarFechamento({ divergencias = [], excecao = null } = {}) {
  if (!divergencias.length) return { pode: true, comExcecao: false, motivo: "" };
  if (excecao && String(excecao.autorizadoPor || "").trim() && String(excecao.motivo || "").trim()) {
    return { pode: true, comExcecao: true, motivo: `Fechado com ${divergencias.length} divergência(s) por exceção autorizada.` };
  }
  return { pode: false, comExcecao: false, motivo: `${divergencias.length} divergência(s) não resolvida(s). Resolva ou registre uma exceção autorizada, com motivo.` };
}

// ─── 12. APOIO ÀS TELAS ──────────────────────────────────────────────────────

/** Salário em vigor numa data: o último registro com vigência até ela. Uma mudança
 *  futura nunca altera um período que já passou. `null` = sem salário conhecido. */
export function salarioVigenteEm(historico, dataISO) {
  const validos = (historico || []).filter((h) => h && lerData(h.vigenciaInicio) && h.vigenciaInicio <= dataISO)
    .sort((a, b) => a.vigenciaInicio.localeCompare(b.vigenciaInicio));
  return validos.length ? Math.trunc(validos[validos.length - 1].salarioCentavos) : null;
}

/** Pagamentos de benefício (VT/VR) que pertencem à competência. Cada pagamento conta em UMA
 *  competência só — a do início do período coberto (ou a da data, quando não há período).
 *  Antes o critério era "início OU fim caem no mês", e um VR de 28/07 a 10/08 era somado inteiro
 *  em julho E em agosto: o pago aparecia maior do que foi, nos dois meses. Estornados não contam. */
export const competenciaDoPagamentoBeneficio = (p) => String(p?.periodo_de || p?.data || p?.periodo_ate || "").slice(0, 7);
export function pagoBeneficioNaCompetencia(pagamentos, comp) {
  const noMes = (pagamentos || []).filter((p) => p && p.status !== "cancelado" && competenciaDoPagamentoBeneficio(p) === comp);
  return { pagoCentavos: somaCentavos(noMes, (p) => centavos(p.valor)), itens: noMes };
}

/** Falta já lançada (Atestados e Faltas) que pertence à competência — SÓ a parte de SALÁRIO.
 *  VT e VR têm controle próprio e não saem do vale. A linha pode estar marcada no mês da ausência
 *  (compFalta) ou no mês em que foi lançada (competencia): as duas contam. */
export const CATEGORIAS_FALTA_NO_VALE = ["Salário", "Horas"];
export function descontoFaltaNoVale(faltas, comp) {
  const doMes = (faltas || []).filter((p) => p && CATEGORIAS_FALTA_NO_VALE.includes(p.categoria) &&
    [p.compFalta, p.competencia].filter(Boolean).includes(comp));
  return { descontoCentavos: somaCentavos(doMes, (p) => centavos(p.valor)), itens: doMes };
}
/** Quem desconta falta no VALE: só os contratos que a empresa paga direto — Estágio e PJ.
 *  CLT não: quem desconta a falta é a folha da contabilidade, e tirar do vale também seria tirar
 *  duas vezes. Treinamento não: o cálculo de lá já é por dias realmente trabalhados.
 *  Os demais contratos seguem a regra conservadora (não descontam) até alguém decidir o contrário. */
export const CONTRATOS_VALE_DESCONTA_FALTA = ["Estágio", "PJ"];
export function valeDescontaFalta(tipoContrato) {
  return CONTRATOS_VALE_DESCONTA_FALTA.includes(String(tipoContrato || "").trim());
}
/** Vale (adiantamento) ainda NÃO pago já sai com a falta descontada: quem faltou recebe menos no
 *  dia do vale, sem ninguém precisar lembrar de ajustar. Nunca fica negativo, e o que já foi pago
 *  não muda — o que saiu, saiu (a diferença aparece na conferência da Folha de Repasse). */
export function valeComDesconto(previstoCentavos, descontoCentavos) {
  return Math.max(Math.trunc(previstoCentavos || 0) - Math.trunc(descontoCentavos || 0), 0);
}

export const STATUS_PAGAMENTO_REPASSE = {
  previa: { txt: "Prévia — sem folha", cls: "bg-slate-100 text-slate-600" },
  sem_valor: { txt: "Nada a pagar", cls: "bg-slate-100 text-slate-500" },
  pendente: { txt: "Pendente", cls: "bg-amber-50 text-amber-700" },
  parcial: { txt: "Parcial", cls: "bg-blue-50 text-blue-700" },
  pago: { txt: "Pago", cls: "bg-emerald-50 text-emerald-700" },
  credito: { txt: "Pago a mais (crédito)", cls: "bg-rose-50 text-rose-700" },
};
/** Situação do PAGAMENTO — separada da situação da CONFERÊNCIA. */
export function statusPagamento(s) {
  // Pelo saldo TOTAL: um alvo pago a mais com outro ainda em aberto não é "crédito" — é parcial,
  // e o excedente daquele alvo continua apontado como divergência (listarDivergencias).
  const { devidoCentavos: dev, pagoCentavos: pago, saldoCentavos: saldo } = s.salarial;
  if (s.previa && dev === 0 && pago === 0) return "previa";
  if (saldo < 0) return "credito";
  if (dev <= 0 && pago === 0) return "sem_valor";
  if (saldo === 0) return "pago";
  return pago > 0 ? "parcial" : "pendente";
}

/** Tudo o que precisa de revisão antes de fechar, numa lista só. `bloqueia: false`
 *  = aviso que não impede o fechamento. */
export function listarDivergencias(x = {}) {
  const out = [];
  const add = (codigo, texto, bloqueia = true) => out.push({ codigo, texto, bloqueia });
  if (x.semVerbas) add("sem_verbas", "As verbas deste extrato não foram lidas: não dá para conferir adiantamento nem faltas.");
  if (x.totaisBatem === false) add("totais", "Proventos − descontos não fecha com o líquido impresso no PDF.");
  if (x.eventosNaoReconhecidos && x.eventosNaoReconhecidos.length) {
    add("eventos", `Evento(s) sem significado cadastrado: ${[...new Set(x.eventosNaoReconhecidos.map((e) => e.codigo))].join(", ")}. Confira antes de fechar.`);
  }
  if (x.adiantamento && ["divergente", "pendente_mapeamento"].includes(x.adiantamento.status)) add("adiantamento", x.adiantamento.mensagem);
  if (x.adiantamento && x.adiantamento.status === "confirmar_pagamento") add("adiantamento_pdf", x.adiantamento.mensagem, false);
  if (x.faltas && ["divergente", "sem_verbas"].includes(x.faltas.status) && x.faltas.crmCentavos) add("faltas", x.faltas.mensagem);
  for (const c of x.complementos || []) if (c.pendenteRevisao) add("sobreposicao", `Complemento ${c.rotulo}: ${c.motivo}`);
  for (const s of x.entreComplementos || []) add("complementos_sobrepostos", `Dois complementos cobrem os mesmos dias (${s.inicio} a ${s.fim}).`);
  if (x.reconferir) add("reconferir", "A folha foi revisada depois da conferência — confira de novo.");
  for (const e of x.excedentes || []) add("excedente", `Pago a mais: ${formatarBRL(e.valorCentavos)}. Fica como crédito até ser resolvido.`);
  if (x.legadoSemValor) add("legado", "Marcado como pago no fluxo anterior, sem o valor pago confirmado.");
  if (x.rescisao) add("rescisao", x.rescisao, false);
  return out;
}

/** Totais de um conjunto de linhas da Folha de Repasse. A MESMA função alimenta os
 *  cards, o rodapé da tabela e a exportação — assim os três sempre concordam com o
 *  filtro aplicado. `null` (sem folha) não vira zero: é contado à parte. */
export function resumirLinhasRepasse(linhas) {
  const t = { linhas: 0, comFolha: 0, previas: 0, liquidoContabilCentavos: 0, complementosCentavos: 0, ajustesCentavos: 0,
    devidoCentavos: 0, pagoCentavos: 0, saldoPendenteCentavos: 0, creditoCentavos: 0,
    vtDevidoCentavos: 0, vtPagoCentavos: 0, vrDevidoCentavos: 0, vrPagoCentavos: 0, divergencias: 0, comDivergencia: 0 };
  for (const l of linhas || []) {
    t.linhas++;
    if (l.liquidoCentavos === null || l.liquidoCentavos === undefined) t.previas++;
    else { t.comFolha++; t.liquidoContabilCentavos += l.liquidoCentavos; }
    t.complementosCentavos += l.complementosCentavos || 0;
    t.ajustesCentavos += l.ajustesCentavos || 0;
    t.devidoCentavos += l.devidoCentavos || 0;
    t.pagoCentavos += l.pagoCentavos || 0;
    if ((l.saldoCentavos || 0) > 0) t.saldoPendenteCentavos += l.saldoCentavos;
    if ((l.saldoCentavos || 0) < 0) t.creditoCentavos += -l.saldoCentavos;
    t.vtDevidoCentavos += l.vtDevidoCentavos || 0; t.vtPagoCentavos += l.vtPagoCentavos || 0;
    t.vrDevidoCentavos += l.vrDevidoCentavos || 0; t.vrPagoCentavos += l.vrPagoCentavos || 0;
    t.divergencias += l.divergencias || 0;
    if (l.divergencias) t.comDivergencia++;
  }
  return t;
}
