// ─── Caixa, no celular: Fluxo, Análises e Cartões ───────────────────────────
// As três abas do Caixa que não são a lista de movimentações (essa vive em
// movimentacoes-celular.tsx), no desenho de app. Entram quando a janela é
// estreita (ver src/lib/tela.ts): no APK Android e no site aberto num celular.
// As telas de computador continuam em fluxo-caixa.tsx, relatorios.tsx e
// cartoes.tsx.
//
// NADA de regra vive aqui. As somas por mês, por dia e por categoria são as
// funções puras de lib/agregacoes — as MESMAS das Análises de computador —, os
// filtros são lib/filtros-movimentacoes e a conta da fatura é lib/cartoes.
//
// Uma diferença consciente em relação ao computador: o Fluxo realizado do
// celular lê uma janela de meses (6/12/24) em vez do filtro de período, porque
// é o que o desenho pede e é o que cabe numa tela de 360 — o mês a mês é a
// leitura que se faz em pé. Os números saem do mesmo lugar.
import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area,
  Line,
  ComposedChart,
} from "recharts";
import { ChevronLeft, ChevronRight, CreditCard, Info } from "lucide-react";
import { brl, fmtK } from "@/lib/format";
import { hojeISO, nomeMesLongo } from "@/lib/datas";
import { useChartColors } from "@/lib/theme";
import { SeletorConta } from "@/components/seletor-conta";
import {
  useMovimentacoesRelatorio,
  useCartoes,
  useCartaoLancamentos,
  type Cartao,
} from "@/lib/queries";
import {
  agrupaPorMes,
  agrupaPorDia,
  agrupaPorCategoria,
  agrupaPorCategoriaGeral,
} from "@/lib/agregacoes";
import {
  aplicaFiltros,
  mesmoRange,
  rangePreset,
  FILTROS_VAZIO,
  PRESETS,
  type Filtros,
} from "@/lib/filtros-movimentacoes";
import { faturaDe, gastosPorCategoria, resumoPorFatura } from "@/lib/cartoes";

// As cores de série são as mesmas das telas de computador: verde entra,
// vermelho sai. O recharts grava a cor como atributo SVG e não resolve var(--…).
const COR_IN = "#1F7A3A";
const COR_OUT = "#D63B0F";
// Cinza não entra na paleta: ele é a cor do "resto" da rosca, e repetido numa
// fatia nomeada faria duas fatias diferentes parecerem a mesma.
const COR_ROSCA = ["#F84F2F", "#1F7A3A", "#F9AD26", "#3B82F6", "#9333EA"];
const COR_RESTO = "#9b9b9b";

// ─── 1) Fluxo realizado ─────────────────────────────────────────────────────
const JANELAS = [
  { meses: 6, titulo: "6 meses" },
  { meses: 12, titulo: "12 meses" },
  { meses: 24, titulo: "24 meses" },
];

export function FluxoCelular() {
  const movimentos = useMovimentacoesRelatorio();
  const ct = useChartColors();
  const [janela, setJanela] = useState(12);

  const meses = useMemo(() => agrupaPorMes(movimentos).slice(-janela), [movimentos, janela]);
  const ultimo = meses[meses.length - 1];
  const totalEntrou = meses.reduce((s, m) => s + m.entradas, 0);
  const totalSaiu = meses.reduce((s, m) => s + m.saidas, 0);

  return (
    <div className="space-y-3.5">
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {JANELAS.map((j) => (
          <Pastilha key={j.meses} ativa={j.meses === janela} onClick={() => setJanela(j.meses)}>
            Últimos {j.titulo}
          </Pastilha>
        ))}
        <SeletorConta variant="celular" />
      </div>

      {meses.length === 0 ? (
        <Vazio texto="Nenhuma movimentação confirmada ainda. Importe o extrato para ver o fluxo." />
      ) : (
        <>
          <section className="rounded-xl border border-border/70 bg-card p-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[12.5px] font-bold">Entradas e saídas</h2>
              <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                <Legenda cor={COR_IN}>Entradas</Legenda>
                <Legenda cor={COR_OUT}>Saídas</Legenda>
              </span>
            </div>
            <div className="mt-2.5 h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={meses} margin={{ top: 4, right: 2, bottom: 0, left: 0 }} barGap={2}>
                  <CartesianGrid stroke={ct.grid} vertical={false} />
                  <XAxis
                    dataKey="mes"
                    tick={{ fill: ct.label, fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    minTickGap={12}
                  />
                  <YAxis
                    tick={{ fill: ct.label, fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                    tickFormatter={(v) => fmtK(v)}
                  />
                  <Bar
                    dataKey="entradas"
                    fill={COR_IN}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={12}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="saidas"
                    fill={COR_OUT}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={12}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {ultimo && (
              <div className="mt-2.5 flex items-baseline justify-between border-t border-border/70 pt-2.5 text-[11.5px]">
                <span className="text-muted-foreground">{nomeMesLongo(ultimo.ym)}</span>
                <b
                  className={`text-[12.5px] tabular-nums ${ultimo.resultado >= 0 ? "text-success" : "text-destructive"}`}
                >
                  {ultimo.resultado >= 0 ? "+" : "−"}
                  {brl(Math.abs(ultimo.resultado))}
                </b>
              </div>
            )}
          </section>

          <TituloDaLista
            titulo="Resultado mês a mês"
            nota={`entrou ${brl(totalEntrou)} · saiu ${brl(totalSaiu)}`}
          />
          <section className="overflow-hidden rounded-xl border border-border/70">
            {[...meses].reverse().map((m) => (
              <div
                key={m.ym}
                className="border-t border-border/60 bg-card px-3 py-2.5 first:border-t-0"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <b className="text-[12.5px]">{nomeMesLongo(m.ym)}</b>
                  <b
                    className={`shrink-0 text-[12.5px] tabular-nums ${m.resultado >= 0 ? "text-success" : "text-destructive"}`}
                  >
                    {m.resultado >= 0 ? "+" : "−"}
                    {brl(Math.abs(m.resultado))}
                  </b>
                </div>
                <div className="mt-1 flex gap-3 text-[11px] tabular-nums text-muted-foreground">
                  <span className="text-success">{brl(m.entradas)}</span>
                  <span className="text-destructive">{brl(m.saidas)}</span>
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

// ─── 2) Análises financeiras ────────────────────────────────────────────────
export function AnalisesCelular() {
  const movimentos = useMovimentacoesRelatorio();
  const ct = useChartColors();
  // Mesmo filtro da tela de computador (por competência), aqui só com os
  // presets de período — os filtros finos ficam na aba Movimentações.
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIO);
  const movs = useMemo(
    () => aplicaFiltros(movimentos, filtros, (m) => m.dataComp),
    [movimentos, filtros],
  );

  const meses = useMemo(() => agrupaPorMes(movs), [movs]);
  const acumulado = useMemo(() => {
    let acc = 0;
    return meses.map((m) => ({ ...m, acumulado: (acc += m.resultado) }));
  }, [meses]);
  const dias = useMemo(() => agrupaPorDia(movs), [movs]);
  const despesasGerais = useMemo(() => agrupaPorCategoriaGeral(movs, "out"), [movs]);
  const receitas = useMemo(() => agrupaPorCategoria(movs, "in").slice(0, 5), [movs]);
  const despesas = useMemo(() => agrupaPorCategoria(movs, "out").slice(0, 5), [movs]);

  const ultimo = meses[meses.length - 1];
  const totalIn = meses.reduce((s, m) => s + m.entradas, 0);
  const totalOut = meses.reduce((s, m) => s + m.saidas, 0);
  const totalDespesas = despesasGerais.reduce((s, c) => s + c.value, 0);
  const eixoX = {
    tick: { fill: ct.label, fontSize: 10 },
    tickLine: false,
    axisLine: false,
    interval: "preserveStartEnd" as const,
    minTickGap: 14,
  };

  return (
    <div className="space-y-3.5">
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {PRESETS.map((p) => (
          <Pastilha
            key={p.id}
            ativa={mesmoRange(filtros, rangePreset(p.id))}
            onClick={() => setFiltros({ ...filtros, ...rangePreset(p.id) })}
          >
            {p.label}
          </Pastilha>
        ))}
        <SeletorConta variant="celular" />
      </div>

      {movs.length === 0 ? (
        <Vazio texto="Nenhum lançamento no período escolhido." />
      ) : (
        <>
          <CartaoGrafico
            titulo="Mensal"
            legenda="Entradas × saídas por mês"
            rodapeRotulo={ultimo ? `Resultado de ${nomeMesLongo(ultimo.ym)}` : "Resultado"}
            rodapeValor={brl(ultimo?.resultado ?? 0)}
            rodapePositivo={(ultimo?.resultado ?? 0) >= 0}
          >
            <BarChart data={meses} margin={{ top: 4, right: 2, bottom: 0, left: 0 }} barGap={2}>
              <CartesianGrid stroke={ct.grid} vertical={false} />
              <XAxis dataKey="mes" {...eixoX} />
              <YAxis
                tick={eixoX.tick}
                tickLine={false}
                axisLine={false}
                width={44}
                tickFormatter={(v) => fmtK(v)}
              />
              <Bar
                dataKey="entradas"
                fill={COR_IN}
                radius={[3, 3, 0, 0]}
                maxBarSize={14}
                isAnimationActive={false}
              />
              <Bar
                dataKey="saidas"
                fill={COR_OUT}
                radius={[3, 3, 0, 0]}
                maxBarSize={14}
                isAnimationActive={false}
              />
            </BarChart>
          </CartaoGrafico>

          <CartaoGrafico
            titulo="Evolução"
            legenda="Entradas, saídas e o acumulado"
            rodapeRotulo="Resultado acumulado"
            rodapeValor={brl(totalIn - totalOut)}
            rodapePositivo={totalIn - totalOut >= 0}
          >
            <ComposedChart data={acumulado} margin={{ top: 4, right: 2, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="analiseIn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COR_IN} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={COR_IN} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="analiseOut" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COR_OUT} stopOpacity={0.26} />
                  <stop offset="100%" stopColor={COR_OUT} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={ct.grid} vertical={false} />
              <XAxis dataKey="mes" {...eixoX} />
              <YAxis
                tick={eixoX.tick}
                tickLine={false}
                axisLine={false}
                width={44}
                tickFormatter={(v) => fmtK(v)}
              />
              <Area
                type="monotone"
                dataKey="entradas"
                stroke={COR_IN}
                strokeWidth={1.8}
                fill="url(#analiseIn)"
                dot={false}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="saidas"
                stroke={COR_OUT}
                strokeWidth={1.8}
                fill="url(#analiseOut)"
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="acumulado"
                stroke={ct.ink}
                strokeWidth={1.8}
                strokeDasharray="5 4"
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </CartaoGrafico>

          <CartaoRosca
            fatias={despesasGerais}
            total={totalDespesas}
            maior={despesasGerais[0]?.name ?? "—"}
          />

          <CartaoGrafico
            titulo="Fluxo"
            legenda="Entradas versus saídas, dia a dia"
            rodapeRotulo="Entrou no período"
            rodapeValor={brl(totalIn)}
            rodapePositivo
          >
            <BarChart data={dias} margin={{ top: 4, right: 2, bottom: 0, left: 0 }} barGap={1}>
              <CartesianGrid stroke={ct.grid} vertical={false} />
              <XAxis dataKey="dia" {...eixoX} minTickGap={26} />
              <YAxis
                tick={eixoX.tick}
                tickLine={false}
                axisLine={false}
                width={44}
                tickFormatter={(v) => fmtK(v)}
              />
              <Bar
                dataKey="entradas"
                fill={COR_IN}
                radius={[2, 2, 0, 0]}
                maxBarSize={8}
                isAnimationActive={false}
              />
              <Bar
                dataKey="saidas"
                fill={COR_OUT}
                radius={[2, 2, 0, 0]}
                maxBarSize={8}
                isAnimationActive={false}
              />
            </BarChart>
          </CartaoGrafico>

          <CartaoBarras
            titulo="Receitas"
            legenda="Maiores entradas por categoria"
            fatias={receitas}
            cor="bg-success"
            rodapeRotulo={`${movs.filter((m) => m.tipo === "in").length} entradas`}
            rodapeValor={brl(totalIn)}
          />

          <CartaoBarras
            titulo="Despesas"
            legenda="Maiores saídas por categoria"
            fatias={despesas}
            cor="bg-destructive"
            rodapeRotulo={`${movs.filter((m) => m.tipo === "out").length} saídas`}
            rodapeValor={brl(totalOut)}
          />
        </>
      )}
    </div>
  );
}

// ─── 3) Cartões ─────────────────────────────────────────────────────────────
export function CartoesCelular() {
  const hoje = hojeISO();
  const { data: cartoes = [], isLoading } = useCartoes();
  const { data: lancamentos = [] } = useCartaoLancamentos();
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [faturaSel, setFaturaSel] = useState<string | null>(null);

  const ativos = useMemo(
    () =>
      [...cartoes].sort(
        (a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome, "pt-BR"),
      ),
    [cartoes],
  );
  const aberto = ativos.find((c) => c.id === abertoId) ?? null;

  // Total das faturas abertas: a fatura de hoje de cada cartão ativo.
  const totalAberto = useMemo(
    () =>
      ativos
        .filter((c) => c.ativo)
        .reduce((soma, c) => {
          const mes = faturaDe(hoje, c);
          const gastos = lancamentos
            .filter(
              (l) => l.cartaoId === c.id && l.tipo === "out" && faturaDe(l.dataISO, c) === mes,
            )
            .reduce((s, l) => s + l.valor, 0);
          return soma + gastos;
        }, 0),
    [ativos, lancamentos, hoje],
  );

  if (aberto) {
    return (
      <DetalheDoCartao
        cartao={aberto}
        lancamentos={lancamentos.filter((l) => l.cartaoId === aberto.id)}
        hoje={hoje}
        faturaSel={faturaSel}
        onTrocarFatura={setFaturaSel}
        voltar={() => {
          setAbertoId(null);
          setFaturaSel(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-3.5">
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[88px] animate-pulse rounded-xl bg-secondary" />
          ))}
        </div>
      ) : ativos.length === 0 ? (
        <Vazio texto="Nenhum cartão cadastrado. Cadastre em Configurações › Ajustes do Financeiro." />
      ) : (
        <>
          <section className="rounded-xl bg-[var(--primary-soft)] p-4 text-[var(--primary-ink)]">
            <p className="text-[11px] font-semibold">Faturas abertas</p>
            <p className="mt-1.5 text-[22px] font-bold leading-none tracking-tight tabular-nums">
              {brl(totalAberto)}
            </p>
            <p className="mt-1.5 text-[11px] opacity-80">
              {ativos.filter((c) => c.ativo).length} cartão(ões) em uso
            </p>
          </section>

          <TituloDaLista titulo="Meus cartões" nota={`${ativos.length} cadastrado(s)`} />
          <section className="space-y-2">
            {ativos.map((c) => {
              const mes = faturaDe(hoje, c);
              const gastos = lancamentos
                .filter(
                  (l) => l.cartaoId === c.id && l.tipo === "out" && faturaDe(l.dataISO, c) === mes,
                )
                .reduce((s, l) => s + l.valor, 0);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setAbertoId(c.id)}
                  className="flex w-full items-center gap-2.5 rounded-xl border border-border/70 bg-card p-3 text-left"
                >
                  <span className="grid h-[30px] w-[42px] shrink-0 place-items-center rounded-lg bg-[var(--primary-tint)] text-[11px] font-extrabold text-primary">
                    {c.nome.slice(0, 3).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-bold">
                      {c.nome}
                      {!c.ativo && (
                        <span className="ml-1.5 font-normal text-muted-foreground">· inativo</span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      •••• {c.final || "—"}
                      {c.diaFechamento ? ` · fecha dia ${c.diaFechamento}` : ""}
                      {c.diaVencimento ? ` · vence dia ${c.diaVencimento}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end">
                    <span className="text-[11px] text-muted-foreground">Fatura aberta</span>
                    <b className="mt-0.5 text-[12.5px] tabular-nums">{brl(gastos)}</b>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </section>

          <p className="flex items-start gap-2 rounded-[10px] bg-[var(--primary-tint)] px-3 py-2.5 text-[11.5px] leading-snug text-muted-foreground">
            <Info className="mt-px h-4 w-4 shrink-0 text-primary" />
            Importe as faturas para classificar as compras e manter as análises em dia.
          </p>
        </>
      )}
    </div>
  );
}

function DetalheDoCartao({
  cartao,
  lancamentos,
  hoje,
  faturaSel,
  onTrocarFatura,
  voltar,
}: {
  cartao: Cartao;
  lancamentos: {
    id: string;
    dataISO: string;
    descricao: string;
    valor: number;
    tipo: "in" | "out";
    categoria: string;
  }[];
  hoje: string;
  faturaSel: string | null;
  onTrocarFatura: (mes: string | null) => void;
  voltar: () => void;
}) {
  const faturas = useMemo(() => resumoPorFatura(lancamentos, cartao), [lancamentos, cartao]);
  const faturaAtual = faturaDe(hoje, cartao);
  const fatura =
    faturas.find((f) => f.mes === faturaSel) ??
    faturas.find((f) => f.mes === faturaAtual) ??
    faturas[0] ??
    null;
  // As faturas vêm da mais nova para a mais antiga: "anterior" é o índice+1.
  const i = fatura ? faturas.findIndex((f) => f.mes === fatura.mes) : -1;

  const itens = useMemo(
    () =>
      fatura
        ? lancamentos
            .filter((l) => faturaDe(l.dataISO, cartao) === fatura.mes)
            .sort((a, b) => b.dataISO.localeCompare(a.dataISO))
        : [],
    [lancamentos, cartao, fatura],
  );
  const categorias = useMemo(() => gastosPorCategoria(itens), [itens]);
  const totalCategorias = categorias.reduce((s, c) => s + c.total, 0);

  return (
    <div className="space-y-3.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={voltar}
          aria-label="Voltar para os cartões"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-secondary"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold">{cartao.nome}</p>
          <p className="truncate text-[11px] text-muted-foreground">•••• {cartao.final || "—"}</p>
        </div>
      </div>

      {!fatura ? (
        <Vazio texto="Nenhuma compra importada para este cartão." />
      ) : (
        <>
          <section className="flex items-center rounded-xl border border-border/70 bg-card px-2 py-3">
            <button
              type="button"
              disabled={i + 1 >= faturas.length}
              onClick={() => onTrocarFatura(faturas[i + 1]?.mes ?? null)}
              aria-label="Fatura anterior"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1 text-center">
              <p className="text-[11px] text-muted-foreground">
                Fatura de {nomeMesLongo(fatura.mes)}
              </p>
              <p className="mt-1 text-[20px] font-bold leading-none tabular-nums">
                {brl(fatura.gastos)}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {fatura.itens} lançamento(s)
                {fatura.creditos > 0 ? ` · ${brl(fatura.creditos)} em pagamentos` : ""}
              </p>
            </div>
            <button
              type="button"
              disabled={i <= 0}
              onClick={() => onTrocarFatura(faturas[i - 1]?.mes ?? null)}
              aria-label="Fatura seguinte"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </section>

          {categorias.length > 0 && (
            <section className="rounded-xl border border-border/70 bg-card p-3.5">
              <h2 className="text-[12.5px] font-bold">Gastos por categoria</h2>
              <div className="mt-2.5 space-y-2">
                {categorias.slice(0, 5).map((c, n) => {
                  const pct =
                    totalCategorias > 0 ? Math.round((c.total / totalCategorias) * 100) : 0;
                  return (
                    <div key={c.categoria || "sem"}>
                      <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
                        <span className="truncate font-medium">
                          {c.categoria || "sem categoria"}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {brl(c.total)} · <b className="text-foreground">{pct}%</b>
                        </span>
                      </div>
                      <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, background: COR_ROSCA[n % COR_ROSCA.length] }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <TituloDaLista titulo="Lançamentos" nota={`${itens.length} na fatura`} />
          <section className="overflow-hidden rounded-xl border border-border/70">
            {itens.map((l) => (
              <div
                key={l.id}
                className="flex items-center gap-2.5 border-t border-border/60 bg-card px-3 py-2.5 first:border-t-0"
              >
                <span className="w-[38px] shrink-0 text-[11px] font-bold tabular-nums text-muted-foreground">
                  {l.dataISO.slice(8, 10)}/{l.dataISO.slice(5, 7)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold">{l.descricao}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {l.categoria || "sem categoria"}
                  </span>
                </span>
                <b
                  className={`shrink-0 whitespace-nowrap text-[12px] tabular-nums ${
                    l.tipo === "in" ? "text-success" : ""
                  }`}
                >
                  {l.tipo === "in" ? "+" : ""}
                  {brl(l.valor)}
                </b>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

// ─── Peças ──────────────────────────────────────────────────────────────────
function CartaoGrafico({
  titulo,
  legenda,
  rodapeRotulo,
  rodapeValor,
  rodapePositivo,
  children,
}: {
  titulo: string;
  legenda: string;
  rodapeRotulo: string;
  rodapeValor: string;
  rodapePositivo?: boolean;
  children: ReactElement;
}) {
  return (
    <section className="rounded-xl border border-border/70 bg-card p-3.5">
      <h2 className="text-[12.5px] font-bold">{titulo}</h2>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{legenda}</p>
      <div className="mt-2.5 h-[170px]">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
      <div className="mt-2.5 flex items-baseline justify-between gap-2 border-t border-border/70 pt-2.5 text-[11.5px]">
        <span className="truncate text-muted-foreground">{rodapeRotulo}</span>
        <b
          className={`shrink-0 text-[12.5px] tabular-nums ${
            rodapePositivo === undefined ? "" : rodapePositivo ? "text-success" : "text-destructive"
          }`}
        >
          {rodapeValor}
        </b>
      </div>
    </section>
  );
}

// A rosca é desenhada com conic-gradient: um gráfico de pizza do recharts em
// 336px de largura gasta mais do que entrega.
function CartaoRosca({
  fatias,
  total,
  maior,
}: {
  fatias: { name: string; value: number }[];
  total: number;
  maior: string;
}) {
  const topo = fatias.slice(0, 5);
  let acumulado = 0;
  const paradas = topo.map((f, i) => {
    const de = total > 0 ? (acumulado / total) * 100 : 0;
    acumulado += f.value;
    const ate = total > 0 ? (acumulado / total) * 100 : 0;
    return `${COR_ROSCA[i % COR_ROSCA.length]} ${de}% ${ate}%`;
  });
  const resto = total - topo.reduce((s, f) => s + f.value, 0);
  if (resto > 0.005) paradas.push(`${COR_RESTO} ${(acumulado / total) * 100}% 100%`);

  return (
    <section className="rounded-xl border border-border/70 bg-card p-3.5">
      <h2 className="text-[12.5px] font-bold">Por categoria</h2>
      <p className="mt-0.5 text-[11px] text-muted-foreground">Distribuição das despesas</p>
      <div className="mt-3 flex flex-col items-center gap-3">
        <div
          className="grid h-[104px] w-[104px] place-items-center rounded-full"
          style={{ background: `conic-gradient(${paradas.join(", ")})` }}
        >
          <div className="grid h-[64px] w-[64px] place-items-center rounded-full bg-card text-center">
            <span>
              <b className="block text-[12px] leading-none tabular-nums">R$ {fmtK(total)}</b>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">total</span>
            </span>
          </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-x-3 gap-y-1.5">
          {topo.map((f, i) => (
            <span
              key={f.name}
              className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground"
            >
              <i
                className="h-[7px] w-[7px] shrink-0 rounded-sm"
                style={{ background: COR_ROSCA[i % COR_ROSCA.length] }}
              />
              <span className="truncate">{f.name}</span>
              <b className="ml-auto shrink-0 text-foreground">
                {total > 0 ? Math.round((f.value / total) * 100) : 0}%
              </b>
            </span>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-2 border-t border-border/70 pt-2.5 text-[11.5px]">
        <span className="truncate text-muted-foreground">Maior categoria</span>
        <b className="shrink-0 truncate text-[12.5px]">{maior}</b>
      </div>
    </section>
  );
}

function CartaoBarras({
  titulo,
  legenda,
  fatias,
  cor,
  rodapeRotulo,
  rodapeValor,
}: {
  titulo: string;
  legenda: string;
  fatias: { name: string; value: number }[];
  cor: string;
  rodapeRotulo: string;
  rodapeValor: string;
}) {
  const maior = fatias[0]?.value ?? 0;
  return (
    <section className="rounded-xl border border-border/70 bg-card p-3.5">
      <h2 className="text-[12.5px] font-bold">{titulo}</h2>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{legenda}</p>
      <div className="mt-2.5 space-y-2.5">
        {fatias.map((f) => (
          <div key={f.name}>
            <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
              <span className="truncate font-medium">{f.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{brl(f.value)}</span>
            </div>
            <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-secondary">
              <div
                className={`h-full rounded-full ${cor}`}
                style={{ width: `${maior > 0 ? (f.value / maior) * 100 : 0}%` }}
              />
            </div>
          </div>
        ))}
        {fatias.length === 0 && (
          <p className="py-4 text-center text-[12px] text-muted-foreground">Nada no período.</p>
        )}
      </div>
      <div className="mt-2.5 flex items-baseline justify-between gap-2 border-t border-border/70 pt-2.5 text-[11.5px]">
        <span className="truncate text-muted-foreground">{rodapeRotulo}</span>
        <b className="shrink-0 text-[12.5px] tabular-nums">{rodapeValor}</b>
      </div>
    </section>
  );
}

function Legenda({ cor, children }: { cor: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <i className="h-[7px] w-[7px] rounded-sm" style={{ background: cor }} /> {children}
    </span>
  );
}

function TituloDaLista({ titulo, nota }: { titulo: string; nota?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 px-1">
      <h2 className="text-[12.5px] font-bold">{titulo}</h2>
      {nota && <span className="text-[11px] text-muted-foreground">{nota}</span>}
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <div className="rounded-xl border border-border/70 px-3 py-8 text-center">
      <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[var(--primary-tint)]">
        <CreditCard className="h-5 w-5 text-primary" />
      </div>
      <p className="mx-auto mt-2.5 max-w-[260px] text-[12.5px] leading-snug text-muted-foreground">
        {texto}
      </p>
    </div>
  );
}

function Pastilha({
  ativa,
  onClick,
  children,
}: {
  ativa: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-[12px] font-semibold transition-colors ${
        ativa
          ? "border-primary bg-[var(--primary-soft)] text-foreground"
          : "border-border/70 bg-card text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}
