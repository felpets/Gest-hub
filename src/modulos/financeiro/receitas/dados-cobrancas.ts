// ─── Cobranças (contas a receber): as linhas e os totais ────────────────────
// Usado pelas DUAS telas de Financeiro › Receitas › Cobranças: a de computador
// (telas/cobrancas, uma tabela) e a de celular (telas/receitas-celular,
// cartões). O que não pode divergir mora aqui: o que cada linha mostra, o que
// os filtros fazem e o que cada total soma.
//
// Duas sutilezas que já estavam na tela grande e precisam valer nas duas:
//   · os totais acompanham o filtro de MÊS e a BUSCA, mas não o de situação —
//     senão o cartão "vencido" mostraria sempre o total da própria lista;
//   · "recebido" soma o valor REALMENTE pago (pagoValor), não o combinado.
import { useMemo } from "react";
import {
  useClientes,
  useCobrancas,
  useVendas,
  useMembrosDaEmpresa,
  statusCobranca,
  type Cobranca,
  type StatusCobranca,
  type Venda,
} from "@/lib/queries";

export const FORMAS_PAGAMENTO: Record<string, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  credito: "Crédito",
  debito: "Débito",
  boleto: "Boleto",
  transferencia: "Transferência",
  outro: "Outro",
};

export const ROTULO_STATUS: Record<StatusCobranca, string> = {
  pendente: "A receber",
  pago: "Recebido",
  vencido: "Vencido",
  cancelado: "Cancelado",
};

export type LinhaCobranca = {
  c: Cobranca;
  st: StatusCobranca;
  cliente: string;
  venda: Venda | undefined;
};

export type FiltroCobranca = "todas" | StatusCobranca;

export type FiltrosCobrancas = {
  filtro: FiltroCobranca;
  busca: string;
  // "" = todo o período.
  mes: string;
};

export function useDadosCobrancas(hoje: string, f: FiltrosCobrancas) {
  const { data: cobrancas = [], isLoading } = useCobrancas();
  const { data: clientes = [] } = useClientes();
  const { data: vendas = [] } = useVendas();
  const { data: membros = [] } = useMembrosDaEmpresa();

  const nomeCliente = useMemo(() => new Map(clientes.map((c) => [c.id, c.nome])), [clientes]);
  const daVenda = useMemo(() => new Map(vendas.map((v) => [v.id, v])), [vendas]);
  const quemCadastrou = useMemo(
    () => new Map(membros.map((m) => [m.userId, m.nome || m.email])),
    [membros],
  );

  const linhas = useMemo<LinhaCobranca[]>(() => {
    const termo = f.busca.trim().toLowerCase();
    return cobrancas
      .map((c) => ({
        c,
        st: statusCobranca(c, hoje),
        cliente: nomeCliente.get(c.clienteId) ?? "(cliente removido)",
        venda: c.vendaId ? daVenda.get(c.vendaId) : undefined,
      }))
      .filter((l) => (f.filtro === "todas" ? true : l.st === f.filtro))
      .filter((l) => (f.mes ? l.c.vencimento.slice(0, 7) === f.mes : true))
      .filter(
        (l) =>
          !termo ||
          l.cliente.toLowerCase().includes(termo) ||
          l.c.descricao.toLowerCase().includes(termo) ||
          (l.venda?.descricao ?? "").toLowerCase().includes(termo),
      )
      .sort((a, b) => b.c.vencimento.localeCompare(a.c.vencimento));
  }, [cobrancas, f.filtro, f.busca, f.mes, hoje, nomeCliente, daVenda]);

  const totais = useMemo(() => {
    const base = f.mes ? cobrancas.filter((c) => c.vencimento.slice(0, 7) === f.mes) : cobrancas;
    const soma = (ok: (c: Cobranca) => boolean, valor: (c: Cobranca) => number = (c) => c.valor) =>
      base.filter(ok).reduce((s, c) => s + valor(c), 0);
    return {
      aReceber: soma((c) => statusCobranca(c, hoje) === "pendente"),
      vencido: soma((c) => statusCobranca(c, hoje) === "vencido"),
      recebido: soma(
        (c) => c.status === "pago",
        (c) => c.pagoValor ?? c.valor,
      ),
      qtdVencidas: base.filter((c) => statusCobranca(c, hoje) === "vencido").length,
      qtdPendentes: base.filter((c) => statusCobranca(c, hoje) === "pendente").length,
      qtdRecebidas: base.filter((c) => c.status === "pago").length,
    };
  }, [cobrancas, f.mes, hoje]);

  // Contagem por situação, para as pastilhas do celular. Segue o mês e a busca,
  // nunca o próprio filtro de situação — um contador que muda ao ser clicado
  // não serve para escolher.
  const contagem = useMemo(() => {
    const termo = f.busca.trim().toLowerCase();
    const base = cobrancas
      .map((c) => ({ c, st: statusCobranca(c, hoje), cliente: nomeCliente.get(c.clienteId) ?? "" }))
      .filter((l) => (f.mes ? l.c.vencimento.slice(0, 7) === f.mes : true))
      .filter(
        (l) =>
          !termo ||
          l.cliente.toLowerCase().includes(termo) ||
          l.c.descricao.toLowerCase().includes(termo),
      );
    return {
      todas: base.length,
      pendente: base.filter((l) => l.st === "pendente").length,
      vencido: base.filter((l) => l.st === "vencido").length,
      pago: base.filter((l) => l.st === "pago").length,
      cancelado: base.filter((l) => l.st === "cancelado").length,
    };
  }, [cobrancas, f.mes, f.busca, hoje, nomeCliente]);

  return { cobrancas, clientes, linhas, totais, contagem, quemCadastrou, carregando: isLoading };
}
