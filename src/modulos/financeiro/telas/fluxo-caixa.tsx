import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { SeletorConta } from "@/components/seletor-conta";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileDown, FileSpreadsheet, ArrowRight, TrendingUp, TrendingDown, Wallet, ListOrdered } from "lucide-react";
import { brl } from "@/lib/format";
import { resumoPeriodo, serieFluxo } from "@/lib/lancamentos";
import { agruparPor, dentro, periodoPadrao, rotuloPeriodo, type Periodo } from "@/lib/periodo";
import { GraficosFluxo } from "@/modulos/financeiro/graficos-fluxo";
import { SeletorPeriodo } from "@/modulos/gestao/dashboard/seletor-periodo";
import { useMovimentacoes, useMovimentacoesRelatorio, useContasBancarias } from "@/lib/queries";
import { saldoFromContas } from "@/lib/saldo";
import { hojeISO } from "@/lib/datas";
import { useEmpresa } from "@/lib/empresa";
import { exportToPdf, exportToXlsx } from "@/lib/export";
import { ProjecaoCaixa } from "@/modulos/financeiro/telas/projecao-caixa";

// Financeiro › Caixa: "realizado" (extrato confirmado) e "projecao" (contas em
// aberto + cobranças) são abas separadas — os dois números nunca se misturam.
export function FluxoCaixa({ visao = "realizado" }: { visao?: "realizado" | "projecao" }) {
  const { data: movimentos = [] } = useMovimentacoes();
  // KPIs e gráfico diário ignoram categorias "fora dos relatórios"; o saldo e a
  // exportação usam `movimentos` cru (dinheiro real).
  const movsRel = useMovimentacoesRelatorio();
  const { data: contas = [] } = useContasBancarias();
  const { contaId, empresaId, empresas } = useEmpresa();
  const empresaNome = empresas.find((e) => e.id === empresaId)?.nome ?? "Empresa";
  // O mesmo filtro de período do Dashboard: é o que garante que as duas telas
  // falem do mesmo pedaço de tempo (antes aqui eram "últimos N dias" e lá, mês).
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoPadrao(hojeISO()));
  const rotulo = rotuloPeriodo(periodo);

  const ativas = contas.filter((c) => c.ativo);
  const contaLabel = contaId
    ? contas.find((c) => c.id === contaId)?.nome ?? "Conta"
    : ativas.length <= 1
      ? ativas[0]?.nome ?? "Conta PJ"
      : "Todas as contas";

  // Saldo real: saldo inicial por conta + movimentações acumuladas
  // (consolidado quando a conta ativa = Todas).
  const { series, saldoAtual } = useMemo(
    () => saldoFromContas(contas, movimentos, contaId),
    [contas, movimentos, contaId]
  );

  // Saldo por dia dentro do período e o resumo do REALIZADO. Mesmas funções do
  // Dashboard (lib/lancamentos): sem compromisso em aberto, porque esta aba é
  // só o que já passou pelo extrato — a projeção tem a aba ao lado.
  const saldoPorDia = useMemo(() => series.filter((p) => dentro(periodo, p.date)), [series, periodo]);
  const movsPeriodo = useMemo(
    () => movsRel.map((m) => ({ dataISO: m.dataComp, tipo: m.tipo, valor: m.valor })),
    [movsRel],
  );
  const janela = { de: periodo.de, ate: periodo.ate };
  const resumo = useMemo(
    () => resumoPeriodo(movsPeriodo, [], janela, true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [movsPeriodo, periodo.de, periodo.ate],
  );
  const serieRealizada = useMemo(
    () => serieFluxo(movsPeriodo, [], janela, agruparPor(periodo), true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [movsPeriodo, periodo],
  );

  const exportData = () => {
    const cols = ["Data", "Descrição", "Categoria", "Tipo", "Valor"];
    const rows = movimentos.map((m) => [m.date, m.ia, m.cat, m.tipo === "in" ? "Entrada" : "Saída", m.valor]);
    return { cols, rows };
  };

  const handlePdf = () => {
    const { cols, rows } = exportData();
    exportToPdf({
      title: "Fluxo de Caixa",
      company: empresaNome,
      // A lista exportada tem TODOS os lançamentos confirmados (antes o subtítulo
      // dizia "últimos N dias", o que não correspondia ao conteúdo).
      subtitle: `${contaLabel} · todos os lançamentos confirmados · saldo ${brl(saldoAtual)}`,
      columns: cols,
      // no PDF o valor sai formatado em R$ (no Excel fica numérico p/ fórmulas)
      rows: rows.map((r) => [...r.slice(0, 4), brl(Number(r[4]))]),
      filename: "fluxo-caixa-finance-hub.pdf",
    });
  };
  const handleXlsx = () => {
    const { cols, rows } = exportData();
    exportToXlsx({ filename: "fluxo-caixa-finance-hub", sheets: [{ name: "Movimentações", columns: cols, rows }] });
  };

  return (
    <AppShell
      title="Fluxo de Caixa"
      subtitle={
        visao === "realizado"
          ? `${contaLabel} · ${rotulo} · REALIZADO: só o que já passou pelo extrato`
          : `${contaLabel} · PREVISÃO: saldo de hoje + contas a pagar e cobranças em aberto. Nada aqui é dinheiro que já entrou.`
      }
      actions={
        visao === "realizado" ? (
          <>
            <SeletorConta variant="acoes" />
            <SeletorPeriodo periodo={periodo} hoje={hojeISO()} onChange={setPeriodo} />
            <Button variant="outline" className="h-9" onClick={handleXlsx}>
              <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Excel
            </Button>
            <Button variant="outline" className="h-9" onClick={handlePdf}>
              <FileDown className="h-4 w-4 mr-1.5" /> PDF
            </Button>
          </>
        ) : (
          // Na projeção o saldo de partida é o da conta escolhida (o aviso lá
          // dentro lembra que as contas e cobranças são da empresa inteira).
          <SeletorConta variant="acoes" />
        )
      }
    >
      {visao === "realizado" && (
        <>
      {/* Indicadores do período — as MESMAS contas do Dashboard da Gestão
          (resumoPeriodo sobre as movimentações confirmadas). Duas telas, uma
          conta só: se o saldo aqui é X, lá também é X. */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Saldo atual", value: brl(saldoAtual), icon: Wallet, color: "text-foreground" },
          { label: `Entradas (${rotulo})`, value: brl(resumo.entradasRealizadas), icon: TrendingUp, color: "text-success" },
          { label: `Saídas (${rotulo})`, value: brl(resumo.saidasRealizadas), icon: TrendingDown, color: "text-destructive" },
          { label: "Resultado", value: brl(resumo.resultadoRealizado), icon: TrendingUp, color: resumo.resultadoRealizado >= 0 ? "text-success" : "text-destructive" },
        ].map((k) => (
          <Card key={k.label} className="p-5 card-elevated border-border/70">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-lg bg-secondary grid place-items-center">
                <k.icon className="h-[18px] w-[18px] stroke-[1.6]" />
              </div>
              <span className="text-[13px] text-muted-foreground font-medium">{k.label}</span>
            </div>
            <div className={`mt-3 font-numeric text-[24px] font-semibold tabular-nums whitespace-nowrap ${k.color}`}>{k.value}</div>
          </Card>
        ))}
      </div>

      {/* Os mesmos dois gráficos do Dashboard, do mesmo componente. */}
      <GraficosFluxo
        saldoPorDia={saldoPorDia}
        fluxo={serieRealizada}
        contaLabel={contaLabel}
        rotulo={rotulo}
        fechado
      />

      {/* A lista de lançamentos (antes repetida aqui, só leitura) vive na aba
          Movimentações, com filtros, edição e exportação — sem duplicar a tabela. */}
      <Card className="card-elevated border-border/70 p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-secondary grid place-items-center">
            <ListOrdered className="h-[18px] w-[18px] stroke-[1.6]" />
          </div>
          <div>
            <p className="font-display text-base font-semibold">{movimentos.length} lançamentos confirmados</p>
            <p className="text-[13px] text-muted-foreground">
              Saldo atual <span className="font-numeric font-semibold text-foreground">{brl(saldoAtual)}</span> · a lista completa, com filtros e edição, está em Movimentações.
            </p>
          </div>
        </div>
        <Button asChild variant="outline" className="h-9">
          <Link to="/financeiro/caixa" search={{ aba: "movimentacoes" }}>
            Ver lançamentos <ArrowRight className="h-4 w-4 ml-1.5" />
          </Link>
        </Button>
      </Card>
        </>
      )}

      {visao === "projecao" && (
        <ProjecaoCaixa saldoAtual={saldoAtual} contaLabel={contaLabel} porConta={!!contaId} />
      )}
    </AppShell>
  );
}
