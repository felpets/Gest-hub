import { Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowUpRight, ArrowDownLeft, ArrowLeft, ArrowRight, CalendarClock, FileDown, Loader2, Plus, Upload, PiggyBank,
} from "lucide-react";
import {
  ResponsiveContainer, XAxis, YAxis, Tooltip, BarChart, Bar, CartesianGrid, LabelList, Cell,
} from "recharts";
import { brl, fmtK } from "@/lib/format";
import { fmtBR, hojeISO } from "@/lib/datas";
import {
  useMovimentacoes, usePrevistos, useCobrancas,
  useClientes, usePagamentosDiarios, usePagamentosProcessos, useCompromissosRH, useFuncionalidades, useRecorrentes,
  useSincronizarCobrancasAoAbrir, useInterStatus, usePendentesCount, usePlanoContas,
} from "@/lib/queries";
import { ResumoPeriodo } from "@/modulos/gestao/dashboard/resumo-periodo";
import { AjusteSaldoDialog } from "@/components/AjusteSaldoDialog";
import { useEmpresa } from "@/lib/empresa";
import { temCap } from "@/lib/permissoes";
import { ligada } from "@/lib/funcionalidades";
import { origemRHCoberta } from "@/lib/fontes-rh";
import { exportToPdf, svgToPng, type PdfChart } from "@/lib/export";
import { BoletosCell } from "@/components/BoletosEditor";
import { useChartColors, useTheme, type ChartColors } from "@/lib/theme";
import {
  montarCompromissos, ROTULO_ORIGEM, type OrigemCompromisso,
} from "@/lib/lancamentos";
import {
  alcancaHoje, dentro, periodoFechado, periodoPadrao, rotuloPeriodo,
  type Periodo,
} from "@/lib/periodo";
import { GraficoCategorias } from "@/modulos/gestao/dashboard/grafico-categorias";
import { porCategoria, comOutras } from "@/modulos/gestao/dashboard/categorias";
import { SeletorPeriodo } from "@/modulos/gestao/dashboard/seletor-periodo";
import { SeletorConta } from "@/components/seletor-conta";
import { ListaExtrato } from "@/modulos/gestao/dashboard/lista-extrato";
import { useDadosDoPeriodo } from "@/modulos/gestao/dashboard/dados-periodo";

// ─── Dashboard da Gestão ───────────────────────────────────────────────────
// A leitura gerencial do sistema inteiro, em uma ordem só: primeiro a previsão
// de caixa (a mesma do Caixa › Projeção) e o fluxo de entradas × saídas,
// depois o detalhe de cada entrada e de cada saída, depois o resto.
//
// Duas regras que valem na tela toda:
//   • UM filtro de período governa tudo. Não existe bloco com período próprio.
//   • REALIZADO é o extrato; PROJETADO é compromisso em aberto. Um compromisso
//     pago sai da projeção (senão o mesmo dinheiro contaria duas vezes).
//
// As fontes são as telas que já existem — contas, recorrências, mensalidades,
// Pix do dia, acordos e o RH. Nada é cadastrado em dois lugares.

const COR_IN = "#1F7A3A";
const COR_OUT = "#D63B0F";

// Rótulo de valor da barra: positivos acima, negativos logo abaixo do zero.
function SaldoBarLabel(props: { x?: number; y?: number; width?: number; value?: number }) {
  const { ink } = useChartColors();
  const { x = 0, y = 0, width = 0, value } = props;
  if (value == null) return null;
  return (
    <text x={x + width / 2} y={value >= 0 ? y - 6 : y + 14} textAnchor="middle" fontSize={11} fontWeight={700} fill={ink}>
      {fmtK(value)}
    </text>
  );
}

export function Dashboard() {
  const hoje = hojeISO();
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoPadrao(hoje));
  const fechado = periodoFechado(periodo, hoje);
  const janela = { de: periodo.de, ate: periodo.ate };
  const rotulo = rotuloPeriodo(periodo);
  const mostrarAgora = alcancaHoje(periodo, hoje);

  const { data: movimentos = [] } = useMovimentacoes();
  const { contaId, empresaId, empresas, caps, isMaster } = useEmpresa();
  const { data: pendentesCount = 0 } = usePendentesCount();
  const { data: previstos = [] } = usePrevistos();
  const { data: cobrancas = [] } = useCobrancas();
  const { data: clientes = [] } = useClientes();
  const { data: pix = [] } = usePagamentosDiarios();
  const { data: processos = [] } = usePagamentosProcessos();
  const { data: funcs } = useFuncionalidades();
  const { data: recorrentes = [] } = useRecorrentes();
  const { data: plano = [] } = usePlanoContas();
  const rhQuery = useCompromissosRH(periodo.de, periodo.ate);
  const empresaNome = empresas.find((e) => e.id === empresaId)?.nome ?? "Empresa";

  const [ajusteOpen, setAjusteOpen] = useState(false);
  const [verInvestimentos, setVerInvestimentos] = useState(false);
  // Categoria clicada em cada gráfico: filtra a lista logo abaixo dele.
  const [catEntrada, setCatEntrada] = useState<string | null>(null);
  const [catSaida, setCatSaida] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfCharts, setPdfCharts] = useState(false);
  const entradasChartRef = useRef<HTMLDivElement>(null);
  const despesasChartRef = useRef<HTMLDivElement>(null);
  const pdfDespesasRef = useRef<HTMLDivElement>(null);

  // Gera as cobranças do mês e concilia com o extrato ao abrir (e ao trocar de
  // empresa), para a KPI de mensalidades refletir os pagamentos.
  useSincronizarCobrancasAoAbrir();

  const { isDark } = useTheme();
  const ct = useChartColors();
  const tick = { fill: ct.label, fontSize: 12.5, fontWeight: 500 };
  const pdfChartOpts = isDark
    ? {
        background: "#ffffff",
        forceTextColor: "#27272a",
        recolor: [
          { from: ct.ink, to: "#0D0C0C" },
          { from: ct.grid, to: "#F1F1F1" },
          { from: ct.axis, to: "#9b9b9b" },
        ],
      }
    : { background: "#ffffff" };

  // Saldo, extrato do período e totais do realizado: a mesma conta que a tela
  // de celular faz (modulos/gestao/dashboard/dados-periodo.ts). As categorias
  // marcadas "não entra em relatórios" ficam de fora até alguém pedir — é o
  // botão "Mostrar investimentos".
  const {
    contas, ativas, contaAtiva, contaLabel, nomeConta, saldoAtual, saldoExibido,
    flags, extrato: extratoPeriodo, temInvestimentos, realizado: realizadoPeriodo, compensacao, carregando,
  } = useDadosDoPeriodo(periodo, hoje, verInvestimentos);
  // Saldo do Inter (gravado na última sincronização; nada é chamado aqui).
  const { data: interStatus = [] } = useInterStatus();
  const interSaldo = useMemo(() => {
    const comSaldo = interStatus.filter((s) => s.ativo && s.ultimoSaldo != null);
    if (contaAtiva) {
      const s = comSaldo.find((x) => x.contaId === contaAtiva.id);
      return s ? { saldo: s.ultimoSaldo!, em: s.ultimoSaldoEm } : null;
    }
    if (ativas.length > 0 && ativas.every((c) => comSaldo.some((s) => s.contaId === c.id))) {
      const soma = ativas.reduce((acc, c) => acc + (comSaldo.find((s) => s.contaId === c.id)?.ultimoSaldo ?? 0), 0);
      return { saldo: soma, em: ativas.map((c) => comSaldo.find((s) => s.contaId === c.id)?.ultimoSaldoEm ?? null).filter(Boolean).sort()[0] ?? null };
    }
    return null;
  }, [interStatus, contaAtiva, ativas]);
  const interDivergencia = interSaldo ? saldoAtual - interSaldo.saldo : 0;

  // ─── Fonte única: todos os compromissos do período ────────
  const nomeCliente = useMemo(() => {
    const mapa = new Map(clientes.map((c) => [c.id, c.nome]));
    return (id: string) => mapa.get(id) ?? "";
  }, [clientes]);

  // Rubricas do RH que já entram como conta do mês (recorrência ligada ao RH):
  // sem isto, a folha apareceria duas vezes — uma na conta, outra por pessoa.
  const origensRHCobertas = useMemo(() => {
    const set = new Set<OrigemCompromisso>();
    for (const r of recorrentes) {
      const o = r.fonteRH ? origemRHCoberta(r.fonteRH) : null;
      if (o) set.add(o);
    }
    return set;
  }, [recorrentes]);

  const compromissos = useMemo(
    () =>
      montarCompromissos(
        {
          previstos,
          cobrancas,
          pix: caps.has("pag_diario_gerir") ? pix : [],
          acordos: ligada(funcs, "dividas_acordos") ? processos : [],
          rh: rhQuery.data?.itens ?? [],
          nomeCliente,
          origensRHCobertas,
        },
        janela,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previstos, cobrancas, pix, processos, rhQuery.data, funcs, caps, nomeCliente, origensRHCobertas, periodo.de, periodo.ate],
  );

  // Próximos movimentos: compromissos em aberto a partir de hoje.
  const proximos = useMemo(
    () => compromissos.filter((c) => !c.liquidado && c.data >= hoje).slice(0, 6),
    [compromissos, hoje],
  );

  // Extrato desatualizado (proxy: dias desde a última movimentação).
  const extratoStatus = useMemo(() => {
    let max = "";
    for (const m of movimentos) if (m.dataISO > max) max = m.dataISO;
    if (!max) return null;
    const [y, mo, d] = max.split("-").map(Number);
    const h = new Date();
    h.setHours(0, 0, 0, 0);
    const dias = Math.max(0, Math.round((h.getTime() - new Date(y, mo - 1, d).getTime()) / 86400000));
    return { dataBR: fmtBR(max), dias };
  }, [movimentos]);

  // Boletos/PIX com código cadastrado que vencem no período.
  const boletosDoPeriodo = useMemo(
    () => previstos.filter((p) => dentro(periodo, p.data) && p.boletos.length > 0 && !p.pago).sort((a, b) => a.data.localeCompare(b.data)),
    [previstos, periodo],
  );

  // Entradas e saídas por categoria, do mesmo extrato do período, pelo caminho
  // inteiro da categoria (a leitura das Análises financeiras).
  // Nos gráficos as compensadas não aparecem: o líquido delas está no cartão.
  const paraGrafico = useMemo(() => extratoPeriodo.filter((m) => !flags.compensaDe(m.cat)), [extratoPeriodo, flags]);
  const entradasCat = useMemo(() => porCategoria(paraGrafico, "in"), [paraGrafico]);
  const despesasCat = useMemo(() => porCategoria(paraGrafico, "out"), [paraGrafico]);
  const TOPO = 8; // o resto entra como "outras N categorias"
  const entradasTopo = useMemo(() => comOutras(entradasCat, TOPO), [entradasCat]);
  const despesasTopo = useMemo(() => comOutras(despesasCat, TOPO), [despesasCat]);
  // Os dois gráficos com a mesma altura: as duas colunas começam o
  // detalhamento na mesma linha.
  const alturaGraficos = Math.max(150, Math.max(entradasTopo.length, despesasTopo.length) * 30 + 34);

  // Clicar na barra filtra a lista; clicar de novo desfaz. A barra "outras N
  // categorias" filtra por tudo o que ela resume.
  const filtrarPorBarra = (movs: typeof extratoPeriodo, tipo: "in" | "out", cat: string | null, topo: { name: string }[]) => {
    if (!cat) return movs;
    if (cat.startsWith("outras ")) {
      const noTopo = new Set(topo.filter((f) => !f.name.startsWith("outras ")).map((f) => f.name));
      return movs.filter((m) => m.tipo !== tipo || !noTopo.has(m.cat || "(sem categoria)"));
    }
    return movs.filter((m) => m.tipo !== tipo || (m.cat || "(sem categoria)") === cat);
  };
  const entradasLista = useMemo(
    () => filtrarPorBarra(extratoPeriodo, "in", catEntrada, entradasTopo),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [extratoPeriodo, catEntrada, entradasTopo],
  );
  const saidasLista = useMemo(
    () => filtrarPorBarra(extratoPeriodo, "out", catSaida, despesasTopo),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [extratoPeriodo, catSaida, despesasTopo],
  );
  const alternar = (atual: string | null, cat: string) => (atual === cat ? null : cat);

  // Investimento em anúncios no período: as categorias marcadas no Plano de
  // contas (a Zaytan usa "Investimento em Meta Ads", a Laportec usa "Leads").
  // Some à parte, mas continua dentro das saídas — não é uma conta paralela.
  const anuncios = useMemo(() => {
    const doPeriodo = extratoPeriodo.filter((m) => m.tipo === "out" && flags.anunciosDe(m.cat));
    const porCategoria = new Map<string, number>();
    for (const m of doPeriodo) porCategoria.set(m.cat, (porCategoria.get(m.cat) ?? 0) + m.valor);
    return {
      total: Math.round(doPeriodo.reduce((s, m) => s + m.valor, 0) * 100) / 100,
      lancamentos: doPeriodo.length,
      // Marcada no plano mas sem gasto no período: a tela some em vez de mostrar zero.
      temCategoria: plano.some((c) => c.investimentoAnuncios),
      porCategoria: [...porCategoria.entries()].map(([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor),
    };
  }, [extratoPeriodo, plano, flags]);


  const linhasDetalhe = (tipo: "in" | "out") =>
    extratoPeriodo
      .filter((m) => m.tipo === tipo)
      .sort((a, b) => b.dataISO.localeCompare(a.dataISO))
      .map((m) => [fmtBR(m.dataISO), m.ia || m.desc, m.cat || "—", brl(m.valor)]);

  const handlePdf = async () => {
    try {
      setPdfBusy(true);
      setPdfCharts(true);
      await new Promise((r) => setTimeout(r, 450));
      const charts: PdfChart[] = [];
      const s1 = entradasChartRef.current?.querySelector("svg") as SVGSVGElement | null;
      if (s1) {
        const img = await svgToPng(s1, pdfChartOpts);
        charts.push({ ...img, caption: `Entradas por categoria · ${rotulo}`, legend: [{ label: "Entradas", color: COR_IN }] });
      }
      const s2 = (pdfDespesasRef.current ?? despesasChartRef.current)?.querySelector("svg") as SVGSVGElement | null;
      if (s2) {
        const img = await svgToPng(s2, pdfChartOpts);
        charts.push({ ...img, caption: `Saídas por categoria · ${rotulo}`, legend: [{ label: "Saídas", color: COR_OUT }] });
      }
      await exportToPdf({
        title: "Dashboard da Gestão",
        company: empresaNome,
        subtitle: `${rotulo}${fechado ? " · período fechado (só realizado)" : " · realizado + projetado"}`,
        kpis: [
          { label: mostrarAgora ? "Saldo no banco" : "Saldo no fim do período", value: brl(saldoExibido) },
          { label: "Receita recebida", value: brl(realizadoPeriodo.entrou) },
          { label: "Já saiu", value: brl(realizadoPeriodo.saiu) },
          { label: "Diferença", value: brl(Math.round((realizadoPeriodo.entrou - realizadoPeriodo.saiu) * 100) / 100) },
        ],
        charts,
        tables: [
          { title: "Entradas por categoria", columns: ["Categoria", "Total"], rows: entradasCat.map((c) => [c.name, brl(c.value)]) },
          { title: "Saídas por categoria", columns: ["Categoria", "Total"], rows: despesasCat.map((c) => [c.name, brl(c.value)]) },
          { title: "Entradas do extrato", columns: ["Data", "Descrição", "Categoria", "Valor"], rows: linhasDetalhe("in") },
          { title: "Saídas do extrato", columns: ["Data", "Descrição", "Categoria", "Valor"], rows: linhasDetalhe("out") },
        ],
        filename: "dashboard-finance-hub.pdf",
      });
    } catch (e) {
      console.error(e);
      toast.error("Não consegui gerar o PDF. Tente novamente.");
    } finally {
      setPdfCharts(false);
      setPdfBusy(false);
    }
  };

  return (
    <AppShell
      title="Dashboard"
      subtitle={`${empresaNome} · ${contaLabel} · ${rotulo}${fechado ? " · período fechado" : ""}`}
      actions={
        <>
          {/* Com 2+ contas, dá para ler o resultado de uma só sem sair daqui. */}
          <SeletorConta variant="acoes" />
          <SeletorPeriodo periodo={periodo} hoje={hoje} onChange={setPeriodo} />
          <Button variant="outline" className="h-9" onClick={handlePdf} disabled={pdfBusy}>
            {pdfBusy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <FileDown className="h-4 w-4 mr-1.5" />} PDF
          </Button>
          {temCap(caps, "mov_gerir") && (
            <Button asChild className="h-9 bg-foreground text-background hover:bg-foreground/90">
              <Link to="/financeiro/caixa" search={{ aba: "movimentacoes" }}><Plus className="h-4 w-4 mr-1.5" /> Nova transação</Link>
            </Button>
          )}
        </>
      }
    >
      {mostrarAgora && extratoStatus && extratoStatus.dias >= 7 && (
        <Card className="mb-6 card-elevated border-warning/40 bg-warning/5 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-warning/15">
              <CalendarClock className="h-[18px] w-[18px] stroke-[1.8] text-warning" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Seu extrato pode estar desatualizado</p>
              <p className="text-xs text-muted-foreground">
                A última movimentação foi há <strong>{extratoStatus.dias} dias</strong> ({extratoStatus.dataBR}).
                O saldo realizado só anda quando o extrato entra.
              </p>
            </div>
            <Button asChild className="h-9 shrink-0 bg-foreground text-background hover:bg-foreground/90">
              <Link to="/financeiro/extratos" search={{ aba: "importar" }}><Upload className="h-4 w-4 mr-1.5" /> Importar extrato</Link>
            </Button>
          </div>
        </Card>
      )}

      {/* O período em uma linha: o saldo do banco, o que entrou, o que saiu e a
          diferença — tudo já realizado. A previsão vive no Caixa › Projeção. */}
      <div className="mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold">Resumo do período</h3>
            <p className="text-sm text-muted-foreground">{rotulo} · o que já passou pelo extrato</p>
            {/* O saldo: confere com o Inter e, para o master, o ajuste. */}
            {!carregando && (interSaldo || isMaster) && (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px]">
                {interSaldo && (Math.abs(interDivergencia) > 0.01 ? (
                  <span className="text-warning-foreground">⚠ Inter: {brl(interSaldo.saldo)} · diferença de {brl(Math.abs(interDivergencia))}</span>
                ) : (
                  <span className="text-success">✓ saldo confere com o Inter</span>
                ))}
                {isMaster && (
                  <button onClick={() => setAjusteOpen(true)}
                    className="text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground">
                    ajustar saldo
                  </button>
                )}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {temInvestimentos && (
              <Button variant={verInvestimentos ? "default" : "outline"} size="sm"
                onClick={() => setVerInvestimentos((v) => !v)}
                title="Aplicação e resgate (e outras categorias fora dos relatórios) entram nos gráficos e no detalhamento">
                <PiggyBank className="mr-1 h-3.5 w-3.5" />
                {verInvestimentos ? "Ocultar investimentos" : "Mostrar investimentos"}
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link to="/financeiro/caixa" search={{ aba: "movimentacoes" }}>Ver lançamentos <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/financeiro/caixa" search={{ aba: "projecao" }}>Previsão de caixa <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
            </Button>
          </div>
        </div>
        {carregando ? (
          <Skeleton className="h-[120px] w-full rounded-xl" />
        ) : (
          <ResumoPeriodo
            saldo={saldoExibido}
            saldoRotulo={mostrarAgora ? "Saldo no banco" : "Saldo no fim do período"}
            saldoDetalhe={mostrarAgora ? `${contaLabel} · hoje` : `${contaLabel} · em ${fmtBR(periodo.ate)}`}
            recebido={realizadoPeriodo.entrou}
            qtdRecebido={realizadoPeriodo.qtdEntrou}
            saiu={realizadoPeriodo.saiu}
            qtdSaiu={realizadoPeriodo.qtdSaiu}
          />
        )}
        {!carregando && compensacao.ativa && (
          <p className="mt-2 text-[12px] text-muted-foreground">
            <strong className="text-foreground">{compensacao.categorias.join(" e ")}</strong> entram compensadas:
            {" "}{brl(compensacao.entrou)} de entrada − {brl(compensacao.saiu)} de saída ={" "}
            <strong className={compensacao.liquido >= 0 ? "text-success" : "text-destructive"}>{brl(compensacao.liquido)}</strong>
            {compensacao.liquido >= 0 ? " na receita" : " na saída"} · os {compensacao.qtd} lançamentos seguem inteiros no detalhamento.
          </p>
        )}
      </div>

      {/* ─── 2) Entradas e saídas por categoria, com o detalhe de cada uma ─── */}
      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          <Card className="card-elevated border-border/70 p-5">
            <h3 className="font-display text-base font-semibold">Receitas</h3>
            <p className="mb-3 text-xs text-muted-foreground">Entradas por categoria · {rotulo} · clique numa barra para filtrar a lista</p>
            <div ref={entradasChartRef}>
              {carregando ? (
                <Skeleton className="w-full rounded-xl" style={{ height: alturaGraficos }} />
              ) : entradasCat.length === 0 ? (
                <div className="grid place-items-center text-sm text-muted-foreground" style={{ height: alturaGraficos }}>Sem entradas no período.</div>
              ) : (
                <GraficoCategorias dados={entradasTopo} cor={COR_IN} altura={alturaGraficos}
                  selecionada={catEntrada} onSelecionar={(c) => setCatEntrada((a) => alternar(a, c))} />
              )}
            </div>
          </Card>
          <ListaExtrato tipo="in" movimentos={entradasLista} rotulo={rotulo}
            carregando={carregando} nomeConta={nomeConta}
            filtro={catEntrada} onLimparFiltro={() => setCatEntrada(null)} />
        </div>

        <div className="space-y-4">
          <Card className="card-elevated border-border/70 p-5">
            <h3 className="font-display text-base font-semibold">Despesas</h3>
            <p className="mb-3 text-xs text-muted-foreground">Saídas por categoria · {rotulo} · clique numa barra para filtrar a lista</p>
            <div ref={despesasChartRef}>
              {carregando ? (
                <Skeleton className="w-full rounded-xl" style={{ height: alturaGraficos }} />
              ) : despesasCat.length === 0 ? (
                <div className="grid place-items-center text-sm text-muted-foreground" style={{ height: alturaGraficos }}>Sem despesas lançadas no período.</div>
              ) : (
                <GraficoCategorias dados={despesasTopo} cor={COR_OUT} altura={alturaGraficos}
                  selecionada={catSaida} onSelecionar={(c) => setCatSaida((a) => alternar(a, c))} />
              )}
            </div>
          </Card>
          <ListaExtrato tipo="out" movimentos={saidasLista} rotulo={rotulo}
            carregando={carregando} nomeConta={nomeConta}
            filtro={catSaida} onLimparFiltro={() => setCatSaida(null)} />
        </div>
      </div>

      {/* ─── 5) Próximos movimentos ─── */}
      <div className="mb-6">
        <Card className="card-elevated border-border/70 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-display text-base font-semibold">Próximos movimentos</h3>
              <p className="text-xs text-muted-foreground">
                {proximos.length === 0 ? "Nada em aberto à frente" : "O que vence a partir de hoje"}
              </p>
            </div>
            <Link to="/financeiro/pagamentos" search={{ aba: "contas" }} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              Ver todos <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <ul className="space-y-1">
            {proximos.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-lg px-2.5 py-2.5 transition-colors hover:bg-secondary/60">
                <div className={`grid h-9 w-9 place-items-center rounded-lg ${c.tipo === "in" ? "bg-success/10 text-success" : "bg-secondary text-foreground"}`}>
                  {c.tipo === "in" ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.descricao}</p>
                  <p className="text-[13px] font-medium text-foreground/80">
                    {fmtBR(c.data)} <span className="font-normal text-muted-foreground">· {ROTULO_ORIGEM[c.origem]}</span>
                  </p>
                </div>
                <span className={`font-numeric text-sm font-semibold tabular-nums ${c.tipo === "in" ? "text-success" : "text-foreground"}`}>
                  {c.tipo === "in" ? "+" : "−"}{brl(c.valor)}
                </span>
              </li>
            ))}
            {proximos.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">Nenhum compromisso em aberto.</li>}
          </ul>
        </Card>
      </div>

      {/* ─── 6) Investimento em anúncios (categoria marcada no plano) ─── */}
      {anuncios.temCategoria && anuncios.total > 0 && (
        <Card className="mb-6 card-elevated border-border/70 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="font-display text-base font-semibold">Investimento em anúncios</h3>
              <p className="text-xs text-muted-foreground">
                {rotulo} · {anuncios.lancamentos} lançamento(s) · já contabilizado dentro das saídas
              </p>
              <p className="mt-3 font-numeric text-2xl font-semibold tabular-nums">{brl(anuncios.total)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {anuncios.porCategoria.slice(0, 4).map((c) => (
                <div key={c.nome} className="rounded-lg bg-secondary/60 px-3 py-1.5">
                  <p className="max-w-[160px] truncate text-[11px] text-muted-foreground">{c.nome}</p>
                  <p className="font-numeric text-[13px] font-semibold tabular-nums">{brl(c.valor)}</p>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* ─── 7) Boletos / PIX com código no período ─── */}
      {boletosDoPeriodo.length > 0 && (
        <Card className="mb-6 card-elevated border-border/70 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-display text-base font-semibold">Boletos / PIX do período</h3>
              <p className="text-xs text-muted-foreground">{boletosDoPeriodo.length} com código cadastrado · {rotulo}</p>
            </div>
            <Link to="/financeiro/pagamentos" search={{ aba: "contas" }} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              Ver em Contas do mês <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {boletosDoPeriodo.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2.5">
                <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${p.tipo === "in" ? "bg-success/10 text-success" : "bg-secondary text-foreground"}`}>
                  {p.tipo === "in" ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.descricao}</p>
                  <p className="text-[12px] text-muted-foreground">vence {fmtBR(p.data)}{p.categoria ? ` · ${p.categoria}` : ""}</p>
                </div>
                <BoletosCell boletos={p.boletos} />
                <span className={`w-28 shrink-0 text-right font-numeric text-sm font-semibold tabular-nums ${p.tipo === "in" ? "text-success" : ""}`}>
                  {p.tipo === "in" ? "+" : "−"}{brl(p.valor)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Render fora da tela só durante a exportação do PDF. */}
      {pdfCharts && (
        <div aria-hidden style={{ position: "fixed", left: -10000, top: 0, width: 908, pointerEvents: "none" }}>
          <div style={{ width: 908, height: 470 }} ref={pdfDespesasRef}>
            <PdfDespesasChart data={despesasCat} ct={ct} />
          </div>
        </div>
      )}

      {isMaster && (
        <AjusteSaldoDialog
          open={ajusteOpen}
          onOpenChange={setAjusteOpen}
          contas={contas}
          contaIdAtiva={contaId}
          saldoAtual={saldoAtual}
          pendentes={pendentesCount}
        />
      )}
    </AppShell>
  );
}

// Versão de impressão do gráfico de despesas (sem animação, fonte maior).
function PdfDespesasChart({ data, ct }: { data: { name: string; value: number }[]; ct: ChartColors }) {
  const tick = { fill: ct.label, fontSize: 13, fontWeight: 500 };
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ left: 0, right: 12, top: 28, bottom: 8 }}>
        <CartesianGrid stroke={ct.grid} vertical={false} />
        <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} tick={{ ...tick, fontSize: 12 }} angle={-30} textAnchor="end" height={86} tickMargin={6} />
        <YAxis tickLine={false} axisLine={false} tick={tick} tickFormatter={(v) => fmtK(v)} />
        <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={72} isAnimationActive={false}>
          {data.map((_, i) => (
            <Cell key={i} fill={["#FF4D1C", ct.ink, "#D63B0F", "#888888", "#A0522D", "#3B82F6", "#9333EA"][i % 7]} />
          ))}
          <LabelList dataKey="value" content={<SaldoBarLabel />} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
