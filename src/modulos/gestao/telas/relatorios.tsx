import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { SeletorConta } from "@/components/seletor-conta";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  FileDown, FileSpreadsheet, Printer, Calendar, CalendarClock, Layers, Activity,
  ArrowUpRight, ArrowDownRight, TrendingUp, TrendingDown, Wallet, Trophy, Hash,
  Inbox, SearchX, Loader2,
  PiggyBank,
} from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend, Area, Line, LabelList, Label, ReferenceLine,
} from "recharts";
import { brl, fmtK } from "@/lib/format";
import {
  montarRelatorioCategorias, type LinhaCategoria, type ModeloRelatorio,
} from "@/lib/relatorio-categorias";
import { useMovimentacoesRelatorio, useContasBancarias, usePlanoContas, type Conta, type Movimentacao, type MovimentacaoRel } from "@/lib/queries";
import { useEmpresa } from "@/lib/empresa";
import { exportToPdf, exportToXlsx, svgToPng, type PdfChart, type PdfTable } from "@/lib/export";
import { rotuloCategoria } from "@/modulos/gestao/dashboard/categorias";
import { agrupaPorMes, agrupaPorDia, agrupaPorCategoria, agrupaPorCategoriaGeral, labelMes } from "@/lib/agregacoes";
import { useChartColors, useTheme, type ChartColors } from "@/lib/theme";
import { FiltrosMovimentacoes } from "@/components/FiltrosMovimentacoes";
import {
  aplicaFiltros, deslocamentoCompetencia, FILTROS_VAZIO, resumoPeriodo, type Filtros,
} from "@/lib/filtros-movimentacoes";

type ReportType = "mensal" | "anual" | "categoria" | "fluxo" | "receitas" | "despesas";

type IconeLucide = React.ComponentType<{ className?: string }>;

const TYPES: { id: ReportType; label: string; icon: typeof Calendar; desc: string }[] = [
  { id: "mensal", label: "Mensal", icon: Calendar, desc: "Entradas × Saídas por mês" },
  { id: "anual", label: "Evolução", icon: TrendingUp, desc: "Tendência e acumulado" },
  { id: "categoria", label: "Por categoria", icon: Layers, desc: "Despesas por categoria" },
  { id: "fluxo", label: "Fluxo de Caixa", icon: Activity, desc: "Entradas vs Saídas por dia" },
  { id: "receitas", label: "Receitas", icon: ArrowUpRight, desc: "Entradas por categoria" },
  { id: "despesas", label: "Despesas", icon: ArrowDownRight, desc: "Saídas por categoria" },
];

const COR_IN = "#1F7A3A";
const COR_OUT = "#D63B0F";
// Paleta da pizza; o índice 1 (tinta) é substituído por uma cor do tema em runtime.
const piePalette = (ink: string) => ["#FF4D1C", ink, "#1F7A3A", "#D63B0F", "#888888", "#A0522D", "#3B82F6", "#9333EA", "#E0A800", "#14B8A6"];
const MODELOS: { id: ModeloRelatorio; label: string; desc: string }[] = [
  { id: "sintetico", label: "Sintético", desc: "Todas as categorias com totais" },
  { id: "analitico", label: "Analítico", desc: "Categorias abertas lançamento a lançamento" },
];

const fmtPct = (p: number | null) => (p == null ? "" : `${p.toFixed(1).replace(".", ",")}%`);

// O bloco "Saídas por categoria" só acompanha relatórios cuja tabela principal
// não é por categoria (senão a mesma tabela sairia duas vezes).
const precisaBlocoSaidas = (t: ReportType) => t === "mensal" || t === "anual" || t === "fluxo";

// Linhas do módulo de categorias → células da tabela (tela, PDF e Excel usam as
// mesmas). O estilo (negrito/indentação) vai à parte, via rowKinds.
function linhasParaTabela(linhas: LinhaCategoria[], modelo: ModeloRelatorio) {
  const analitico = modelo === "analitico";
  const columns = analitico
    ? ["Categoria / Lançamento", "Data", "Valor", "% do total"]
    : ["Categoria", "Total", "% do total"];
  const rows = linhas.map((l) => {
    const nome = l.foraRelatorios ? `${l.texto} (fora dos relatórios)` : l.texto;
    const valor = l.valor == null ? "—" : brl(l.valor);
    return analitico ? [nome, l.data ?? "", valor, fmtPct(l.pct)] : [nome, valor, fmtPct(l.pct)];
  });
  return { columns, rows, rowKinds: linhas.map((l) => l.nivel) };
}

// Matriz mês × categoria PAI (analítico do Mensal/Evolução): receitas em cima,
// despesas embaixo, com totais e resultado por mês.
function matrizMensal(movs: MovimentacaoRel[], plano: Conta[]) {
  const meses = [...new Set(movs.map((m) => m.mesComp))].sort();
  const paiDe = new Map<string, string>(); // caminho → nome do pai
  for (const c of plano) if (!c.parentId) paiDe.set(c.nome, c.nome);
  const raizDe = (cat: string) => {
    const raiz = (cat.split("/")[0] ?? "").trim();
    return paiDe.has(raiz) ? raiz : "(sem categoria)";
  };
  const soma = new Map<string, Map<string, number>>(); // raiz → ym → valor
  for (const m of movs) {
    const r = raizDe(m.cat ?? "");
    const porMes = soma.get(r) ?? new Map();
    porMes.set(m.mesComp, (porMes.get(m.mesComp) ?? 0) + m.valor);
    soma.set(r, porMes);
  }
  const pais = (tipo: "receita" | "despesa") =>
    plano
      .filter((c) => !c.parentId && c.tipo === tipo)
      .sort((a, b) => (a.codigo || "￿").localeCompare(b.codigo || "￿", "pt-BR", { numeric: true }));
  const linha = (nome: string, kind: "pai" | "total") => {
    const porMes = soma.get(nome);
    const vals = meses.map((ym) => porMes?.get(ym) ?? 0);
    return { cells: [nome, ...vals.map(brl), brl(vals.reduce((s, v) => s + v, 0))], kind };
  };
  const totalTipo = (tipo: "in" | "out", rotulo: string) => {
    const vals = meses.map((ym) =>
      movs.filter((m) => m.tipo === tipo && m.mesComp === ym).reduce((s, m) => s + m.valor, 0)
    );
    return { cells: [rotulo, ...vals.map(brl), brl(vals.reduce((s, v) => s + v, 0))], kind: "total" as const };
  };
  const semCat = soma.has("(sem categoria)") ? [linha("(sem categoria)", "pai")] : [];
  const rows = [
    ...pais("receita").map((c) => linha(c.nome, "pai")),
    totalTipo("in", "TOTAL DE ENTRADAS"),
    ...pais("despesa").map((c) => linha(c.nome, "pai")),
    ...semCat,
    totalTipo("out", "TOTAL DE SAÍDAS"),
  ];
  return {
    columns: ["Categoria", ...meses.map(labelMes), "Total"],
    rows: rows.map((r) => r.cells),
    rowKinds: rows.map((r) => r.kind),
  };
}

// As agregações são puras e moram em lib/agregacoes.ts: a tela de celular
// (telas/caixa-celular) monta os mesmos números a partir delas.

// ─── Peças visuais da tela ─────────────────────────────────────

// Cartão de indicador. Mesma hierarquia do KpiCard do Dashboard (ícone, rótulo
// pequeno, número grande) — só que local: importar de lá amarraria duas telas
// que evoluem por motivos diferentes.
function CartaoKpi({ label, value, hint, color, icon: Icone, valorTexto }: Kpi) {
  return (
    <Card className="group p-5 card-elevated border-border/70 transition-all duration-300 hover:-translate-y-0.5">
      <div className="flex items-center gap-2.5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary transition-colors group-hover:bg-primary/10">
          {Icone && <Icone className="h-[18px] w-[18px] stroke-[1.6] text-foreground transition-colors group-hover:text-primary" />}
        </div>
        <span className="min-w-0 text-[13px] font-medium leading-tight text-muted-foreground">{label}</span>
      </div>
      {/* Cartão cujo valor é NOME (a maior categoria) usa corpo menor e duas
          linhas: em 25px e uma linha só, "Folha De Pagamento" sai cortado. */}
      <p
        title={value}
        className={`mt-3.5 font-numeric font-semibold tracking-tight ${
          valorTexto ? "line-clamp-2 text-[19px] leading-snug" : "truncate whitespace-nowrap text-[25px] tabular-nums"
        } ${color ?? ""}`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs leading-snug text-muted-foreground">{hint}</p>}
    </Card>
  );
}

function EstadoVazio({ icone: Icone, texto }: { icone: IconeLucide; texto: string }) {
  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div>
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-secondary">
          <Icone className="h-5 w-5 stroke-[1.6] text-muted-foreground" />
        </div>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">{texto}</p>
      </div>
    </div>
  );
}

// Formato do que o recharts entrega em cada ponto do tooltip.
type PontoTooltip = {
  name?: string | number;
  value?: number | string | (number | string)[];
  color?: string;
  stroke?: string;
  fill?: string;
  dataKey?: unknown;
  payload?: unknown;
};
type ItemTooltip = { nome: string; valor: number; cor: string };

// Resultado do dia a partir das duas séries do fluxo — o total "somado" não
// diria nada (entradas + saídas), o que interessa é a diferença.
const resultadoDoDia = (itens: ItemTooltip[]) =>
  (itens.find((i) => i.nome === "Entradas")?.valor ?? 0) - (itens.find((i) => i.nome === "Saídas")?.valor ?? 0);

// Tooltip de TODOS os gráficos. O `contentStyle` cru não alinha valor à direita,
// não formata em real e não cabe uma linha de total — então o conteúdo é nosso.
function TooltipGrafico({
  active, payload, label, ct, resumo, pctDe, corPorNome,
}: {
  active?: boolean;
  payload?: PontoTooltip[];
  label?: React.ReactNode;
  ct: ChartColors;
  resumo?: { rotulo: string; calc: (itens: ItemTooltip[]) => number };
  pctDe?: number;
  corPorNome?: (nome: string) => string | undefined;
}) {
  const itens: ItemTooltip[] = (payload ?? []).flatMap((p) => {
    if (typeof p.value !== "number") return [];
    const nome = String(p.name ?? "");
    return [{ nome, valor: p.value, cor: corPorNome?.(nome) ?? p.color ?? p.stroke ?? p.fill ?? ct.ink }];
  });
  if (!active || itens.length === 0) return null;
  return (
    <div
      style={{
        background: ct.tooltip.background, border: ct.tooltip.border, color: ct.tooltip.color,
        borderRadius: 12, padding: "9px 11px", minWidth: 186, fontSize: 12,
        boxShadow: "0 10px 26px rgba(0,0,0,0.16)",
      }}
    >
      {label != null && label !== "" && (
        <div style={{ marginBottom: 6, fontSize: 11.5, fontWeight: 600, opacity: 0.72 }}>{label}</div>
      )}
      {itens.map((it) => (
        <div key={it.nome} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
          <span style={{ width: 8, height: 8, borderRadius: 9999, flex: "0 0 auto", background: it.cor }} />
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.nome}</span>
          <span style={{ flex: "0 0 auto", marginLeft: 12, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {brl(it.valor)}
            {pctDe ? <span style={{ opacity: 0.6 }}> · {((it.valor / pctDe) * 100).toFixed(1).replace(".", ",")}%</span> : null}
          </span>
        </div>
      ))}
      {resumo && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 6, paddingTop: 6, borderTop: `1px solid ${ct.grid}` }}>
          <span style={{ opacity: 0.72 }}>{resumo.rotulo}</span>
          <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{brl(resumo.calc(itens))}</span>
        </div>
      )}
    </div>
  );
}

type RotuloPizza = { cx?: number; cy?: number; midAngle?: number; outerRadius?: number; percent?: number; name?: string | number };

// Pizza das categorias gerais. Componente à parte porque o destaque no hover
// (fatia cheia, resto esmaecido) precisa de estado — e `buildReport` é função.
function PizzaCategorias({
  dados, cores, ct, anim, total, comLegenda,
}: {
  dados: { name: string; value: number }[];
  cores: string[];
  ct: ChartColors;
  anim: boolean;
  total: number;
  comLegenda: boolean;
}) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const corDe = (i: number) => cores[i % cores.length];
  const pct = (v: number) => (total ? `${((v / total) * 100).toFixed(1).replace(".", ",")}%` : "—");
  const destacado = ativo != null ? dados[ativo] : null;

  // Rótulo apontado só na versão sem legenda (o PDF): com a legenda ao lado
  // eles repetiriam nome e % em cima do desenho.
  const renderRotulo = (p: RotuloPizza) => {
    const { cx = 0, cy = 0, midAngle = 0, outerRadius = 0, percent = 0, name } = p;
    if (percent < 0.05) return null; // só as maiores recebem rótulo apontado
    const RADIAN = Math.PI / 180;
    const cos = Math.cos(-midAngle * RADIAN);
    const sin = Math.sin(-midAngle * RADIAN);
    const nome = String(name).length > 16 ? `${String(name).slice(0, 15)}…` : String(name);
    const sx = cx + outerRadius * cos, sy = cy + outerRadius * sin;                 // borda da fatia
    const mx = cx + (outerRadius + 14) * cos, my = cy + (outerRadius + 14) * sin;   // cotovelo
    const dir = cos >= 0 ? 1 : -1;
    const ex = mx + dir * 20, tx = ex + dir * 4;                                    // fim horizontal
    return (
      <g>
        <polyline points={`${sx},${sy} ${mx},${my} ${ex},${my}`} stroke={ct.axis} strokeWidth={1} fill="none" />
        <text x={tx} y={my} textAnchor={dir > 0 ? "start" : "end"} dominantBaseline="central">
          <tspan x={tx} dy="-0.35em" fontSize={11} fontWeight={700} fill={ct.ink}>{nome}</tspan>
          <tspan x={tx} dy="1.15em" fontSize={10} fill={ct.label}>{(percent * 100).toFixed(1).replace(".", ",")}%</tspan>
        </text>
      </g>
    );
  };

  const pizza = (
    <ResponsiveContainer>
      <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <Pie
          data={dados} dataKey="value" nameKey="name" innerRadius={comLegenda ? 62 : 56} outerRadius={comLegenda ? 104 : 100}
          paddingAngle={1.5} isAnimationActive={anim} labelLine={false} label={comLegenda ? undefined : renderRotulo}
          onMouseEnter={(_, i) => setAtivo(i)} onMouseLeave={() => setAtivo(null)}
        >
          {dados.map((_, i) => (
            <Cell key={i} fill={corDe(i)} stroke="none" fillOpacity={ativo == null || ativo === i ? 1 : 0.25} />
          ))}
          {/* O buraco do donut é espaço morto: leva o total (ou a fatia sob o cursor). */}
          <Label
            position="center"
            content={(p) => {
              const vb = p.viewBox;
              const cx = vb && "cx" in vb ? vb.cx ?? 0 : 0;
              const cy = vb && "cy" in vb ? vb.cy ?? 0 : 0;
              if (!cx || !cy) return null;
              const titulo = destacado ? destacado.name : "Total de saídas";
              const valor = destacado ? brl(destacado.value) : brl(total);
              return (
                <text x={cx} y={cy} textAnchor="middle">
                  <tspan x={cx} dy="-0.5em" fontSize={10.5} fontWeight={600} fill={ct.label} opacity={0.72}>
                    {titulo.length > 18 ? `${titulo.slice(0, 17)}…` : titulo}
                  </tspan>
                  <tspan x={cx} dy="1.55em" fontSize={13.5} fontWeight={700} fill={ct.ink}>{valor}</tspan>
                </text>
              );
            }}
          />
        </Pie>
        <Tooltip
          content={(p) => (
            <TooltipGrafico
              {...p} ct={ct} pctDe={total}
              corPorNome={(n) => {
                const i = dados.findIndex((d) => d.name === n);
                return i < 0 ? undefined : corDe(i);
              }}
            />
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );

  if (!comLegenda) return pizza;
  return (
    <div className="flex h-full w-full items-center gap-3 sm:gap-5">
      <ul className="max-h-full min-w-0 flex-[0_0_44%] overflow-y-auto pr-1">
        {dados.map((c, i) => (
          <li
            key={c.name}
            onMouseEnter={() => setAtivo(i)}
            onMouseLeave={() => setAtivo(null)}
            className={`flex items-center gap-2.5 rounded-md px-1.5 py-[5px] text-xs transition-colors ${
              ativo === i ? "bg-secondary" : ""
            } ${ativo != null && ativo !== i ? "opacity-45" : ""}`}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: corDe(i) }} />
            <span className="min-w-0 flex-1 truncate text-foreground" title={c.name}>{c.name}</span>
            <span className="shrink-0 font-numeric tabular-nums text-muted-foreground">{pct(c.value)}</span>
          </li>
        ))}
      </ul>
      <div className="h-full min-w-0 flex-1">{pizza}</div>
    </div>
  );
}

export function Relatorios() {
  const [type, setType] = useState<ReportType>("mensal");
  const [modelo, setModelo] = useState<ModeloRelatorio>("sintetico");
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIO);
  // Mesmo recorte da Visão geral: aplicação/resgate e transferência entre as
  // contas da própria empresa ficam de fora até o botão pedir.
  const [verInvestimentos, setVerInvestimentos] = useState(false);
  const movimentos = useMovimentacoesRelatorio(verInvestimentos);
  const movimentosComOcultos = useMovimentacoesRelatorio(true);
  const temInvestimentos = movimentosComOcultos.length > movimentos.length || verInvestimentos;
  const { data: contas = [] } = useContasBancarias();
  const { data: plano = [] } = usePlanoContas(); // plano de contas (categorias) p/ o filtro
  const { contaId, empresaId, empresas } = useEmpresa();
  const empresaNome = empresas.find((e) => e.id === empresaId)?.nome ?? "Empresa";
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);                          // diálogo "Exportar PDF"
  const [pdfSel, setPdfSel] = useState<Set<ReportType>>(new Set<ReportType>(["mensal"])); // tipos marcados p/ o PDF
  const [pdfRenderTypes, setPdfRenderTypes] = useState<ReportType[]>([]); // renderizados off-screen p/ rasterizar
  const pdfRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const { isDark } = useTheme();
  const ct = useChartColors();

  const ativas = contas.filter((c) => c.ativo);
  const contaLabel = contaId
    ? contas.find((c) => c.id === contaId)?.nome ?? "Conta"
    : ativas.length <= 1
      ? ativas[0]?.nome ?? "todas as contas"
      : "todas as contas";

  // Recorta pelas seleções da barra de filtros ANTES de agregar — assim KPIs,
  // gráfico, tabela e exportações (PDF/Excel) herdam o filtro automaticamente.
  // Filtra pela data de COMPETÊNCIA (não a data real): assim "conta no mês
  // anterior/seguinte" move o lançamento também no filtro de período.
  const movsFiltrados = useMemo(() => aplicaFiltros(movimentos, filtros, (m) => m.dataComp), [movimentos, filtros]);

  // Categoria com regra de competência conta num mês e sai do caixa em outro —
  // é o que faz o relatório do mês diferir da Visão geral. Em vez de deixar a
  // conta para o usuário, a tela mostra quanto mudou de mês e para onde.
  const deslocado = useMemo(
    () => deslocamentoCompetencia(movimentos, filtros.de, filtros.ate),
    [movimentos, filtros.de, filtros.ate],
  );

  const { kpis, chart, table, columns, rowKinds } = useMemo(
    () => buildReport(type, movsFiltrados, ct, true, plano, modelo),
    [type, movsFiltrados, ct, plano, modelo]
  );

  // Bloco fixo "Saídas por categoria" (sempre sintético). Só nos relatórios em
  // que a tabela principal NÃO é por categoria — em Por categoria/Despesas ela
  // já é exatamente isso (sairia duplicado), e Receitas não mostra saídas.
  const saidasPorCategoria = useMemo(
    () => (precisaBlocoSaidas(type) ? montarRelatorioCategorias(plano, movsFiltrados, "despesa", "sintetico") : null),
    [type, plano, movsFiltrados]
  );

  // Gráfico no PDF sai SEMPRE claro; no modo escuro, recolore o SVG capturado.
  const pdfChartOpts = isDark
    ? {
        background: "#ffffff",
        forceTextColor: "#27272a",
        recolor: [
          { from: ct.ink, to: "#0D0C0C" },
          { from: ct.grid, to: "#F1F1F1" },
        ],
      }
    : { background: "#ffffff" };

  // Abre o diálogo já com o tipo em preview marcado.
  const abrirPdf = () => {
    setPdfSel(new Set([type]));
    setPdfOpen(true);
  };
  const togglePdf = (id: ReportType, on: boolean) =>
    setPdfSel((prev) => {
      const n = new Set(prev);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  // Gera UM PDF combinando as seções (gráfico + tabela) de cada tipo marcado.
  // Os gráficos são renderizados FORA da tela (sem animação) para rasterizar o
  // SVG já final; cada tipo vira uma seção com legenda e tabela própria.
  const gerarPdf = async () => {
    const tipos = TYPES.filter((t) => pdfSel.has(t.id)).map((t) => t.id);
    if (tipos.length === 0) return;
    if (movsFiltrados.length === 0) {
      toast.error("Sem movimentações no período para exportar.");
      return;
    }
    try {
      setPdfBusy(true);
      setPdfRenderTypes(tipos);
      // Espera os SVGs aparecerem. Sem animação (anim=false), assim que o recharts
      // monta o SVG ele já está final. Poll a cada 50ms até ~1,5s.
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 50));
        if (tipos.every((t) => pdfRefs.current[t]?.querySelector("svg"))) break;
      }

      const reports = tipos.map((t) => ({ t, r: buildReport(t, movsFiltrados, ct, false, plano, modelo) }));
      const soUm = tipos.length === 1;
      const charts: PdfChart[] = [];
      for (const { t, r } of reports) {
        const svg = pdfRefs.current[t]?.querySelector("svg") as SVGSVGElement | null;
        if (!svg) continue;
        const img = await svgToPng(svg, pdfChartOpts);
        charts.push({
          ...img,
          caption: TYPES.find((x) => x.id === t)!.label,
          // Com vários relatórios no mesmo PDF, os cards de cada um ficam na
          // própria seção (no topo do documento eles seriam de um tipo só).
          kpis: soUm ? undefined : r.kpis.map((k) => ({ label: k.label, value: k.value, hint: k.hint })),
          legend: r.legend,
        });
      }
      const tables: PdfTable[] = reports.map(({ t, r }) => ({
        title: TYPES.find((x) => x.id === t)!.label,
        columns: r.columns,
        rows: r.table,
        rowKinds: r.rowKinds,
      }));
      // Bloco "Saídas por categoria" (uma vez por PDF), só se algum tipo
      // MARCADO precisa dele — os relatórios por categoria já são essa tabela,
      // e ela sairia duplicada. Decidido pelos tipos do diálogo (não pelo tipo
      // em preview na tela).
      if (tipos.some(precisaBlocoSaidas)) {
        const bloco = montarRelatorioCategorias(plano, movsFiltrados, "despesa", "sintetico");
        const t = linhasParaTabela(bloco.linhas, "sintetico");
        tables.push({ title: "Saídas por categoria", columns: t.columns, rows: t.rows, rowKinds: t.rowKinds });
      }
      const modeloLabel = MODELOS.find((m) => m.id === modelo)!.label;
      await exportToPdf({
        title: soUm ? `Relatório ${TYPES.find((x) => x.id === tipos[0])!.label}` : "Relatórios",
        company: empresaNome,
        subtitle: `${contaLabel} · ${resumoPeriodo(filtros)} · ${modeloLabel}`,
        kpis: soUm ? reports[0].r.kpis.map((k) => ({ label: k.label, value: k.value, hint: k.hint })) : undefined,
        charts,
        tables,
        filename: soUm ? `relatorio-${tipos[0]}.pdf` : "relatorios-finance-hub.pdf",
      });
      setPdfOpen(false);
    } catch (e) {
      console.error(e);
      toast.error("Não consegui gerar o PDF. Tente novamente.");
    } finally {
      setPdfRenderTypes([]);
      setPdfBusy(false);
    }
  };

  // Excel: aba "Resumo" com os cards + detalhamento (hierarquia indentada) +
  // a aba obrigatória "Saídas por categoria" (exceto no relatório de Receitas).
  const handleXlsx = () => {
    // Excel não tem rowKinds: a hierarquia vira indentação no texto da 1ª célula.
    const indentar = (rows: (string | number)[][], kinds?: RowKind[]) =>
      rows.map((r, i) => {
        const k = kinds?.[i];
        const pad = k === "filha" ? "    " : k === "lancamento" || k === "vazio" ? "        " : "";
        return pad ? [`${pad}${r[0]}`, ...r.slice(1)] : r;
      });
    const sheets = [
      {
        name: "Resumo",
        columns: ["Indicador", "Valor", "Referência"],
        rows: [
          ["Relatório", TYPES.find((t) => t.id === type)!.label, ""],
          ["Modelo", MODELOS.find((m) => m.id === modelo)!.label, ""],
          ["Conta", contaLabel, ""],
          ["Período", resumoPeriodo(filtros), ""],
          ...kpis.map((k) => [k.label, k.value, k.hint ?? ""]),
        ] as (string | number)[][],
      },
      { name: type, columns, rows: indentar(table, rowKinds) },
    ];
    if (saidasPorCategoria) {
      const t = linhasParaTabela(saidasPorCategoria.linhas, "sintetico");
      sheets.push({ name: "Saídas por categoria", columns: t.columns, rows: indentar(t.rows, t.rowKinds) });
    }
    exportToXlsx({ filename: `relatorio-${type}-${modelo}`, sheets });
  };

  // O título repete o nome do menu: a tela tem porta própria no Financeiro e
  // também é a aba "Análises financeiras" do Dashboard (lá ele nem aparece).
  return (
    <AppShell
      title="Análise financeira"
      subtitle={`Análises de ${contaLabel}${verInvestimentos ? " · com investimentos" : ""} · exportação PDF, Excel e impressão`}
      actions={
        <>
          <SeletorConta variant="acoes" />
          {temInvestimentos && (
            <Button variant={verInvestimentos ? "default" : "outline"} className="h-9"
              onClick={() => setVerInvestimentos((v) => !v)}
              title="Aplicação e resgate (e outras categorias fora dos relatórios) entram nos números">
              <PiggyBank className="h-4 w-4 mr-1.5" />
              {verInvestimentos ? "Ocultar investimentos" : "Mostrar investimentos"}
            </Button>
          )}
          <Button variant="outline" className="h-9" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1.5" /> Imprimir
          </Button>
          <Button variant="outline" className="h-9" onClick={handleXlsx}>
            <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Excel
          </Button>
          <Button className="h-9 bg-foreground text-background hover:bg-foreground/90" onClick={abrirPdf}>
            <FileDown className="h-4 w-4 mr-1.5" />
            PDF
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* Sidebar de tipos */}
        <Card className="p-3 card-elevated border-border/70 h-fit">
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 px-2 py-2">Tipo de relatório</p>
          <div className="space-y-1">
            {TYPES.map((t) => (
              <button key={t.id} onClick={() => setType(t.id)}
                className={`w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                  type === t.id ? "bg-secondary" : "hover:bg-secondary/60"
                }`}>
                <t.icon className={`h-4 w-4 mt-0.5 ${type === t.id ? "text-primary" : "text-muted-foreground"}`} />
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${type === t.id ? "text-foreground" : "text-foreground/80"}`}>{t.label}</p>
                  <p className="text-xs text-muted-foreground">{t.desc}</p>
                </div>
              </button>
            ))}
          </div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 px-2 pt-4 pb-2">Modelo</p>
          <div className="space-y-1">
            {MODELOS.map((m) => (
              <button key={m.id} onClick={() => setModelo(m.id)}
                className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                  modelo === m.id ? "bg-secondary" : "hover:bg-secondary/60"
                }`}>
                <p className={`text-sm font-medium ${modelo === m.id ? "text-foreground" : "text-foreground/80"}`}>{m.label}</p>
                <p className="text-xs text-muted-foreground">{m.desc}</p>
              </button>
            ))}
          </div>
        </Card>

        {/* Preview */}
        <div className="min-w-0 space-y-6">
          {/* Filtros — recortam KPIs, gráfico, tabela e exportações */}
          <Card className="p-4 card-elevated border-border/70">
            <FiltrosMovimentacoes
              value={filtros}
              onChange={setFiltros}
              planoContas={plano}
              movimentos={movimentos}
              visiveis={movsFiltrados.length}
            />
          </Card>

          {deslocado.temDiferenca && (
            <div className="flex items-start gap-2.5 rounded-xl border border-border/70 bg-secondary/30 px-4 py-3 text-[13px]">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-muted-foreground">
                <strong className="text-foreground">Estes números são por competência</strong>, não pela data do
                pagamento — por isso não batem com a Visão geral, que segue o caixa.{" "}
                {(deslocado.saiuSaidas > 0 || deslocado.saiuEntradas > 0) && (
                  <>
                    Pago neste período e contado em outro mês:{" "}
                    {deslocado.saiuSaidas > 0 && <strong className="text-foreground">{brl(deslocado.saiuSaidas)} em saídas</strong>}
                    {deslocado.saiuSaidas > 0 && deslocado.saiuEntradas > 0 && " e "}
                    {deslocado.saiuEntradas > 0 && <strong className="text-foreground">{brl(deslocado.saiuEntradas)} em entradas</strong>}
                    .{" "}
                  </>
                )}
                {(deslocado.entrouSaidas > 0 || deslocado.entrouEntradas > 0) && (
                  <>
                    Veio de outro mês para cá:{" "}
                    {deslocado.entrouSaidas > 0 && <strong className="text-foreground">{brl(deslocado.entrouSaidas)} em saídas</strong>}
                    {deslocado.entrouSaidas > 0 && deslocado.entrouEntradas > 0 && " e "}
                    {deslocado.entrouEntradas > 0 && <strong className="text-foreground">{brl(deslocado.entrouEntradas)} em entradas</strong>}
                    .{" "}
                  </>
                )}
                Regra de {deslocado.categorias.join(", ")} — muda em Configurações › Plano de contas.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {kpis.map((k) => <CartaoKpi key={k.label} {...k} />)}
          </div>

          <Card className="p-4 sm:p-6 card-elevated border-border/70">
            <div className="mb-4">
              <h3 className="font-display text-lg font-semibold">{TYPES.find((t) => t.id === type)?.label}</h3>
              <p className="text-sm text-muted-foreground">{TYPES.find((t) => t.id === type)?.desc}</p>
            </div>
            {/* Em tela estreita o gráfico rola na horizontal: espremido em 370px
                (eixo de categoria + rótulo de valor) ele não mostra mais barra
                nenhuma. */}
            <div className="overflow-x-auto">
              <div className="h-[320px] min-w-[460px]">
                {movsFiltrados.length === 0 ? (
                  movimentos.length === 0 ? (
                    <EstadoVazio icone={Inbox} texto="Sem movimentações confirmadas ainda. Importe e aprove um extrato para ver os gráficos." />
                  ) : (
                    <EstadoVazio icone={SearchX} texto="Nenhuma movimentação corresponde aos filtros. Ajuste o período, as categorias ou a busca." />
                  )
                ) : (
                  chart
                )}
              </div>
            </div>
          </Card>

          <Card className="card-elevated border-border/70 overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h3 className="font-display text-base font-semibold">
                Detalhamento <span className="text-muted-foreground font-normal text-sm">· {MODELOS.find((m) => m.id === modelo)?.label}</span>
              </h3>
              <Badge variant="outline">{table.length} linhas</Badge>
            </div>
            <div className="overflow-x-auto max-h-[420px]">
              <TabelaRelatorio columns={columns} table={table} rowKinds={rowKinds} />
            </div>
          </Card>

          {/* Bloco fixo: Total de Saídas por Categoria (todo relatório exceto Receitas). */}
          {saidasPorCategoria && (
            <Card className="card-elevated border-border/70 overflow-hidden">
              <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                <h3 className="font-display text-base font-semibold">Saídas por categoria</h3>
                <Badge variant="outline" className="text-destructive border-destructive/30">{brl(saidasPorCategoria.total)}</Badge>
              </div>
              <div className="overflow-x-auto max-h-[420px]">
                {(() => {
                  const t = linhasParaTabela(saidasPorCategoria.linhas, "sintetico");
                  return <TabelaRelatorio columns={t.columns} table={t.rows} rowKinds={t.rowKinds} />;
                })()}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Gráficos renderizados FORA da tela (sem animação) só p/ rasterizar no PDF. */}
      {pdfRenderTypes.length > 0 && (
        <div aria-hidden style={{ position: "fixed", left: -10000, top: 0, width: 820, pointerEvents: "none" }}>
          {pdfRenderTypes.map((t) => (
            <div key={t} ref={(el) => { pdfRefs.current[t] = el; }} style={{ width: 820, height: 340 }}>
              {buildReport(t, movsFiltrados, ct, false, plano, modelo).chart}
            </div>
          ))}
        </div>
      )}

      {/* Diálogo: escolher um ou mais tipos p/ um PDF combinado. */}
      <Dialog open={pdfOpen} onOpenChange={(o) => { if (!pdfBusy) setPdfOpen(o); }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Exportar PDF</DialogTitle>
            <DialogDescription>
              Marque um ou mais tipos — todos entram no mesmo PDF, cada um com seu gráfico e tabela.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 py-1 max-h-[340px] overflow-y-auto">
            {TYPES.map((t) => (
              <label key={t.id} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-secondary/60 cursor-pointer">
                <Checkbox checked={pdfSel.has(t.id)} onCheckedChange={(v) => togglePdf(t.id, v === true)} />
                <t.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t.label}</p>
                  <p className="text-xs text-muted-foreground">{t.desc}</p>
                </div>
              </label>
            ))}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="ghost" size="sm" className="h-9"
              onClick={() => setPdfSel((prev) => (prev.size === TYPES.length ? new Set<ReportType>() : new Set(TYPES.map((t) => t.id))))}>
              {pdfSel.size === TYPES.length ? "Limpar" : "Selecionar todos"}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPdfOpen(false)} disabled={pdfBusy}>Cancelar</Button>
              <Button className="bg-foreground text-background hover:bg-foreground/90" onClick={gerarPdf} disabled={pdfBusy || pdfSel.size === 0}>
                {pdfBusy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <FileDown className="h-4 w-4 mr-1.5" />}
                Gerar PDF ({pdfSel.size})
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

// Tabela de detalhamento com estilo por papel da linha (rowKinds): categoria
// pai e TOTAL em destaque, filha indentada, lançamento esmaecido.
function TabelaRelatorio({
  columns, table, rowKinds,
}: {
  columns: string[]; table: (string | number)[][]; rowKinds?: RowKind[];
}) {
  const trClass = (k?: RowKind) =>
    k === "pai" ? "bg-secondary/25 font-semibold"
    : k === "total" ? "bg-secondary/50 font-bold border-t-2 border-border"
    : k === "lancamento" || k === "vazio" ? "text-muted-foreground"
    : "";
  const firstCellPad = (k?: RowKind) =>
    k === "filha" ? "pl-10" : k === "lancamento" || k === "vazio" ? "pl-14" : "px-6";
  return (
    <table className="w-full text-sm">
      <thead className="bg-secondary/40 text-xs uppercase tracking-wider text-muted-foreground sticky top-0">
        <tr>{columns.map((c) => <th key={c} className="text-left px-6 py-3 font-medium">{c}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-border">
        {table.map((row, i) => {
          const k = rowKinds?.[i];
          return (
            <tr key={i} className={`hover:bg-secondary/30 ${trClass(k)}`}>
              {row.map((v, j) => (
                <td key={j} className={`py-2.5 pr-6 ${j === 0 ? firstCellPad(k) : "pl-6"} ${
                  j === row.length - 1 ? "text-right font-numeric tabular-nums" : ""
                } ${k === "vazio" && j === 0 ? "italic" : ""}`}>{v}</td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

type Kpi = { label: string; value: string; hint?: string; color?: string; icon?: IconeLucide; valorTexto?: boolean };
type LegendItem = { label: string; color: string };
// `rowKinds` (alinhado a `table`) marca o papel de cada linha p/ estilo:
// pai/total em negrito, filha indentada, lançamento esmaecido.
export type RowKind = "pai" | "filha" | "lancamento" | "vazio" | "total";
type Report = {
  kpis: Kpi[]; chart: React.ReactNode; columns: string[];
  table: (string | number)[][]; rowKinds?: RowKind[]; legend: LegendItem[];
};

function buildReport(
  type: ReportType, movimentos: MovimentacaoRel[], ct: ChartColors, anim = true,
  plano: Conta[] = [], modelo: ModeloRelatorio = "sintetico"
): Report {
  // Estilos de eixo/legenda/pizza que acompanham o tema (claro/escuro).
  const tick = { fill: ct.label, fontSize: 12.5, fontWeight: 500 };
  const axisX = { tickLine: false, axisLine: false, tick, tickMargin: 8 };
  // Largura fixa no eixo de valores: no padrão do recharts o "-100,0K" de um
  // mês negativo fica com o sinal cortado.
  const axisY = { tickLine: false, axisLine: false, tick, tickMargin: 6, width: 66 };
  // A grade fica só na horizontal: linha vertical em gráfico de barras vira ruído.
  const grade = <CartesianGrid stroke={ct.grid} vertical={false} />;
  const cursorBarra = { fill: "rgba(127,127,127,0.08)" };
  const legendaProps = {
    iconType: "circle" as const,
    iconSize: 9,
    wrapperStyle: { fontSize: 12, paddingTop: 12 },
    formatter: (v: string) => <span style={{ color: ct.label }}>{v}</span>,
  };
  const margem = { left: 0, right: 10, top: 12, bottom: 0 };
  const pieColors = piePalette(ct.ink);
  // A legenda vai só p/ o PDF (sempre claro): usa tinta escura fixa, casando
  // com o gráfico já recolorido para claro.
  const inkPdf = "#0D0C0C";
  const pieColorsPdf = piePalette(inkPdf);
  switch (type) {
    case "mensal": {
      const meses = agrupaPorMes(movimentos);
      const ult = meses[meses.length - 1];
      const kpis: Kpi[] = [
        { label: "Entradas (mês)", value: brl(ult?.entradas ?? 0), color: "text-success", hint: ult ? ult.mes : "—", icon: TrendingUp },
        { label: "Saídas (mês)", value: brl(ult?.saidas ?? 0), color: "text-destructive", hint: ult ? ult.mes : "—", icon: TrendingDown },
        { label: "Resultado (mês)", value: brl(ult?.resultado ?? 0), color: (ult?.resultado ?? 0) >= 0 ? "text-success" : "text-destructive", icon: Wallet },
      ];
      const chart = (
        <ResponsiveContainer>
          <ComposedChart data={meses} margin={margem}>
            {grade}
            <XAxis dataKey="mes" {...axisX} />
            <YAxis {...axisY} tickFormatter={(v) => fmtK(v)} />
            <Tooltip cursor={cursorBarra} content={(p) => <TooltipGrafico {...p} ct={ct} />} />
            {/* Com resultado negativo a linha cruza o zero; sem a régua não dá p/ ver onde. */}
            <ReferenceLine y={0} stroke={ct.axis} strokeOpacity={0.45} />
            <Legend {...legendaProps} />
            <Bar name="Entradas" dataKey="entradas" fill={COR_IN} radius={[5, 5, 0, 0]} maxBarSize={34} isAnimationActive={anim} />
            <Bar name="Saídas" dataKey="saidas" fill={COR_OUT} radius={[5, 5, 0, 0]} maxBarSize={34} isAnimationActive={anim} />
            <Line name="Resultado" type="monotone" dataKey="resultado" stroke={ct.ink} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={anim} />
          </ComposedChart>
        </ResponsiveContainer>
      );
      const legend = [
        { label: "Entradas", color: COR_IN },
        { label: "Saídas", color: COR_OUT },
        { label: "Resultado", color: inkPdf },
      ];
      if (modelo === "analitico") {
        const m = matrizMensal(movimentos, plano);
        return { kpis, chart, legend, columns: m.columns, table: m.rows, rowKinds: m.rowKinds };
      }
      return {
        kpis, chart, legend,
        columns: ["Mês", "Entradas", "Saídas", "Resultado"],
        table: meses.map((m) => [m.mes, brl(m.entradas), brl(m.saidas), brl(m.resultado)]),
      };
    }

    case "anual": {
      const meses = agrupaPorMes(movimentos);
      let acc = 0;
      const data = meses.map((m) => ({ ...m, acumulado: (acc += m.resultado) }));
      const totIn = meses.reduce((s, m) => s + m.entradas, 0);
      const totOut = meses.reduce((s, m) => s + m.saidas, 0);
      const kpis: Kpi[] = [
        { label: "Entradas (período)", value: brl(totIn), color: "text-success", icon: TrendingUp },
        { label: "Saídas (período)", value: brl(totOut), color: "text-destructive", icon: TrendingDown },
        { label: "Resultado acumulado", value: brl(totIn - totOut), color: totIn - totOut >= 0 ? "text-success" : "text-destructive", icon: Wallet },
      ];
      // Entradas/saídas viram ÁREA (a tendência se lê pelo volume, não por duas
      // linhas quase paralelas); o acumulado fica tracejado por cima.
      const chart = (
        <ResponsiveContainer>
          <ComposedChart data={data} margin={margem}>
            <defs>
              <linearGradient id="relAreaIn" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COR_IN} stopOpacity={0.34} />
                <stop offset="100%" stopColor={COR_IN} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="relAreaOut" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COR_OUT} stopOpacity={0.3} />
                <stop offset="100%" stopColor={COR_OUT} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            {grade}
            <XAxis dataKey="mes" {...axisX} />
            <YAxis {...axisY} tickFormatter={(v) => fmtK(v)} />
            <Tooltip cursor={{ stroke: ct.axis, strokeOpacity: 0.4 }} content={(p) => <TooltipGrafico {...p} ct={ct} />} />
            <ReferenceLine y={0} stroke={ct.axis} strokeOpacity={0.45} />
            <Legend {...legendaProps} />
            <Area name="Entradas" type="monotone" dataKey="entradas" stroke={COR_IN} strokeWidth={2} fill="url(#relAreaIn)" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={anim} />
            <Area name="Saídas" type="monotone" dataKey="saidas" stroke={COR_OUT} strokeWidth={2} fill="url(#relAreaOut)" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={anim} />
            <Line name="Acumulado" type="monotone" dataKey="acumulado" stroke={ct.ink} strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={anim} />
          </ComposedChart>
        </ResponsiveContainer>
      );
      const legend = [
        { label: "Entradas", color: COR_IN },
        { label: "Saídas", color: COR_OUT },
        { label: "Acumulado", color: inkPdf },
      ];
      if (modelo === "analitico") {
        const m = matrizMensal(movimentos, plano);
        return { kpis, chart, legend, columns: m.columns, table: m.rows, rowKinds: m.rowKinds };
      }
      return {
        kpis, chart, legend,
        columns: ["Mês", "Entradas", "Saídas", "Resultado", "Acumulado"],
        table: data.map((m) => [m.mes, brl(m.entradas), brl(m.saidas), brl(m.resultado), brl(m.acumulado)]),
      };
    }

    case "categoria": {
      const rel = montarRelatorioCategorias(plano, movimentos, "despesa", modelo);
      const gerais = agrupaPorCategoriaGeral(movimentos, "out"); // resumo (pizza): por categoria geral
      const total = gerais.reduce((s, c) => s + c.value, 0);
      const pct = (v: number) => (total ? `${((v / total) * 100).toFixed(1).replace(".", ",")}%` : "—");
      const kpis: Kpi[] = [
        { label: "Total de Saídas", value: brl(rel.total), color: "text-destructive", icon: TrendingDown },
        { label: "Categorias gerais", value: String(gerais.length), icon: Layers },
        { label: "Maior categoria", value: gerais[0]?.name ?? "—", hint: gerais[0] ? brl(gerais[0].value) : undefined, icon: Trophy, valorTexto: true },
      ];
      // Preview (anim=true): legenda de TODAS as categorias com a % à direita +
      // pizza. No PDF (anim=false) sai SÓ a pizza (com rótulo apontado nas
      // maiores); a legenda vai desenhada abaixo via `legend` retornado.
      const chart = (
        <PizzaCategorias dados={gerais} cores={pieColors} ct={ct} anim={anim} total={total} comLegenda={anim} />
      );
      const t = linhasParaTabela(rel.linhas, modelo);
      return {
        kpis, chart,
        legend: gerais.map((c, i) => ({ label: `${c.name} · ${pct(c.value)}`, color: pieColorsPdf[i % pieColorsPdf.length] })),
        columns: t.columns, table: t.rows, rowKinds: t.rowKinds,
      };
    }

    case "fluxo": {
      const data = agrupaPorDia(movimentos);
      const tin = movimentos.filter((m) => m.tipo === "in").reduce((s, m) => s + m.valor, 0);
      const tout = movimentos.filter((m) => m.tipo === "out").reduce((s, m) => s + m.valor, 0);
      const kpis: Kpi[] = [
        { label: "Entradas", value: brl(tin), color: "text-success", icon: TrendingUp },
        { label: "Saídas", value: brl(tout), color: "text-destructive", icon: TrendingDown },
        { label: "Saldo", value: brl(tin - tout), color: tin - tout >= 0 ? "text-success" : "text-destructive", icon: Wallet },
      ];
      const chart = (
        <ResponsiveContainer>
          {/* Em período longo são ~100 dias: sem `preserveStartEnd` o eixo X vira
              uma mancha. As barras ficam finas, daí o raio menor. */}
          <BarChart data={data} margin={margem} barGap={1}>
            {grade}
            <XAxis dataKey="dia" {...axisX} interval="preserveStartEnd" minTickGap={26} />
            <YAxis {...axisY} tickFormatter={(v) => fmtK(v)} />
            <Tooltip
              cursor={cursorBarra}
              content={(p) => <TooltipGrafico {...p} ct={ct} resumo={{ rotulo: "Resultado do dia", calc: resultadoDoDia }} />}
            />
            <Legend {...legendaProps} />
            <Bar name="Entradas" dataKey="entradas" fill={COR_IN} radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={anim} />
            <Bar name="Saídas" dataKey="saidas" fill={COR_OUT} radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={anim} />
          </BarChart>
        </ResponsiveContainer>
      );
      const legend = [
        { label: "Entradas", color: COR_IN },
        { label: "Saídas", color: COR_OUT },
      ];
      if (modelo === "sintetico") {
        return {
          kpis, chart, legend,
          columns: ["Data", "Entradas", "Saídas", "Resultado do dia"],
          table: data.map((d) => [d.dia, brl(d.entradas), brl(d.saidas), brl(d.entradas - d.saidas)]),
        };
      }
      const ordenadas = [...movimentos].sort((a, b) => b.dataISO.localeCompare(a.dataISO));
      return {
        kpis, chart, legend,
        columns: ["Data", "Descrição", "Categoria", "Tipo", "Valor"],
        table: ordenadas.map((m) => [m.date, m.ia || m.desc, m.cat || "—", m.tipo === "in" ? "Entrada" : "Saída", brl(m.valor)]),
      };
    }

    case "receitas":
    case "despesas": {
      const tipo: "in" | "out" = type === "receitas" ? "in" : "out";
      const rel = montarRelatorioCategorias(plano, movimentos, tipo === "in" ? "receita" : "despesa", modelo);
      const cats = agrupaPorCategoria(movimentos, tipo);
      const lancs = movimentos.filter((m) => m.tipo === tipo);
      const cor = tipo === "in" ? "text-success" : "text-destructive";
      const fill = tipo === "in" ? COR_IN : COR_OUT;
      const kpis: Kpi[] = [
        { label: type === "receitas" ? "Total de Entradas" : "Total de Saídas", value: brl(rel.total), color: cor, icon: tipo === "in" ? TrendingUp : TrendingDown },
        { label: "Lançamentos", value: String(lancs.length), icon: Hash },
        { label: type === "receitas" ? "Maior fonte" : "Maior gasto", value: cats[0]?.name ?? "—", hint: cats[0] ? brl(cats[0].value) : undefined, icon: Trophy, valorTexto: true },
      ];
      // Barra deitada: aqui a grade útil é a VERTICAL (é nela que se lê o valor).
      const chart = (
        <ResponsiveContainer>
          <BarChart data={cats.slice(0, 10)} layout="vertical" margin={{ left: 0, right: 104, top: 6, bottom: 0 }} barCategoryGap="18%">
            <CartesianGrid stroke={ct.grid} horizontal={false} />
            <XAxis type="number" {...axisX} tickFormatter={(v) => fmtK(v)} />
            <YAxis type="category" dataKey="name" {...axisY} width={172} tick={{ ...tick, fontSize: 11.5 }} tickFormatter={(v: string) => rotuloCategoria(v)} />
            <Tooltip cursor={cursorBarra} content={(p) => <TooltipGrafico {...p} ct={ct} />} />
            <Bar name={type === "receitas" ? "Entradas" : "Saídas"} dataKey="value" fill={fill} radius={[0, 5, 5, 0]} maxBarSize={26} isAnimationActive={anim}>
              {/* Valor total EXATO no fim da barra (sem aproximar). */}
              <LabelList dataKey="value" position="right" offset={8} formatter={(v: number) => brl(v)} fill={ct.ink} fontSize={11.5} fontWeight={600} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      );
      const t = linhasParaTabela(rel.linhas, modelo);
      return {
        kpis, chart,
        legend: [{ label: type === "receitas" ? "Entradas por categoria" : "Saídas por categoria", color: fill }],
        columns: t.columns, table: t.rows, rowKinds: t.rowKinds,
      };
    }
  }
}
