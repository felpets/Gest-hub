// Testes das regras da folha (src/modulos/rh/folha/regras.js) — rodam direto no Node, sem navegador.
// Uso: node scripts/rh/testar-regras.mjs   (também roda dentro do `npm test`)
//
// Os valores vêm do Extrato Mensal REAL de 07/2026 da LAPORTEC (emissão 06/08/2026).
// Só entram matrícula e números — nenhum nome, nenhum CPF.
import * as R from "../../src/modulos/rh/folha/regras.js";

const res = [];
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const t = (g, nome, got, exp) => res.push({ g, nome, got, exp, ok: igual(got, exp) });

// ── Fixture: os 21 registros do PDF 07/2026 (P = proventos, D = descontos, L = líquido) ──
const CNPJ = "51.856.008/0001-95";
const reg = (matricula, situacao, admissao, P, D, L, extra = {}) => ({
  matricula, cpf: `000000000${String(matricula).padStart(2, "0")}`.slice(-11), cnpj: CNPJ, competencia: "2026-07",
  situacao, admissao, vinculo: "Celetista", proventos: P, descontos: D, liquido: L, nome: `EMPR ${matricula}`, ...extra,
});
const ev = (codigo, tipo, valor, referencia = "") => ({ codigo, tipo: tipo === "P" ? "provento" : "desconto", valor, referencia_texto: referencia });
const EVENTOS = {
  12: [ev("8781", "P", 1980.00, "31,00"), ev("992", "P", 3.04, "0,00"), ev("998", "D", 153.88, "7,77"), ev("871", "D", 8.00, "8,00"), ev("993", "D", 4.16, "4,16"), ev("981", "D", 792.00, "792,00")],
  27: [ev("8781", "P", 1788.39, "28,00"), ev("8870", "P", 191.61, "3,00"), ev("992", "P", 4.92), ev("8794", "D", 63.87, "1,00"), ev("998", "D", 142.38), ev("871", "D", 8.00), ev("993", "D", 1.00), ev("981", "D", 792.00), ev("8792", "D", 63.87, "1,00"), ev("48", "D", 118.80, "6,00")],
  69: [ev("8781", "P", 638.71, "10,00"), ev("8870", "P", 63.87, "1,00"), ev("992", "P", 2.26), ev("998", "D", 52.69), ev("48", "D", 42.15, "6,00")],
  68: [ev("9180", "P", 894.19, "14,00"), ev("8130", "P", 441.88), ev("842", "D", 528.00), ev("826", "D", 54.36), ev("871", "D", 0.13), ev("981", "D", 459.87), ev("8792", "D", 63.87), ev("8069", "D", 105.39, "12:06"), ev("48", "D", 53.65), ev("203", "D", 70.80)],
  50: [ev("9180", "P", 1935.48), ev("8550", "P", 1041.67), ev("9592", "P", 208.33), ev("29", "P", 1041.67), ev("811", "P", 208.33), ev("8126", "P", 69.44), ev("8169", "P", 347.22), ev("9591", "P", 2500.00),
       ev("51", "D", 5734.37), ev("212", "D", 136.00), ev("826", "D", 149.87), ev("989", "D", 93.75), ev("993", "D", 1.27), ev("981", "D", 1000.00), ev("48", "D", 116.13), ev("203", "D", 120.75)],
  66: [ev("9180", "P", 1422.58), ev("8550", "P", 350.00), ev("29", "P", 175.00), ev("8169", "P", 58.33), ev("8130", "P", 1046.43),
       ev("212", "D", 217.60), ev("842", "D", 1680.00), ev("826", "D", 106.69), ev("989", "D", 26.25), ev("993", "D", 2.05), ev("981", "D", 840.00), ev("48", "D", 85.35), ev("203", "D", 94.40)],
  9: [ev("9380", "P", 1621.00, "31,00"), ev("843", "D", 178.31, "11,00")],
  5: [ev("8781", "P", 2100.00), ev("992", "P", 2.40), ev("201", "D", 131.84), ev("998", "D", 164.68), ev("993", "D", 4.88), ev("981", "D", 840.00), ev("48", "D", 126.00)],
};
const REGISTROS = [
  reg(12, "Trabalhando", "2024-10-03", 1983.04, 958.04, 1025.00),
  reg(50, "Demitido", "2026-02-19", 7352.14, 7352.14, 0),
  reg(27, "Trabalhando", "2025-10-07", 1984.92, 1189.92, 795.00),
  reg(69, "Trabalhando", "2026-07-21", 704.84, 94.84, 610.00),
  reg(64, "Demitido", "2026-05-07", 1956.94, 1956.94, 0),
  reg(52, "Trabalhando", "2026-02-25", 1983.94, 273.94, 1710.00),
  reg(72, "Trabalhando", "2026-07-29", 194.37, 14.37, 180.00),
  reg(36, "Demitido", "2025-11-21", 5625.97, 5625.97, 0),
  reg(67, "Trabalhando", "2026-06-17", 1982.24, 1077.24, 905.00),
  reg(61, "Trabalhando", "2026-04-30", 1983.99, 1073.99, 910.00),
  reg(20, "Trabalhando", "2025-04-14", 1984.30, 1074.30, 910.00),
  reg(70, "Trabalhando", "2026-07-23", 577.60, 77.60, 500.00),
  reg(5, "Trabalhando", "2024-06-24", 2102.40, 1267.40, 835.00),
  reg(57, "Trabalhando", "2026-04-16", 1984.14, 1074.14, 910.00),
  reg(71, "Trabalhando", "2026-07-24", 543.16, 73.16, 470.00),
  reg(60, "Trabalhando", "2026-04-30", 1981.01, 1076.01, 905.00),
  reg(66, "Demitido", "2026-06-10", 3052.34, 3052.34, 0),
  reg(68, "Demitido", "2026-07-14", 1336.07, 1336.07, 0),
  reg(38, "Trabalhando", "2025-11-25", 2115.86, 1170.86, 945.00),
  reg(59, "Trabalhando", "2026-04-30", 1981.37, 1076.37, 905.00),
  reg(9, "Trabalhando", "2025-09-01", 1621.00, 178.31, 1442.69, { vinculo: "Diretor" }),
].map((r) => ({ ...r, eventos: EVENTOS[r.matricula] || [], valor_fgts: 158.40 }));
const porMat = (m) => REGISTROS.find((r) => r.matricula === m);
// Cabeçalho do PDF, no formato em que o app reconstrói as linhas (agruparLinhasPdf).
const CABECALHO = [
  "Empresa: 30672 - LAPORTEC ASSESSORIA E CONSULTORIA LTDA Página: 1/6",
  "CNPJ: 51.856.008/0001-95 Emissão: 06/08/2026",
  "Cálculo: Folha Mensal Horas: 08:06:26",
  "Competência: 07/2026",
  "EXTRATO MENSAL",
  "Empr.: 12 EMPR 12 Situação: Trabalhando CPF: 000.000.000-12 Adm: 03/10/2024",
  "Empresa: 30672 - LAPORTEC ASSESSORIA E CONSULTORIA LTDA Página: 5/6",
  "Total Geral Proventos: 45.031,64 Total Geral Descontos: 31.073,95",
  "Líquido Geral: 13.957,69",
  "Empresa: 30672 - LAPORTEC ASSESSORIA E CONSULTORIA LTDA Página: 6/6",
].join("\n");
const MAPA = R.mapaEventos("extrato-mensal");
const MAPA_871_OK = R.mapaEventos("extrato-mensal", { 871: { confirmado: true } });
const pago = (valorCentavos, fonte) => ({ valorCentavos, fonte });

// ── 1-4. Calendário e proporcional ──
t("1. Proporcional", "1.980 ÷ 30 × 10 = 660,00", R.valorProporcional(198000, 10, 30), 66000);
t("2. Proporcional", "1.980 ÷ 31 × 10 = 638,71", R.valorProporcional(198000, 10, 31), 63871);
t("2. Proporcional", "bate com o evento 8781 real (10 dias em julho = 638,71)", R.centavos(EVENTOS[69][0].valor), R.valorProporcional(198000, 10, 31));
t("2. Proporcional", "a diária NÃO é arredondada antes: 7 dias ÷31 = 447,10 (e não 7 × 63,87 = 447,09)", R.valorProporcional(198000, 7, 31), 44710);
t("2. Proporcional", "diária só para exibição, com 8 casas", R.diariaExibicao(198000, 31), "R$ 63,87096774");
t("3. Mês cheio", "01/07 a 31/07 com salário 1.980 = 1.980,00 (31 dias ÷ 31)", R.calcularComplemento({ salarioMensalCentavos: 198000, inicio: "2026-07-01", fim: "2026-07-31" }).totalCentavos, 198000);
t("3. Mês cheio", "divisor 31 e 31 dias remunerados — separados", (({ divisor, diasRemunerados }) => [divisor, diasRemunerados])(R.calcularComplemento({ salarioMensalCentavos: 198000, inicio: "2026-07-01", fim: "2026-07-31" }).segmentos[0]), [31, 31]);
t("4. Fevereiro", "fev/2026 tem divisor 28", R.diasDaCompetencia("2026-02"), 28);
t("4. Fevereiro", "fev/2028 (bissexto) tem divisor 29", R.diasDaCompetencia("2028-02"), 29);
t("4. Fevereiro", "1.980 ÷ 28 × 10 = 707,14", R.valorProporcional(198000, 10, 28), 70714);
t("4. Fevereiro", "1.980 ÷ 29 × 10 = 682,76", R.valorProporcional(198000, 10, 29), 68276);
t("4. Fevereiro", "fevereiro cheio de 2026 = 1.980,00", R.calcularComplemento({ salarioMensalCentavos: 198000, inicio: "2026-02-01", fim: "2026-02-28" }).totalCentavos, 198000);
t("4. Fevereiro", "fevereiro cheio de 2028 = 1.980,00", R.calcularComplemento({ salarioMensalCentavos: 198000, inicio: "2028-02-01", fim: "2028-02-29" }).totalCentavos, 198000);
t("4. Fevereiro", "anos: 2000 bissexto, 2100 não, 2024 sim", [R.bissexto(2000), R.bissexto(2100), R.bissexto(2024)], [true, false, true]);
t("4. Fevereiro", "29/02/2026 não existe (data inválida)", R.lerData("2026-02-29"), null);

// ── 5. Período em dois meses ──
const multi = R.calcularComplemento({ salarioMensalCentavos: 198000, inicio: "2026-07-25", fim: "2026-08-05" });
t("5. Dois meses", "25/07 a 05/08 vira dois trechos: 7 dias ÷31 e 5 dias ÷31", multi.segmentos.map((s) => [s.competencia, s.diasRemunerados, s.divisor, s.valorCentavos]), [["2026-07", 7, 31, 44710], ["2026-08", 5, 31, 31935]]);
t("5. Dois meses", "total = soma dos trechos (447,10 + 319,35 = 766,45), sem ajuste artificial", multi.totalCentavos, 76645);
const janFev = R.calcularComplemento({ salarioMensalCentavos: 198000, inicio: "2026-01-25", fim: "2026-02-05" });
t("5. Dois meses", "25/01 a 05/02: janeiro ÷31 e fevereiro ÷28", janFev.segmentos.map((s) => [s.divisor, s.valorCentavos]), [[31, 44710], [28, 35357]]);
t("5. Dois meses", "virada de ano: 30/12 a 02/01 = 2 trechos (2 + 2 dias)", R.segmentarPorMes("2026-12-30", "2027-01-02").map((s) => [s.competencia, s.diasCorridos]), [["2026-12", 2], ["2027-01", 2]]);
t("5. Dois meses", "dias corridos contam início e fim: 21/07 a 31/07 = 11", R.diasCorridos("2026-07-21", "2026-07-31"), 11);

// ── 6-8. Complementos × folha oficial ──
const compSemFolha = R.conferirSobreposicaoComFolha({ inicio: "2026-08-01", fim: "2026-08-10" }, [{ competencia: "2026-07", admissao: "2026-07-21" }]);
t("6. Sem folha", "complemento em mês sem folha importada fica 'sem_folha' (reabre quando a folha chegar)", compSemFolha.map((s) => s.situacao), ["sem_folha"]);
const saldoSemFolha = R.calcularSaldos({ liquidoOficialCentavos: null, complementos: [{ id: "c1", status: "aprovado", totalCentavos: 63871 }] });
t("6. Sem folha", "sem folha contábil = PRÉVIA", saldoSemFolha.previa, true);
t("6. Sem folha", "sem folha, o saldo da folha fica PENDENTE (null) — nunca zero", [saldoSemFolha.folha.devidoCentavos, saldoSemFolha.folha.saldoCentavos], [null, null]);
t("6. Sem folha", "o complemento aprovado continua devido mesmo sem folha", saldoSemFolha.salarial.devidoCentavos, 63871);
t("6. Sem folha", "salário do cadastro NUNCA entra como líquido (não é parâmetro de calcularSaldos)", R.calcularSaldos({ liquidoOficialCentavos: null }).salarial.devidoCentavos, 0);
const caue = porMat(69);
const semSobrep = R.conferirSobreposicaoComFolha({ inicio: "2026-07-14", fim: "2026-07-20" }, [{ competencia: "2026-07", admissao: caue.admissao }]);
t("7. Folha + complemento", "14/07 a 20/07 termina antes da admissão da folha (21/07): sem sobreposição", semSobrep.map((s) => s.situacao), ["sem_sobreposicao"]);
const s7 = R.calcularSaldos({ liquidoOficialCentavos: R.centavos(caue.liquido), complementos: [{ id: "c1", status: "aprovado", totalCentavos: 44710 }] });
t("7. Folha + complemento", "devido = líquido oficial 610,00 + complemento 447,10 = 1.057,10", s7.salarial.devidoCentavos, 105710);
t("7. Folha + complemento", "complemento em rascunho não entra no devido", R.calcularSaldos({ liquidoOficialCentavos: 61000, complementos: [{ id: "c1", status: "a_conferir", totalCentavos: 44710 }] }).salarial.devidoCentavos, 61000);
const comSobrep = R.conferirSobreposicaoComFolha({ inicio: "2026-07-14", fim: "2026-07-25" }, [{ competencia: "2026-07", admissao: caue.admissao }]);
t("8. Sobreposição", "14/07 a 25/07 cruza a admissão: possível sobreposição", comSobrep[0].situacao, "possivel_sobreposicao");
t("8. Sobreposição", "o motivo aponta a data da admissão", comSobrep[0].motivo.includes("2026-07-21"), true);
t("8. Sobreposição", "PDF com admissão antiga: não há como provar quais dias, então pede revisão", R.conferirSobreposicaoComFolha({ inicio: "2026-07-01", fim: "2026-07-05" }, [{ competencia: "2026-07", admissao: "2024-10-03" }])[0].situacao, "possivel_sobreposicao");
const entre = R.sobreposicoesEntreComplementos([
  { id: "a", status: "aprovado", inicio: "2026-07-01", fim: "2026-07-10" },
  { id: "b", status: "rascunho", inicio: "2026-07-10", fim: "2026-07-15" },
  { id: "c", status: "cancelado", inicio: "2026-07-01", fim: "2026-07-31" },
]);
t("8. Sobreposição", "complementos que dividem o dia 10/07 são barrados; cancelado não conta", entre, [{ a: "a", b: "b", inicio: "2026-07-10", fim: "2026-07-10" }]);
t("8. Sobreposição", "sem a data no PDF, a revisão é pedida e não inventada", R.conferirSobreposicaoComFolha({ inicio: "2026-07-01", fim: "2026-07-05" }, [{ competencia: "2026-07" }])[0].situacao, "possivel_sobreposicao");

// ── 9-10. Adiantamento ──
const ale = porMat(12);
const adi1 = R.conciliarAdiantamento({ eventos: ale.eventos, mapa: MAPA, pagos: [pago(80000)] });
t("9. Adiantamento", "981 (792,00) + 871 (8,00) = 800 pago — antes de confirmar o 871: pendente de mapeamento", [adi1.status, adi1.naFolhaCentavos, adi1.aConfirmarCentavos], ["pendente_mapeamento", 79200, 800]);
const adi2 = R.conciliarAdiantamento({ eventos: ale.eventos, mapa: MAPA_871_OK, pagos: [pago(80000)] });
t("9. Adiantamento", "com o 871 confirmado: 792 + 8 = 800 = pago → conciliado", [adi2.status, adi2.naFolhaCentavos, adi2.diferencaCentavos], ["conciliado", 80000, 0]);
t("9. Adiantamento", "trocos 992/993 NÃO entram no adiantamento (só 981 e 871)", adi2.composicao.map((c) => c.codigo).sort(), ["871", "981"]);
t("9. Adiantamento", "rescisão real: 459,87 + 0,13 = 460,00", R.conciliarAdiantamento({ eventos: porMat(68).eventos, mapa: MAPA_871_OK, pagos: [pago(46000)] }).status, "conciliado");
t("9. Adiantamento", "sem 871 no PDF: 981 de 840,00 = 840 pago → conciliado", R.conciliarAdiantamento({ eventos: porMat(5).eventos, mapa: MAPA, pagos: [pago(84000)] }).status, "conciliado");
t("9. Adiantamento", "'pago' criado pela importação do próprio PDF pede confirmação", R.conciliarAdiantamento({ eventos: ale.eventos, mapa: MAPA_871_OK, pagos: [pago(80000, "pdf")] }).status, "confirmar_pagamento");
t("10. Adiantamento na folha", "o líquido já vem sem o adiantamento: saldo da folha = 1.025,00", R.calcularSaldos({ liquidoOficialCentavos: R.centavos(ale.liquido) }).folha.saldoCentavos, 102500);
const adiFora = R.conciliarAdiantamento({ eventos: caue.eventos, mapa: MAPA, pagos: [pago(80000)] });
t("10. Adiantamento na folha", "adiantamento pago que não aparece na folha → divergência", adiFora.status, "divergente");
t("10. Adiantamento na folha", "…e ele NÃO é descontado sozinho (a mensagem diz isso)", adiFora.mensagem.includes("NÃO é descontado"), true);
t("10. Adiantamento na folha", "…o saldo da folha continua o líquido: 610,00", R.calcularSaldos({ liquidoOficialCentavos: R.centavos(caue.liquido) }).folha.saldoCentavos, 61000);
t("10. Adiantamento na folha", "extrato sem verbas: não dá para conciliar (e não vira 'sem adiantamento')", R.conciliarAdiantamento({ temVerbas: false, pagos: [pago(80000)] }).status, "sem_verbas");

// ── 11-13. Pagamentos ──
const pg = (id, valorCentavos, alocacoes, status = "confirmado", data = "2026-08-05") => ({ id, data, valorCentavos, status, alocacoes });
const s11 = R.calcularSaldos({ liquidoOficialCentavos: 102500, pagamentos: [pg("p1", 50000, [{ alvo: "folha", valorCentavos: 50000 }])] });
t("11. Parcial", "pagou 500,00 de 1.025,00 → saldo 525,00", s11.folha.saldoCentavos, 52500);
t("11. Parcial", "situação do pagamento = parcial", R.statusPagamento(s11), "parcial");
const s12 = R.calcularSaldos({ liquidoOficialCentavos: 102500, pagamentos: [pg("p1", 110000, [{ alvo: "folha", valorCentavos: 110000 }])] });
t("12. Excedente", "pagou 1.100,00 de 1.025,00 → saldo −75,00 (não trunca em zero)", s12.folha.saldoCentavos, -7500);
t("12. Excedente", "o excedente aparece como crédito", [R.statusPagamento(s12), s12.excedentes], ["credito", [{ alvo: "folha", valorCentavos: 7500 }]]);
const s12b = R.calcularSaldos({ liquidoOficialCentavos: 102500, complementos: [{ id: "c1", status: "aprovado", totalCentavos: 44710 }], pagamentos: [pg("p1", 110000, [{ alvo: "folha", valorCentavos: 110000 }])] });
t("12. Excedente", "folha paga a mais com complemento em aberto: 1.025,00 + 447,10 − 1.100,00 = 372,10 → parcial (o excedente vira divergência)", [s12b.salarial.saldoCentavos, R.statusPagamento(s12b), s12b.excedentes.length], [37210, "parcial", 1]);
t("12. Excedente", "no resumo, crédito é somado à parte (não some)", R.resumirLinhasRepasse([{ liquidoCentavos: 102500, devidoCentavos: 102500, pagoCentavos: 110000, saldoCentavos: -7500 }]).creditoCentavos, 7500);
const transf = pg("p2", 110000, [{ alvo: "folha", valorCentavos: 102500 }, { alvo: "vt", valorCentavos: 7500 }]);
t("13. Várias alocações", "uma transferência de 1.100 = folha 1.025 + VT 75 é válida", R.validarPagamento(transf, ["folha", "vt"]).valido, true);
const s13 = R.calcularSaldos({ liquidoOficialCentavos: 102500, pagamentos: [transf], vt: { devidoCentavos: 7500 } });
t("13. Várias alocações", "folha quitada e VT quitado, sem contar a transferência duas vezes", [s13.folha.saldoCentavos, s13.vt.saldoCentavos, s13.salarial.pagoCentavos], [0, 0, 102500]);
t("13. Várias alocações", "alocações que não fecham com a transferência são recusadas", R.validarPagamento(pg("p3", 110000, [{ alvo: "folha", valorCentavos: 102500 }])).valido, false);
t("13. Várias alocações", "a mesma transferência não aloca duas vezes no mesmo alvo", R.validarPagamento(pg("p4", 100, [{ alvo: "folha", valorCentavos: 50 }, { alvo: "folha", valorCentavos: 50 }])).valido, false);
t("13. Várias alocações", "pagamento PENDENTE não conta como pago", R.calcularSaldos({ liquidoOficialCentavos: 102500, pagamentos: [pg("p5", 102500, [{ alvo: "folha", valorCentavos: 102500 }], "pendente")] }).folha.pagoCentavos, 0);
t("13. Várias alocações", "pagamento CANCELADO não conta como pago", R.calcularSaldos({ liquidoOficialCentavos: 102500, pagamentos: [pg("p6", 102500, [{ alvo: "folha", valorCentavos: 102500 }], "cancelado")] }).folha.pagoCentavos, 0);
t("13. Várias alocações", "sem data efetiva o pagamento é recusado", R.validarPagamento({ valorCentavos: 100, alocacoes: [{ alvo: "folha", valorCentavos: 100 }] }).valido, false);
t("13. Várias alocações", "VT fora do repasse também é visto (controle de benefícios)", R.calcularSaldos({ liquidoOficialCentavos: 0, vt: { devidoCentavos: 7500, pagoForaDoRepasseCentavos: 7500 } }).vt.saldoCentavos, 0);

// ── 14. Benefícios ──
const vt14 = R.resumoBeneficio({ concedidoCentavos: 20000, pagoCentavos: 20000, descontoImportadoCentavos: 11880 });
t("14. VT", "VT concedido 200,00 ≠ desconto de 6% 118,80 → sem alerta falso", vt14.alertas, []);
t("14. VT", "saldo do VT sai de concedido − pago, não do desconto", vt14.saldoCentavos, 0);
t("14. VR", "PDF sem desconto de VR não prova que não houve VR (desconto fica null, concedido continua)", (({ descontoImportadoCentavos, concedidoCentavos }) => [descontoImportadoCentavos, concedidoCentavos])(R.resumoBeneficio({ concedidoCentavos: 30000 })), [null, 30000]);
t("14. Benefício", "pagamentos de VR entram na competência pelo período coberto", R.pagoBeneficioNaCompetencia([{ valor: 150, periodo_de: "2026-07-01", periodo_ate: "2026-07-15" }, { valor: 150, data: "2026-08-01" }, { valor: 99, data: "2026-07-10", status: "cancelado" }], "2026-07").pagoCentavos, 15000);
const vrCruzado = [{ valor: 400, periodo_de: "2026-07-28", periodo_ate: "2026-08-10" }];
t("14. Benefício", "pagamento que cruza dois meses conta UMA vez (no mês do início), não nos dois", [R.pagoBeneficioNaCompetencia(vrCruzado, "2026-07").pagoCentavos, R.pagoBeneficioNaCompetencia(vrCruzado, "2026-08").pagoCentavos], [40000, 0]);

// ── 14b. Vale (adiantamento) com falta já lançada ──
const faltas3dias = [
  { categoria: "Salário", valor: 198.00, compFalta: "2026-07", competencia: "2026-07", descricao: "Desconto de falta — Salário (3 dias)" },
  { categoria: "VT", valor: 27.00, compFalta: "2026-07", competencia: "2026-07" },
  { categoria: "VR", valor: 81.60, compFalta: "2026-07", competencia: "2026-07" },
];
t("14b. Vale × falta", "só a parte de SALÁRIO entra no desconto do vale (VT e VR não)", R.descontoFaltaNoVale(faltas3dias, "2026-07").descontoCentavos, 19800);
t("14b. Vale × falta", "vale de 800,00 com 3 faltas (198,00) sai 602,00 — já descontado", R.valeComDesconto(80000, R.descontoFaltaNoVale(faltas3dias, "2026-07").descontoCentavos), 60200);
t("14b. Vale × falta", "desconto de horas (falta parcial) também é salário", R.descontoFaltaNoVale([{ categoria: "Horas", valor: 105.39, competencia: "2026-07" }], "2026-07").descontoCentavos, 10539);
t("14b. Vale × falta", "falta do mês lançada na competência seguinte conta no mês da ausência", R.descontoFaltaNoVale([{ categoria: "Salário", valor: 66, compFalta: "2026-07", competencia: "2026-08" }], "2026-07").descontoCentavos, 6600);
t("14b. Vale × falta", "falta de outro mês não mexe no vale desta competência", R.descontoFaltaNoVale(faltas3dias, "2026-08").descontoCentavos, 0);
t("14b. Vale × falta", "desconto maior que o vale zera, nunca fica negativo", R.valeComDesconto(50000, 80000), 0);
t("14b. Vale × falta", "sem falta lançada, o vale continua inteiro", R.valeComDesconto(80000, 0), 80000);
t("14b. Vale × falta", "quem desconta falta no vale: Estágio e PJ", [R.valeDescontaFalta("Estágio"), R.valeDescontaFalta("PJ")], [true, true]);
t("14b. Vale × falta", "CLT NÃO desconta no vale (quem desconta é a folha da contabilidade)", R.valeDescontaFalta("CLT Ativo"), false);
t("14b. Vale × falta", "Treinamento NÃO desconta no vale (já é pago por dias trabalhados)", R.valeDescontaFalta("Treinamento"), false);
t("14b. Vale × falta", "contratos sem regra definida não descontam (Jovem Aprendiz, Temporário, Outro)", ["Jovem Aprendiz", "Temporário", "Outro", ""].map(R.valeDescontaFalta), [false, false, false, false]);

// ── 15. Reimportação ──
const plano0 = R.planejarImportacao({ existentes: REGISTROS, novos: REGISTROS });
t("15. Reimportação", "o mesmo PDF de novo: 21 sem mudança, nada inserido nem alterado", [plano0.inalterados.length, plano0.inserir.length, plano0.atualizar.length], [21, 0, 0]);
const revisado = REGISTROS.map((r) => (r.matricula === 12 ? { ...r, liquido: 1030.00, eventos: [...r.eventos.slice(0, 5), ev("981", "D", 787.00)] } : r));
const plano1 = R.planejarImportacao({ existentes: REGISTROS, novos: revisado });
t("15. Reimportação", "versão revisada: só quem mudou é atualizado, e diz o quê", plano1.atualizar.map((a) => [a.depois.matricula, a.campos]), [[12, ["liquido", "eventos"]]]);
t("15. Reimportação", "o plano nunca apaga nada (não existe lista de exclusão)", Object.keys(plano1).includes("remover") || Object.keys(plano1).includes("excluir"), false);
t("15. Reimportação", "mesmo CPF gravado em outra empresa não é sobrescrito: vai para revisão", R.planejarImportacao({ existentes: [porMat(12)], novos: [{ ...porMat(12), cnpj: "51.113.390/0001-47" }] }).conflitoEmpresa.length, 1);
t("15. Reimportação", "o mesmo CPF duas vezes no arquivo é barrado", R.planejarImportacao({ novos: [porMat(12), porMat(12)] }).duplicadosNoArquivo.length, 1);
t("15. Reimportação", "sem CPF e sem matrícula não há chave: vai para revisão", R.planejarImportacao({ novos: [{ competencia: "2026-07", nome: "X" }] }).semChave.length, 1);
t("15. Reimportação", "chave usa CPF primeiro (a mesma regra do banco)", R.chaveExtrato(porMat(12)), "2026-07|cpf:00000000012");
// Layout sem CPF (Folha Mensal) com o banco SEM a coluna matrícula (migração 0010 não rodada):
const semId = (r) => ({ ...r, cpf: "", matricula: "" });
const semCpf = (r) => ({ ...r, cpf: "", eventos: [] });
const planoSemId = R.planejarImportacao({ existentes: REGISTROS.map(semId), novos: REGISTROS.map(semCpf) });
t("15. Reimportação", "sem CPF e sem matrícula gravada: reimportar casa pelo nome exato e NÃO duplica", [planoSemId.inserir.length, planoSemId.inalterados.length, planoSemId.inalterados.every((x) => x.viaNome)], [0, 21, true]);
const planoMisto = R.planejarImportacao({ existentes: REGISTROS.map((r) => ({ ...r, matricula: "" })), novos: REGISTROS.map(semCpf) });
t("15. Reimportação", "gravado pelo PDF oficial (com CPF), reimportado por layout sem CPF: casa, sem duplicar", [planoMisto.inserir.length, planoMisto.inalterados.length], [0, 21]);
t("15. Reimportação", "arquivo só com totais não conta como mudança de verbas (não apaga as gravadas)", planoMisto.atualizar.length, 0);
const naEmpresa = (r, empresa) => ({ ...semId(r), empresa });
t("15. Reimportação", "homônimo em OUTRA empresa não é casado pelo nome (entra como novo, não sobrescreve)",
  R.planejarImportacao({ existentes: [naEmpresa(porMat(12), "Laportec")], novos: [{ ...semCpf(porMat(12)), empresa: "Avora" }] }).inserir.length, 1);
t("15. Reimportação", "mesmo nome na MESMA empresa, sem identificador gravado: casa e não duplica",
  R.planejarImportacao({ existentes: [naEmpresa(porMat(12), "Laportec")], novos: [{ ...semCpf(porMat(12)), empresa: "Laportec" }] }).inalterados.length, 1);
t("15. Reimportação", "dois gravados com o mesmo nome e sem identificador: não adivinha, vai para revisão",
  R.planejarImportacao({ existentes: [semId(porMat(12)), semId({ ...porMat(27), nome: "EMPR 12" })], novos: [semCpf(porMat(12))] }).semChave.length, 1);

// ── 16-17. Cabeçalho e totais do PDF ──
const cab = R.cabecalhoExtrato(CABECALHO);
t("16. Competência", "competência 07/2026 vem do campo, mesmo com emissão em agosto", [cab.competencia, cab.emissao], ["2026-07", "2026-08-06"]);
t("16. Competência", "empresa, CNPJ, cálculo e páginas do cabeçalho", [cab.empresa, cab.cnpj, cab.calculo, cab.paginas], ["LAPORTEC ASSESSORIA E CONSULTORIA LTDA", CNPJ, "Folha Mensal", 6]);
t("16. Competência", "sem campo 'Competência' não inventa (vazio)", R.competenciaDoCampo("Emissão: 06/08/2026"), "");
t("16. Competência", "página de um trecho = última marca 'Página: N/M' antes dele", R.paginaNoTexto(CABECALHO, CABECALHO.indexOf("Total Geral")), 5);
const tot = R.conferirTotais(REGISTROS, cab.totalGeral);
t("17. Totais", "soma dos 21 = 45.031,64 / 31.073,95 / 13.957,69", [tot.soma.proventos, tot.soma.descontos, tot.soma.liquido], [4503164, 3107395, 1395769]);
t("17. Totais", "a soma bate com o Total Geral impresso", tot.somaBateComGeral, true);
t("17. Totais", "o Total Geral é coerente (45.031,64 − 31.073,95 = 13.957,69)", tot.geralCoerente, true);
t("17. Totais", "cada registro fecha: proventos − descontos = líquido", tot.divergentes.length, 0);
t("17. Totais", "cada registro com verbas: soma das verbas = totais do rodapé", REGISTROS.filter((r) => r.eventos.length).every((r) =>
  R.somaCentavos(r.eventos.filter((e) => e.tipo === "provento"), (e) => R.centavos(e.valor)) === R.centavos(r.proventos) &&
  R.somaCentavos(r.eventos.filter((e) => e.tipo === "desconto"), (e) => R.centavos(e.valor)) === R.centavos(r.descontos)), true);
t("17. Totais", "um registro que não fecha é apontado", R.conferirTotais([{ matricula: 1, proventos: 100, descontos: 10, liquido: 80 }]).divergentes.length, 1);

// ── 18. Rescisão, pró-labore e informativos ──
const cls = (m) => R.classificarRegistro(porMat(m), porMat(m).eventos, MAPA);
t("18. Classificação", "Demitido com evento 51: rescisão, com o líquido da rescisão 5.734,37", [cls(50).tipo, cls(50).liquidoRescisaoCentavos], ["rescisao", 573437]);
t("18. Classificação", "rescisão SEM evento 51: valor da rescisão é desconhecido (null), não zero", [cls(66).tipo, cls(66).liquidoRescisaoCentavos, cls(66).estouroRescisaoCentavos], ["rescisao", null, 104643]);
t("18. Classificação", "Diretor com 9380: pró-labore, separado", cls(9).tipo, "pro_labore");
t("18. Classificação", "Trabalhando sem eventos de rescisão: mensal", cls(12).tipo, "mensal");
t("18. Classificação", "líquido 0,00 da rescisão não gera saldo salarial (a rescisão é paga no controle próprio)", R.calcularSaldos({ liquidoOficialCentavos: 0 }).salarial.devidoCentavos, 0);
t("18. Classificação", "FGTS é informativo: não entra em nenhuma soma de líquido", R.conferirTotais([{ proventos: 1983.04, descontos: 958.04, liquido: 1025, valor_fgts: 158.40 }]).soma.liquido, 102500);
t("18. Mapeamento", "201 é farmácia no Extrato Mensal…", R.papelDoEvento({ codigo: "201", tipo: "desconto" }, MAPA), "outro_desconto");
t("18. Mapeamento", "…e VR não utilizado no Analítico de Rescisão (mapa por layout)", R.papelDoEvento({ codigo: "201", tipo: "desconto" }, R.mapaEventos("analitico-rescisao")), "vr_nao_utilizado");
t("18. Mapeamento", "código desconhecido é apontado para conferência", R.eventosNaoReconhecidos([{ codigo: "7777", tipo: "desconto" }, ...ale.eventos], MAPA).map((e) => e.codigo), ["7777"]);
t("18. Mapeamento", "nenhum código real do PDF de julho fica sem mapeamento", REGISTROS.flatMap((r) => R.eventosNaoReconhecidos(r.eventos, MAPA)).length, 0);

// ── 19. R$ 22.312,21 ──
const REF = 2231221;
const escopoOk = { ano: 2026, mes: 8, base: "mes_pagamento", empresas: ["Laportec"], incluiAdiantamentos: true, incluiComplementos: true, incluiProLabore: false, incluiRescisoes: false, incluiVT: false, incluiVR: false, incluiAvulsos: false, incluiTreinamento: false, confirmado: true };
const r19a = R.avaliarReferencia({ valorCentavos: REF, escopo: {} });
t("19. 22.312,21", "sem escopo: 'pendente de classificação', sem total nem diferença", [r19a.status, r19a.confirmadoCentavos, r19a.diferencaCentavos], ["pendente_classificacao", null, null]);
t("19. 22.312,21", "lista o que falta decidir no escopo", r19a.faltando.length >= 10, true);
t("19. 22.312,21", "escopo preenchido mas não confirmado continua pendente", R.avaliarReferencia({ valorCentavos: REF, escopo: { ...escopoOk, confirmado: false } }).status, "pendente_classificacao");
const itens19 = [
  { valorCentavos: 1000000, categoria: "salario", data: "2026-08-05", empresa: "Laportec", status: "confirmado" },
  { valorCentavos: 1000000, categoria: "adiantamento", data: "2026-08-20", empresa: "Laportec", status: "confirmado" },
  { valorCentavos: 131871, categoria: "rescisao", data: "2026-08-17", empresa: "Avora", status: "confirmado" },
  { valorCentavos: 50000, categoria: "salario", data: "2026-08-06", empresa: "Laportec", status: "pendente" },
];
const r19b = R.avaliarReferencia({ valorCentavos: REF, escopo: escopoOk, itens: itens19 });
t("19. 22.312,21", "com escopo: soma só o confirmado dentro do escopo (20.000,00)", r19b.confirmadoCentavos, 2000000);
t("19. 22.312,21", "a diferença aparece (−2.312,21) — nunca é forçada a zero", [r19b.status, r19b.diferencaCentavos], ["divergente", -231221]);
t("19. 22.312,21", "fora do escopo e pendentes ficam listados à parte", [r19b.excluidos.length, r19b.pendentes.length], [1, 1]);

// ── 20. Totais da tela = totais da exportação ──
const linhas20 = [
  { empresa: "Laportec", liquidoCentavos: 102500, complementosCentavos: 0, devidoCentavos: 102500, pagoCentavos: 102500, saldoCentavos: 0, divergencias: 0 },
  { empresa: "Laportec", liquidoCentavos: null, complementosCentavos: 44710, devidoCentavos: 44710, pagoCentavos: 0, saldoCentavos: 44710, divergencias: 1 },
  { empresa: "Avora", liquidoCentavos: 61000, complementosCentavos: 0, devidoCentavos: 61000, pagoCentavos: 0, saldoCentavos: 61000, divergencias: 0 },
];
const filtradas = linhas20.filter((l) => l.empresa === "Laportec");
const tela = R.resumirLinhasRepasse(filtradas);
const exportado = filtradas.map((l) => [l.liquidoCentavos ?? "", l.devidoCentavos, l.pagoCentavos, l.saldoCentavos]);
t("20. Tela × exportação", "líquido contábil do filtro = soma das linhas exportadas", tela.liquidoContabilCentavos, exportado.reduce((s, l) => s + (l[0] === "" ? 0 : l[0]), 0));
t("20. Tela × exportação", "saldo pendente do filtro = soma dos saldos exportados", tela.saldoPendenteCentavos, exportado.reduce((s, l) => s + Math.max(l[3], 0), 0));
t("20. Tela × exportação", "prévia (sem folha) é contada à parte, não como líquido zero", [tela.comFolha, tela.previas], [1, 1]);

// ── 21. Mudança futura de salário ──
const hist = [{ vigenciaInicio: "2026-01-01", salarioCentavos: 198000 }, { vigenciaInicio: "2026-09-01", salarioCentavos: 210000 }];
t("21. Salário no tempo", "em 15/07 vale o salário de janeiro (1.980,00)", R.salarioVigenteEm(hist, "2026-07-15"), 198000);
t("21. Salário no tempo", "em 10/09 vale o novo (2.100,00)", R.salarioVigenteEm(hist, "2026-09-10"), 210000);
t("21. Salário no tempo", "antes de qualquer vigência: desconhecido (null)", R.salarioVigenteEm(hist, "2025-12-31"), null);
const gravado = { salarioMensalCentavos: R.salarioVigenteEm(hist, "2026-07-14"), inicio: "2026-07-14", fim: "2026-07-20" };
t("21. Salário no tempo", "complemento guarda o salário do período: aumento posterior não muda o valor", R.calcularComplemento(gravado).totalCentavos, R.valorProporcional(198000, 7, 31));

// ── 22. Falta não é descontada duas vezes ──
const brenda = porMat(27);
const f22 = R.conciliarFaltas({ eventos: brenda.eventos, mapa: MAPA, faltasCRM: [{ valor: 127.74, categoria: "Salário" }] });
t("22. Faltas", "folha já descontou 8792 + 8794 (127,74) e o CRM tem 127,74 → conciliado", [f22.status, f22.naFolhaCentavos], ["conciliado", 12774]);
t("22. Faltas", "o saldo da folha continua o líquido 795,00 (não desconta de novo)", R.calcularSaldos({ liquidoOficialCentavos: R.centavos(brenda.liquido) }).folha.saldoCentavos, 79500);
const f22b = R.conciliarFaltas({ eventos: ale.eventos, mapa: MAPA, faltasCRM: [{ valor: 63.87, categoria: "Salário" }] });
t("22. Faltas", "falta do CRM que não está na folha → divergência, sem desconto automático", f22b.status, "divergente");
t("22. Faltas", "desconto de VT/VR por falta não entra na conciliação do salário", R.conciliarFaltas({ eventos: ale.eventos, mapa: MAPA, faltasCRM: [{ valor: 9.9, categoria: "VT" }] }).status, "sem_faltas");
const inf = R.calcularComplemento({ salarioMensalCentavos: 198000, inicio: "2026-07-14", fim: "2026-07-20", criterio: "informados", diasInformados: { "2026-07": 6 } });
t("22. Faltas", "critério 'dias informados': o dia faltado já sai da contagem (6 de 7), sem desconto extra", [inf.segmentos[0].diasCorridos, inf.segmentos[0].diasRemunerados, inf.totalCentavos], [7, 6, R.valorProporcional(198000, 6, 31)]);
t("22. Faltas", "dias informados maiores que o trecho são recusados", R.calcularComplemento({ salarioMensalCentavos: 198000, inicio: "2026-07-14", fim: "2026-07-20", criterio: "informados", diasInformados: { "2026-07": 9 } }).valido, false);

// ── Engenharia: dinheiro exato, fechamento, vínculo seguro ──
t("Dinheiro", "1,005 vira 101 centavos (sem erro de float)", R.centavos(1.005), 101);
t("Dinheiro", "0,1 + 0,2 somados em centavos = 30", R.centavos(0.1) + R.centavos(0.2), 30);
t("Dinheiro", "formatação BR", [R.formatarBRL(63871), R.formatarBRL(-7500), R.formatarBRL(2231221)], ["R$ 638,71", "-R$ 75,00", "R$ 22.312,21"]);
t("Dinheiro", "números do PDF: '45.031,64' e horas '12:06'", [R.numeroBR("45.031,64"), R.horasDecimais("12:06")], [45031.64, 12.1]);
t("Fechamento", "com divergência não fecha", R.avaliarFechamento({ divergencias: [{ codigo: "x" }] }).pode, false);
t("Fechamento", "exceção sem motivo não vale", R.avaliarFechamento({ divergencias: [{ codigo: "x" }], excecao: { autorizadoPor: "admin", motivo: " " } }).pode, false);
t("Fechamento", "exceção autorizada e com motivo fecha, marcada como exceção", (({ pode, comExcecao }) => [pode, comExcecao])(R.avaliarFechamento({ divergencias: [{ codigo: "x" }], excecao: { autorizadoPor: "admin", motivo: "contabilidade confirmou por e-mail" } })), [true, true]);
const divs = R.listarDivergencias({ adiantamento: adi1, faltas: f22b, excedentes: s12.excedentes, rescisao: "Rescisão paga à parte" });
t("Fechamento", "divergências bloqueantes × avisos", divs.map((d) => [d.codigo, d.bloqueia]), [["adiantamento", true], ["faltas", true], ["excedente", true], ["rescisao", false]]);
const funcs = [{ id: "a", nome: "EMPR 12", cpf: "00000000012", empresa: "Laportec", matricula: "12" }, { id: "b", nome: "OUTRA PESSOA", cpf: "99999999999", empresa: "Avora", matricula: "12" }];
t("Vínculo", "vincula por CPF", R.vincularFuncionario({ cpf: "000.000.000-12" }, funcs).via, "cpf");
t("Vínculo", "matrícula só vale dentro da mesma empresa", R.vincularFuncionario({ matricula: "12" }, funcs, { empresa: "Avora" }).funcionario?.id, "b");
t("Vínculo", "nome igual NUNCA vincula sozinho — vira só sugestão", (({ funcionario, sugestoes }) => [funcionario, sugestoes.length])(R.vincularFuncionario({ nome: "Empr 12" }, funcs)), [null, 1]);
t("Layout", "reconhece os três PDFs", [R.detectarLayout(CABECALHO), R.detectarLayout("RELATÓRIO ANALÍTICO DO CÁLCULO DE RESCISÃO"), R.detectarLayout("RELAÇÃO GERAL DOS LÍQUIDOS")], ["extrato-mensal", "analitico-rescisao", "relacao-liquidos"]);

const falhas = res.filter((r) => !r.ok);
console.log(falhas.length === 0 ? `Regras da folha: ${res.length}/${res.length} OK` : `Regras da folha: ${res.length - falhas.length}/${res.length} — ${falhas.length} FALHA(S)`);
for (const f of falhas) console.log(`  [${f.g}] ${f.nome}\n     obtido   ${JSON.stringify(f.got)}\n     esperado ${JSON.stringify(f.exp)}`);
if (falhas.length) process.exitCode = 1;
