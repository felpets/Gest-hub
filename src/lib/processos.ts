// ─── Dívidas e acordos: as contas de um processo ────────────────────────────
// Um processo é um acordo parcelado: valor da parcela, dia do mês, qual parcela
// está correndo e quantas são no total. Tudo o que se mostra sobre ele — quanto
// já foi pago, quanto falta, quando vence a próxima — é derivado desses quatro
// números, e essa derivação vive aqui para a tela de computador
// (telas/processos) e a de celular (telas/contas-celular) nunca discordarem.
//
// Puro: sem React, sem banco, sem relógio implícito (a data de hoje entra por
// parâmetro, como no resto do sistema).
import type { PagamentoProcesso } from "@/lib/queries";
import { pad } from "@/lib/datas";

// Parcelas já quitadas. Enquanto o acordo corre, a parcela ATUAL é a que ainda
// vai ser paga — então as pagas são as anteriores a ela. Encerrado, todas foram.
export function parcelasPagas(p: PagamentoProcesso): number {
  return Math.max(0, p.ativo ? p.parcelaAtual - 1 : p.parcelasTotal);
}

export function pctPago(p: PagamentoProcesso): number {
  if (p.parcelasTotal <= 0) return 0;
  return Math.min(100, Math.round((parcelasPagas(p) / p.parcelasTotal) * 100));
}

// Valor de face do acordo: a parcela vezes o número de parcelas.
export function totalDoAcordo(p: PagamentoProcesso): number {
  return p.valor * p.parcelasTotal;
}

// Quanto ainda falta pagar. Conta a parcela atual (ela não foi paga ainda);
// acordo encerrado não deve nada.
export function saldoDevedor(p: PagamentoProcesso): number {
  if (!p.ativo) return 0;
  return p.valor * Math.max(0, p.parcelasTotal - p.parcelaAtual + 1);
}

// Próximo vencimento: o dia do acordo neste mês se ele ainda não passou, senão
// no mês que vem. Dia 31 em mês curto cai no último dia — o mesmo critério do
// resto do sistema. Acordo encerrado não tem próximo vencimento.
//
// O mês é decidido pelo HISTÓRICO, não por "a data já passou": a parcela atual
// é a do mês corrente até que alguém registre o pagamento dela. Sem isso, uma
// parcela atrasada era empurrada para o mês seguinte e a tela nunca conseguia
// dizer "vencida" — justamente a parcela que a empresa precisa ver. Histórico
// vazio (acordo antigo, ou a migração 37 ainda não rodou) cai no mês corrente,
// que é o palpite que erra menos.
export function proximoVencimento(
  p: PagamentoProcesso,
  hoje: string,
  historico: { pagoEm: string }[] = [],
): string | null {
  if (!p.ativo) return null;
  const [y, m] = hoje.split("-").map(Number);
  const noMes = (ano: number, mes: number) => {
    const ultimo = new Date(ano, mes, 0).getDate();
    return `${ano}-${pad(mes)}-${pad(Math.min(p.diaPagamento, ultimo))}`;
  };
  const ym = hoje.slice(0, 7);
  const quitouEsteMes = historico.some((h) => h.pagoEm.slice(0, 7) === ym);
  if (!quitouEsteMes) return noMes(y, m);
  return m === 12 ? noMes(y + 1, 1) : noMes(y, m + 1);
}

export type ResumoProcessos = {
  abertos: PagamentoProcesso[];
  encerrados: PagamentoProcesso[];
  // Soma das parcelas dos acordos em aberto: o que esses acordos tiram do caixa
  // num mês cheio.
  valorMes: number;
  // Soma do que falta pagar em todos eles.
  totalRestante: number;
};

export function resumoProcessos(processos: PagamentoProcesso[]): ResumoProcessos {
  const abertos = processos.filter((p) => p.ativo);
  return {
    abertos,
    encerrados: processos.filter((p) => !p.ativo),
    valorMes: abertos.reduce((s, p) => s + p.valor, 0),
    totalRestante: processos.reduce((s, p) => s + saldoDevedor(p), 0),
  };
}

// Busca por nome ou chave Pix, igual nas duas telas.
export function filtraProcessos(
  processos: PagamentoProcesso[],
  busca: string,
): PagamentoProcesso[] {
  const s = busca.trim().toLowerCase();
  if (!s) return processos;
  return processos.filter(
    (p) => p.nome.toLowerCase().includes(s) || p.chavePix.toLowerCase().includes(s),
  );
}

// ─── O cronograma de parcelas ───────────────────────────────────────────────
// O acordo guarda quatro números (parcela, dia, atual, total) e o histórico
// guarda as parcelas que foram realmente pagas, com data e comprovante. A lista
// de parcelas que a tela mostra é a junção dos dois:
//
//   · parcela com registro no histórico → paga, na data em que foi paga;
//   · parcela antes da atual sem registro → paga pelo contador, sem data. É o
//     acordo cadastrado já em andamento (ou a migração 37 ainda não rodou):
//     dizer "a vencer" seria mentir sobre o que a empresa já pagou;
//   · parcela atual e as seguintes → projetadas pelo dia do acordo, uma por mês
//     a partir do próximo vencimento;
//   · parcela projetada com data já passada → vencida.
export type ParcelaCronograma = {
  numero: number;
  // Data a mostrar: a do pagamento quando houver, senão o vencimento projetado.
  data: string | null;
  valor: number;
  situacao: "paga" | "a_vencer" | "vencida";
  comprovante: boolean;
};

export function cronogramaParcelas(
  p: PagamentoProcesso,
  historico: { numero: number; pagoEm: string; valor: number; comprovantePath: string | null }[],
  hoje: string,
): ParcelaCronograma[] {
  const pagoPorNumero = new Map(historico.map((h) => [h.numero, h]));
  const proxima = proximoVencimento(p, hoje, historico);
  const total = Math.max(0, Math.round(p.parcelasTotal));
  return Array.from({ length: total }, (_, i) => {
    const numero = i + 1;
    const pago = pagoPorNumero.get(numero);
    if (pago) {
      return {
        numero,
        data: pago.pagoEm,
        valor: pago.valor,
        situacao: "paga" as const,
        comprovante: !!pago.comprovantePath,
      };
    }
    if (numero <= parcelasPagas(p)) {
      return { numero, data: null, valor: p.valor, situacao: "paga" as const, comprovante: false };
    }
    // Projetada: a atual cai no próximo vencimento, as outras um mês adiante cada.
    const venc = proxima ? somarMesesISO(proxima, numero - p.parcelaAtual) : null;
    return {
      numero,
      data: venc,
      valor: p.valor,
      situacao: venc && venc < hoje ? ("vencida" as const) : ("a_vencer" as const),
      comprovante: false,
    };
  });
}

// Mesmo dia, N meses à frente; dia 31 em mês curto cai no último dia.
function somarMesesISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const alvo = m - 1 + n;
  const ano = y + Math.floor(alvo / 12);
  const mes = ((alvo % 12) + 12) % 12;
  const ultimo = new Date(ano, mes + 1, 0).getDate();
  return `${ano}-${pad(mes + 1)}-${pad(Math.min(d, ultimo))}`;
}
