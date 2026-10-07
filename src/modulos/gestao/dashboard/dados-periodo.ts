import { useMemo } from "react";
import { useMovimentacoes, useContasBancarias, usePlanoContas } from "@/lib/queries";
import { useEmpresa } from "@/lib/empresa";
import { saldoFromContas } from "@/lib/saldo";
import { resolverFlags } from "@/lib/categorias";
import { totaisRealizados } from "@/modulos/gestao/dashboard/categorias";
import { alcancaHoje, dentro, type Periodo } from "@/lib/periodo";

// ─── Os números do período, calculados uma vez só ───────────────────────────
// Saldo do banco, extrato do período e os totais do realizado. As DUAS telas do
// Histórico leem daqui — a de computador (painel-financeiro.tsx) e a de celular
// (inicio-celular.tsx) —, então a regra muda num lugar e vale nos dois.
//
// O que não vive aqui: projeção. Isto é só o que JÁ passou pelo extrato; o que
// vem pela frente é useProjecaoCaixa (modulos/financeiro/previsao-caixa.ts).

// O saldo de hoje e quem é a conta em foco. Não depende de período nenhum: a
// Projeção de caixa precisa só disto para saber de quanto parte.
export function useSaldoDaConta() {
  const { data: movimentos = [], isLoading: loadingMov } = useMovimentacoes();
  const { data: contas = [], isLoading: loadingContas } = useContasBancarias();
  const { contaId } = useEmpresa();

  const ativas = contas.filter((c) => c.ativo);
  const contaAtiva = contaId
    ? (contas.find((c) => c.id === contaId) ?? null)
    : ativas.length === 1
      ? ativas[0]
      : null;
  const contaLabel = contaId
    ? (contaAtiva?.nome ?? "Conta")
    : ativas.length <= 1
      ? (ativas[0]?.nome ?? "Conta PJ")
      : "Todas as contas";

  // Com "Todas as contas" no topo, cada lançamento mostra de qual conta é.
  const nomeConta = (id: string | null) =>
    contaId ? "" : (contas.find((c) => c.id === id)?.nome ?? "");

  // Saldo real: saldo inicial por conta + movimentações acumuladas.
  const { series, saldoAtual } = useMemo(
    () => saldoFromContas(contas, movimentos, contaId),
    [contas, movimentos, contaId],
  );

  return {
    movimentos,
    contas,
    ativas,
    contaAtiva,
    contaLabel,
    nomeConta,
    series,
    saldoAtual,
    porConta: !!contaId,
    carregando: loadingMov || loadingContas,
  };
}

// O período inteiro: o que já passou pelo extrato entre `de` e `ate`.
// `verInvestimentos` é o botão "Mostrar investimentos": traz de volta as
// categorias marcadas "não entra em relatórios" (aplicação/resgate,
// transferência entre contas da própria empresa) para conferência.
export function useDadosDoPeriodo(periodo: Periodo, hoje: string, verInvestimentos = false) {
  const { data: plano = [] } = usePlanoContas();
  const {
    movimentos,
    contas,
    ativas,
    contaAtiva,
    contaLabel,
    nomeConta,
    series,
    saldoAtual,
    carregando,
  } = useSaldoDaConta();

  const mostrarAgora = alcancaHoje(periodo, hoje);

  // Saldo no fim do período (para períodos que já passaram).
  const saldoFimPeriodo = useMemo(() => {
    let fim = 0;
    for (const p of series) if (p.date <= periodo.ate) fim = p.saldo;
    return fim;
  }, [series, periodo.ate]);
  const saldoExibido = mostrarAgora ? saldoAtual : saldoFimPeriodo;

  // O extrato do período: a fonte única destas telas. Pela data real do
  // lançamento (a mesma que move o saldo), e só o que já passou pelo extrato —
  // conta a pagar, Pix do dia e recorrência entram aqui quando forem pagos.
  // Cartão do topo, gráficos por categoria e listas leem daqui: os números
  // batem entre si por construção.
  const flags = useMemo(() => resolverFlags(plano), [plano]);
  const temInvestimentos = useMemo(
    () => movimentos.some((m) => dentro(periodo, m.dataISO) && flags.ocultoDe(m.cat)),
    [movimentos, periodo, flags],
  );
  const extrato = useMemo(
    () =>
      movimentos.filter(
        (m) => dentro(periodo, m.dataISO) && (verInvestimentos || !flags.ocultoDe(m.cat)),
      ),
    [movimentos, periodo, flags, verInvestimentos],
  );

  // Categorias compensadas (migração 56): o que entra e o que sai nelas se
  // anula — o resumo mostra só o líquido do período. Ex.: aporte recebido ×
  // investimento em anúncios pago com ele.
  const { compensacao, ...realizado } = useMemo(
    () => totaisRealizados(extrato, flags.compensaDe),
    [extrato, flags],
  );

  return {
    contas,
    ativas,
    contaAtiva,
    contaLabel,
    nomeConta,
    series,
    saldoAtual,
    saldoExibido,
    mostrarAgora,
    flags,
    extrato,
    temInvestimentos,
    realizado,
    compensacao,
    carregando,
  };
}
