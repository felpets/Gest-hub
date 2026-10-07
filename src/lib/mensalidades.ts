// Situação de cada mensalidade de um cliente, a partir das cobranças dela.
// Puro e testável: a tela de Clientes só desenha o que sai daqui.
import type { Cliente, Cobranca, Mensalidade } from "@/lib/queries";

const diasEntre = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// Sem a migração 52 no banco, o cliente tem uma mensalidade só: a da própria
// linha do cliente. Ela vira uma mensalidade "legado" para a tela tratar os
// dois casos do mesmo jeito.
export const ID_LEGADO = "legado";

export function mensalidadesDoCliente(
  cliente: Cliente,
  porTabela: boolean,
  todas: Mensalidade[],
): Mensalidade[] {
  if (porTabela) return todas.filter((m) => m.clienteId === cliente.id);
  if (!(cliente.mens > 0)) return [];
  return [{
    id: ID_LEGADO,
    clienteId: cliente.id,
    descricao: "Mensalidade",
    valor: cliente.mens,
    diaVencimento: cliente.diaVencimento,
    inicio: cliente.clienteDesde ?? cliente.criadoEm?.slice(0, 10) ?? "",
    ativo: cliente.ativo,
    criadoEm: cliente.criadoEm,
  }];
}

// Cobranças de uma mensalidade. As antigas, anteriores à migração 52 (sem
// mensalidade_id), ficam com a PRIMEIRA mensalidade do cliente — é dela que
// elas vieram, porque até então só existia uma.
export function cobrancasDaMensalidade(m: Mensalidade, primeiraDoCliente: boolean, cobrancas: Cobranca[]): Cobranca[] {
  return cobrancas.filter((c) =>
    c.clienteId === m.clienteId && c.vendaId == null && c.status !== "cancelado" &&
    (c.mensalidadeId === m.id || (c.mensalidadeId == null && (primeiraDoCliente || m.id === ID_LEGADO))),
  );
}

export type SituacaoMensalidade = {
  atrasoDias: number;          // desde a cobrança em aberto MAIS ANTIGA já vencida
  emAtraso: number;            // quantas cobranças vencidas e não pagas
  valorEmAtraso: number;
  doMes: Cobranca | undefined; // a cobrança da competência corrente
};

export function situacaoMensalidade(cobrancas: Cobranca[], hoje: string, competenciaAtual: string): SituacaoMensalidade {
  const vencidas = cobrancas
    .filter((c) => c.status === "aberto" && c.vencimento < hoje)
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  return {
    atrasoDias: vencidas.length ? diasEntre(vencidas[0].vencimento, hoje) : 0,
    emAtraso: vencidas.length,
    valorEmAtraso: Math.round(vencidas.reduce((s, c) => s + c.valor, 0) * 100) / 100,
    doMes: cobrancas.find((c) => c.competencia === competenciaAtual),
  };
}

// Selo do cartão do cliente, olhando TODAS as mensalidades ativas: qualquer
// uma atrasada deixa o cliente atrasado (antes só contava a do mês corrente).
export type StatusCliente = "Pago" | "Pendente" | "Atrasado" | "Inativo";

export function statusDoCliente(ativo: boolean, situacoes: SituacaoMensalidade[]): StatusCliente {
  if (!ativo) return "Inativo";
  if (situacoes.some((s) => s.atrasoDias > 0)) return "Atrasado";
  if (situacoes.length === 0) return "Pendente";
  if (situacoes.some((s) => !s.doMes || s.doMes.status === "aberto")) return "Pendente";
  return "Pago";
}
