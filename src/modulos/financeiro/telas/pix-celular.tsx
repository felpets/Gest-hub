// ─── Pix do dia, no celular ─────────────────────────────────────────────────
// A mesma tela de Pagamentos › Pix do dia, no desenho de app: um dia por vez,
// cartões no lugar da tabela, seleção com o polegar e a barra de pagar grudada
// embaixo. Entra quando a janela é estreita (ver src/lib/tela.ts) — no APK
// Android e no site aberto num celular. A tela de computador continua
// exatamente como está, em pagamentos-diarios.tsx.
//
// NADA de regra vive aqui: dados, permissões e o tempo real (migração 58) vêm
// dos mesmos ganchos da tela de computador. Se a regra mudar lá, muda aqui.
//
// Cores, raios e espaçamentos saíram do arquivo do Figma (Make) — os tokens
// próprios do desenho estão em styles.css, presos a .app-celular. O tamanho do
// texto é a única liberdade: o desenho usa 8-9px numa tela de 360, ilegível no
// aparelho de verdade, então o texto pequeno sobe para 11-12px mantendo a
// mesma hierarquia.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Calendar,
  CheckCircle2,
  Copy,
  Pencil,
  Trash2,
  RotateCcw,
  History,
  AlertCircle,
  Loader2,
  Receipt,
  Users,
  FileSpreadsheet,
  ChevronRight,
  SlidersHorizontal,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { brl } from "@/lib/format";
import { fmtBR, hojeISO, pad } from "@/lib/datas";
import { exportToXlsx } from "@/lib/export";
import { useEmpresa } from "@/lib/empresa";
import { formatarChavePix, labelTipoChave } from "@/lib/pix";
import {
  usePagamentosDiarios,
  useDeletePagamentoDiario,
  useMarcarPagamentosDiarios,
  useEstornarPagamentoDiario,
  usePagamentosDiariosRH,
  useAutoresPagamentosDiarios,
  type PagamentoDiario,
} from "@/lib/queries";
import { usePixNaoVistos, zerarPixNaoVistos } from "@/lib/avisos-pix";
import { FormularioPixCelular } from "@/modulos/financeiro/telas/pix-celular-form";
import { HistoricoMes } from "@/modulos/financeiro/telas/pagamentos-diarios";
import { DetalheDoPix } from "@/modulos/financeiro/telas/pix-celular-detalhe";
import { TelaFiltrosPix } from "@/modulos/financeiro/telas/pix-celular-filtros";
import {
  FILTROS_PADRAO,
  contarPorSituacao,
  filtrarPagamentos,
  intervaloDe,
  quantosFiltros,
  situacaoDe,
  type Filtros,
  type Situacao,
} from "@/lib/pix-filtros";

const DIAS_CURTOS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];
const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

// Datas em ISO (YYYY-MM-DD) tratadas como texto: `new Date(iso)` no fuso do
// Brasil volta um dia, e a tira de dias mostraria a semana errada.
const daISO = (iso: string) => {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d);
};
const paraISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const somaDias = (iso: string, n: number) => {
  const d = daISO(iso);
  d.setDate(d.getDate() + n);
  return paraISO(d);
};
const porExtenso = (iso: string) => {
  const d = daISO(iso);
  return `${d.getDate()} de ${MESES[d.getMonth()]}`;
};

// A semana do dia escolhido, de domingo a sábado. Rola na horizontal: sete
// pastilhas não cabem em 360 px junto com o botão do calendário.
function semanaDe(iso: string): string[] {
  const inicio = somaDias(iso, -daISO(iso).getDay());
  return Array.from({ length: 7 }, (_, i) => somaDias(inicio, i));
}

export function PixCelular({
  pixAberto,
  formAberto,
  filtrosAbertos,
  onAbrirPix,
  onAbrirForm,
  onAbrirFiltros,
}: {
  /** Id do Pix cujo detalhe está aberto — vem de ?pix= na URL. */
  pixAberto: string | null;
  /** "novo", ou o id em edição — vem de ?form= na URL. */
  formAberto: string | null;
  /** Tela de filtros aberta — vem de ?filtros=1 na URL. */
  filtrosAbertos: boolean;
  onAbrirPix: (id: string | null) => void;
  onAbrirForm: (id: string | null) => void;
  onAbrirFiltros: (aberto: boolean) => void;
}) {
  const { isMaster } = useEmpresa();
  const { data: pagamentos = [], isLoading, error } = usePagamentosDiarios();
  const marcar = useMarcarPagamentosDiarios();
  const del = useDeletePagamentoDiario();

  const hoje = hojeISO();
  const [dia, setDia] = useState(hoje);
  // A situação em foco é parte dos filtros (a aba e a tela 06 mexem no mesmo
  // lugar). O que cada filtro faz está em lib/pix-filtros.ts, com teste.
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_PADRAO);
  const [sel, setSel] = useState<Set<string>>(new Set());

  const [acoesDe, setAcoesDe] = useState<PagamentoDiario | null>(null);
  const [estornoDe, setEstornoDe] = useState<PagamentoDiario | null>(null);
  const [excluirAlvo, setExcluirAlvo] = useState<PagamentoDiario | null>(null);
  const [excluirErro, setExcluirErro] = useState<string | null>(null);
  const [confirmarPagar, setConfirmarPagar] = useState<PagamentoDiario[] | null>(null);
  const [historicoAberto, setHistoricoAberto] = useState(false);

  // Com a tela aberta, o que os colegas lançam já chega pela lista (o ouvinte
  // da raiz invalida a consulta), então o contador do menu não tem o que contar.
  const naoVistos = usePixNaoVistos();
  useEffect(() => {
    if (naoVistos > 0) zerarPixNaoVistos();
  }, [naoVistos]);

  // Trocar de dia zera a seleção: pagar em massa só faz sentido dentro do que
  // está à vista — selecionar num dia e confirmar noutro seria uma armadilha.
  const irParaODia = (novo: string) => {
    setDia(novo);
    setSel(new Set());
  };

  // O detalhe pode ser de outro mês (link direto), por isso a autoria é buscada
  // pelo mês do pagamento aberto, e não só pelo dia em foco.
  const aberto = useMemo(
    () => pagamentos.find((p) => p.id === pixAberto) ?? null,
    [pagamentos, pixAberto],
  );
  const autoresQuery = useAutoresPagamentosDiarios((aberto?.data ?? dia).slice(0, 7));
  // O `?? {}` criaria um objeto novo a cada render, e todo useMemo que depende
  // dele recalcularia à toa — inclusive a lista inteira.
  const autores = useMemo(() => autoresQuery.data ?? {}, [autoresQuery.data]);

  // Quem lançou vem do histórico do mês em foco; é o que o filtro por autor usa.
  const autorDe = (id: string) => autores[id]?.email;

  // Tudo o que passa pelos filtros, menos a situação — é sobre este conjunto
  // que os totais e os contadores das abas são calculados.
  const doPeriodo = useMemo(
    () => filtrarPagamentos(pagamentos, filtros, dia, autorDe),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pagamentos, filtros, dia, autores],
  );
  const porSituacao = useMemo(() => contarPorSituacao(doPeriodo), [doPeriodo]);
  const lista = useMemo(
    () => doPeriodo.filter((p) => filtros.status.includes(situacaoDe(p))),
    [doPeriodo, filtros.status],
  );
  const umaSituacao = filtros.status.length === 1 ? filtros.status[0] : null;

  // Estornado fica de fora dos totais: o dinheiro não saiu (ou voltou).
  const validos = doPeriodo.filter((p) => !p.estornado);
  const totalDoDia = validos.reduce((s, p) => s + p.valor, 0);
  const totalPago = validos.filter((p) => p.pago).reduce((s, p) => s + p.valor, 0);
  const totalPendente = validos.filter((p) => !p.pago).reduce((s, p) => s + p.valor, 0);

  // Pendentes de dias anteriores: é o aviso do topo. Quem paga precisa ver que
  // ficou coisa para trás sem ter de passear pelo calendário.
  const atrasados = useMemo(
    () => pagamentos.filter((p) => !p.pago && !p.estornado && p.data < hoje),
    [pagamentos, hoje],
  );
  const totalAtrasado = atrasados.reduce((s, p) => s + p.valor, 0);
  const diaMaisAntigo = atrasados.length
    ? atrasados.reduce((a, p) => (p.data < a ? p.data : a), atrasados[0].data)
    : "";

  // Pagamentos diários lançados no RH (só leitura, migração 43), no mesmo
  // período que a lista está mostrando.
  const periodo = intervaloDe(filtros, dia);
  const rh = usePagamentosDiariosRH(periodo.de, periodo.ate);
  const itensRH = rh.data?.itens ?? [];

  // ?form=novo abre em branco; ?form=<id> abre aquele lançamento para editar.
  const emEdicao = useMemo(
    () =>
      formAberto && formAberto !== "novo"
        ? (pagamentos.find((p) => p.id === formAberto) ?? null)
        : null,
    [pagamentos, formAberto],
  );

  const selecionados = useMemo(
    () => doPeriodo.filter((p) => sel.has(p.id) && !p.pago && !p.estornado),
    [doPeriodo, sel],
  );
  // Quem aparece no filtro 'Lançado por': só quem realmente lançou algo aqui.
  const autoresUnicos = useMemo(
    () =>
      [
        ...new Set(
          Object.values(autores)
            .map((a) => a.email)
            .filter(Boolean),
        ),
      ].sort(),
    [autores],
  );
  const totalSelecionado = selecionados.reduce((s, p) => s + p.valor, 0);
  const alternar = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const copiarChave = async (p: PagamentoDiario) => {
    try {
      await navigator.clipboard.writeText(p.chavePix);
      toast.success(`Chave de ${p.titular} copiada.`);
    } catch {
      toast.error("O navegador não deixou copiar. Selecione a chave na tela.");
    }
  };

  const pagar = async () => {
    if (!confirmarPagar) return;
    try {
      const n = await marcar.mutateAsync(confirmarPagar.map((p) => p.id));
      toast.success(
        `${n} pagamento${n === 1 ? "" : "s"} marcado${n === 1 ? "" : "s"} como pago${n === 1 ? "" : "s"}. Registro definitivo.`,
      );
      setSel(new Set());
      setConfirmarPagar(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao marcar como pago.");
    }
  };

  const excluir = async () => {
    if (!excluirAlvo) return;
    setExcluirErro(null);
    try {
      await del.mutateAsync(excluirAlvo.id);
      setSel((s) => {
        const n = new Set(s);
        n.delete(excluirAlvo.id);
        return n;
      });
      if (pixAberto === excluirAlvo.id) onAbrirPix(null);
      setExcluirAlvo(null);
    } catch (e) {
      // Se alguém marcou como pago noutro aparelho, a trava do banco barra aqui.
      setExcluirErro(e instanceof Error ? e.message : "Erro ao excluir.");
    }
  };

  const exportar = () =>
    exportToXlsx({
      filename: `pagamentos-diarios-${periodo.de}${periodo.de === periodo.ate ? "" : `-a-${periodo.ate}`}`,
      sheets: [
        {
          name: "Pagamentos",
          columns: [
            "Data",
            "Titular",
            "Chave Pix",
            "Tipo",
            "Valor",
            "Situação",
            "Quem lançou",
            "Descrição",
          ],
          rows: doPeriodo.map((p) => [
            fmtBR(p.data),
            p.titular,
            formatarChavePix(p.chavePix, p.tipoChave),
            labelTipoChave(p.tipoChave),
            p.valor,
            situacaoDe(p) === "pendente"
              ? "Em aberto"
              : situacaoDe(p) === "pago"
                ? "Pago"
                : "Estornado",
            autorDe(p.id) ?? "",
            p.descricao,
          ]),
        },
      ],
    });

  return (
    <AppShell
      title="Pagamentos"
      actions={
        <button
          type="button"
          onClick={() => onAbrirFiltros(true)}
          aria-label="Filtrar pagamentos"
          className="relative grid h-10 w-10 place-items-center rounded-full hover:bg-secondary"
        >
          <SlidersHorizontal className="h-[18px] w-[18px]" />
          {quantosFiltros(filtros) > 0 && (
            <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-[var(--primary-ink)]">
              {quantosFiltros(filtros)}
            </span>
          )}
        </button>
      }
    >
      <div className="space-y-3.5">
        {/* ── Dia ── */}
        <section>
          <div className="flex items-baseline justify-between px-1 pb-2">
            <p className="text-[12px] font-semibold text-muted-foreground">{porExtenso(dia)}</p>
            {dia !== hoje && (
              <button
                type="button"
                onClick={() => irParaODia(hoje)}
                className="text-[12px] font-bold text-primary"
              >
                Hoje
              </button>
            )}
          </div>
          <TiraDeDias dia={dia} hoje={hoje} onEscolher={irParaODia} />
        </section>

        {/* ── Resumo do dia ── */}
        <section className="grid grid-cols-[1.15fr_1fr_1fr] gap-[7px]">
          <CartaoResumo titulo="Total do dia" valor={totalDoDia} nota={`${validos.length} Pix`} />
          <CartaoResumo
            titulo="Pagos"
            valor={totalPago}
            nota={`${validos.filter((p) => p.pago).length} Pix`}
            tom="pago"
          />
          <CartaoResumo
            titulo="Pendentes"
            valor={totalPendente}
            nota={`${validos.filter((p) => !p.pago).length} Pix`}
            tom="pendente"
          />
        </section>

        {/* ── Ficou para trás ── */}
        {atrasados.length > 0 && (
          <button
            type="button"
            onClick={() => irParaODia(diaMaisAntigo)}
            className="grid w-full grid-cols-[26px_1fr_auto] items-center gap-1 rounded-xl border border-warning/50 bg-warning/15 px-2.5 py-2.5 text-left text-warning-ink"
          >
            <AlertCircle className="h-[18px] w-[18px]" />
            <span className="min-w-0">
              <span className="block text-[12px] font-bold leading-tight">
                {atrasados.length} pagamento{atrasados.length === 1 ? "" : "s"} pendente
                {atrasados.length === 1 ? "" : "s"}
              </span>
              <span className="block text-[11px] leading-tight opacity-90">
                desde {fmtBR(diaMaisAntigo)} · {brl(totalAtrasado)}
              </span>
            </span>
            <span className="text-[12px] font-bold underline">Ver</span>
          </button>
        )}

        {/* ── Situação ── */}
        <div className="flex h-11 border-b border-border">
          {(["pendente", "pago", "estornado"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFiltros((f) => ({ ...f, status: [s] }))}
              className={`-mb-px flex flex-1 items-center justify-center gap-1 border-b-2 text-[12.5px] font-semibold transition-colors ${
                umaSituacao === s
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground"
              }`}
            >
              {s === "pendente" ? "Pendentes" : s === "pago" ? "Pagos" : "Estornados"}
              <span className="rounded-lg bg-secondary px-1.5 py-0.5 text-[10.5px] font-semibold">
                {porSituacao[s]}
              </span>
            </button>
          ))}
        </div>

        {/* ── Lista ── */}
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[92px] animate-pulse rounded-xl bg-secondary" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-6 text-center">
            <AlertCircle className="mx-auto h-5 w-5 text-destructive" />
            <p className="mt-2 text-[13px] font-bold">Não foi possível carregar</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {error instanceof Error ? error.message : "Tente de novo em instantes."}
            </p>
          </div>
        ) : lista.length === 0 ? (
          <div className="rounded-xl border border-border/70 px-3 py-8 text-center">
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[var(--primary-tint)]">
              <Receipt className="h-5 w-5 text-primary" />
            </div>
            <p className="mt-2.5 text-[13px] font-bold">
              {quantosFiltros(filtros) > 0
                ? "Nada encontrado com estes filtros"
                : umaSituacao === "pendente"
                  ? "Nenhum Pix pendente neste dia"
                  : umaSituacao === "pago"
                    ? "Nenhum Pix pago neste dia"
                    : "Nenhum lançamento neste dia"}
            </p>
            {umaSituacao === "pendente" && quantosFiltros(filtros) === 0 && (
              <button
                type="button"
                onClick={() => onAbrirForm("novo")}
                className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-[10px] border border-primary px-3.5 text-[12.5px] font-bold text-primary"
              >
                <Plus className="h-4 w-4" /> Novo Pix
              </button>
            )}
          </div>
        ) : (
          <section className="space-y-2.5">
            <div className="flex items-baseline justify-between px-1">
              <p className="text-[13px] font-bold">
                {umaSituacao === "pendente"
                  ? "Pendentes"
                  : umaSituacao === "pago"
                    ? "Pagos"
                    : umaSituacao === "estornado"
                      ? "Estornados"
                      : "Lançamentos"}
                {filtros.periodo === "dia" && dia === hoje ? " de hoje" : ""}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {lista.length} lançamento{lista.length === 1 ? "" : "s"}
              </p>
            </div>
            {lista.map((p) => (
              <CartaoPagamento
                key={p.id}
                p={p}
                selecionado={sel.has(p.id)}
                onSelecionar={() => alternar(p.id)}
                onAbrir={() => onAbrirPix(p.id)}
              />
            ))}
          </section>
        )}

        {/* ── Lançados no RH (só leitura) ── */}
        {itensRH.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center gap-1.5 px-1 pt-1">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-[13px] font-bold">Lançados no RH</p>
              <span className="text-[11px] text-muted-foreground">só leitura</span>
            </div>
            {itensRH.map((p, i) => (
              <div
                key={`${p.pessoa}-${i}`}
                className="rounded-xl border border-border/70 bg-card p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-bold leading-tight">{p.pessoa}</p>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      {p.forma} · {p.descricao}
                    </p>
                  </div>
                  <p className="shrink-0 text-[15px] font-bold">{brl(p.valor)}</p>
                </div>
                <span
                  className={`mt-2 inline-flex items-center gap-1.5 rounded-[10px] px-1.5 py-1 text-[11px] font-bold ${
                    p.pago ? "bg-success/10 text-success" : "bg-warning/15 text-warning-ink"
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {p.pago ? "Pago no RH" : "Em aberto no RH"}
                </span>
              </div>
            ))}
          </section>
        )}

        {/* ── Ações do dia ── */}
        <div className="flex gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5"
            onClick={() => setHistoricoAberto(true)}
          >
            <History className="h-4 w-4" /> Histórico do mês
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5"
            onClick={exportar}
            disabled={doPeriodo.length === 0}
          >
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </Button>
        </div>

        {/* O botão flutuante fica por cima do fim da lista: este respiro é o que
            garante que o último cartão possa ser lido inteiro. */}
        <div className="h-12" />
      </div>

      {/* ── Novo Pix: pastilha flutuante, some quando há seleção ── */}
      {selecionados.length === 0 && (
        <button
          type="button"
          onClick={() => onAbrirForm("novo")}
          className="fixed bottom-[76px] right-4 z-20 inline-flex h-11 items-center gap-1.5 rounded-[14px] bg-primary px-4 text-[13px] font-bold text-[var(--primary-ink)] shadow-lg shadow-primary/40 active:scale-95"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        >
          <Plus className="h-[18px] w-[18px]" /> Novo Pix
        </button>
      )}

      {/* ── Barra de seleção ── */}
      {selecionados.length > 0 && (
        <div
          className="fixed inset-x-2.5 bottom-[70px] z-20 flex min-h-[58px] items-center justify-between gap-3 rounded-[14px] bg-primary py-2 pl-3.5 pr-2 text-[var(--primary-ink)] shadow-xl shadow-primary/40"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="min-w-0">
            <p className="text-[12.5px] font-bold leading-tight">
              {selecionados.length} selecionado{selecionados.length === 1 ? "" : "s"}
            </p>
            <p className="mt-0.5 text-[12px] leading-tight opacity-80">{brl(totalSelecionado)}</p>
          </div>
          <button
            type="button"
            onClick={() => setConfirmarPagar(selecionados)}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] bg-[var(--primary-tint)] px-3 text-[12.5px] font-bold text-[var(--primary-ink)]"
          >
            <CheckCircle2 className="h-4 w-4" /> Pagar selecionado
            {selecionados.length === 1 ? "" : "s"}
          </button>
        </div>
      )}

      {/* ── Detalhe (tela cheia, endereçável por ?pix=) ── */}
      {aberto && (
        <DetalheDoPix
          p={aberto}
          isMaster={isMaster}
          autor={autores[aberto.id]}
          pagando={marcar.isPending}
          fechar={() => onAbrirPix(null)}
          onCopiar={() => copiarChave(aberto)}
          onPagar={() => setConfirmarPagar([aberto])}
          onEstornar={() => setEstornoDe(aberto)}
          onMaisAcoes={() => setAcoesDe(aberto)}
        />
      )}

      {/* ── Folhas e diálogos ── */}
      <AcoesDoPagamento
        p={acoesDe}
        isMaster={isMaster}
        fechar={() => setAcoesDe(null)}
        onCopiar={copiarChave}
        onEditar={(p) => onAbrirForm(p.id)}
        onExcluir={(p) => setExcluirAlvo(p)}
        onEstornar={(p) => setEstornoDe(p)}
        onPagar={(p) => setConfirmarPagar([p])}
        onAbrir={(p) => onAbrirPix(p.id)}
      />

      <FolhaConfirmarPagamento
        alvos={confirmarPagar}
        salvando={marcar.isPending}
        fechar={() => setConfirmarPagar(null)}
        confirmar={pagar}
      />

      <DialogoEstorno alvo={estornoDe} fechar={() => setEstornoDe(null)} />

      {formAberto && (
        <FormularioPixCelular
          pagamento={emEdicao}
          dataPadrao={dia}
          fechar={() => onAbrirForm(null)}
        />
      )}

      {filtrosAbertos && (
        <TelaFiltrosPix
          filtros={filtros}
          autores={autoresUnicos}
          fechar={() => onAbrirFiltros(false)}
          aplicar={(f) => {
            setFiltros(f);
            setSel(new Set());
          }}
          contar={(f) => {
            const base = filtrarPagamentos(pagamentos, f, dia, autorDe);
            const porSit = contarPorSituacao(base);
            return {
              total: base.filter((p) => f.status.includes(situacaoDe(p))).length,
              porSituacao: porSit,
            };
          }}
        />
      )}

      <AlertDialog
        open={excluirAlvo !== null}
        onOpenChange={(v) => !v && (setExcluirAlvo(null), setExcluirErro(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este lançamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluirAlvo ? `${excluirAlvo.titular} · ${brl(excluirAlvo.valor)}. ` : ""}A exclusão
              fica registrada no histórico do mês.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {excluirErro && <p className="text-[13px] font-medium text-destructive">{excluirErro}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void excluir();
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={historicoAberto} onOpenChange={setHistoricoAberto}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="text-left">
            <SheetTitle>Histórico do mês</SheetTitle>
            <SheetDescription>
              Toda mudança nos Pix deste mês, com quem fez e quando.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-3 overflow-x-auto">
            <HistoricoMes competencia={dia.slice(0, 7)} />
          </div>
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}

// ─── Tira de dias ───────────────────────────────────────────
function TiraDeDias({
  dia,
  hoje,
  onEscolher,
}: {
  dia: string;
  hoje: string;
  onEscolher: (iso: string) => void;
}) {
  const semana = semanaDe(dia);
  return (
    <div className="flex items-stretch gap-1.5">
      <div className="-mx-4 flex flex-1 gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {semana.map((iso) => {
          const escolhido = iso === dia;
          const d = daISO(iso);
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onEscolher(iso)}
              className={`flex h-[50px] w-[47px] shrink-0 flex-col items-center justify-center rounded-xl border transition-colors ${
                escolhido
                  ? "border-primary bg-primary text-[var(--primary-ink)] shadow-md shadow-primary/25"
                  : "border-border/70 bg-card"
              }`}
            >
              <span
                className={`text-[10px] font-bold uppercase tracking-wide ${escolhido ? "" : "text-muted-foreground"}`}
              >
                {DIAS_CURTOS[d.getDay()]}
              </span>
              <b className="mt-0.5 text-[16px] font-bold leading-none">{d.getDate()}</b>
              {iso === hoje && (
                <span
                  className={`mt-0.5 h-1 w-1 rounded-full ${escolhido ? "bg-[var(--primary-ink)]" : "bg-primary"}`}
                />
              )}
            </button>
          );
        })}
      </div>
      {/* Outro mês: o seletor nativo do aparelho, que é o que a pessoa conhece. */}
      <label className="grid h-[50px] w-[42px] shrink-0 cursor-pointer place-items-center rounded-xl bg-[var(--primary-tint)]">
        <Calendar className="h-[18px] w-[18px] text-primary" />
        <input
          type="date"
          value={dia}
          onChange={(e) => e.target.value && onEscolher(e.target.value)}
          className="sr-only"
          aria-label="Escolher outro dia"
        />
      </label>
    </div>
  );
}

// ─── Cartão de resumo ───────────────────────────────────────
function CartaoResumo({
  titulo,
  valor,
  nota,
  tom,
}: {
  titulo: string;
  valor: number;
  nota: string;
  tom?: "pago" | "pendente";
}) {
  const topo =
    tom === "pago"
      ? "border-t-[3px] border-t-success"
      : tom === "pendente"
        ? "border-t-[3px] border-t-warning"
        : "";
  const cor = tom === "pago" ? "text-success" : tom === "pendente" ? "text-warning-ink" : "";
  return (
    <div className={`min-w-0 rounded-xl border border-border/70 bg-card p-2.5 ${topo}`}>
      <p className="truncate text-[11px] font-semibold text-muted-foreground">{titulo}</p>
      <p
        className={`mt-1.5 whitespace-nowrap text-[13.5px] font-bold leading-none tracking-tight ${cor}`}
      >
        {brl(valor)}
      </p>
      <p className="mt-1 truncate text-[10.5px] text-muted-foreground">{nota}</p>
    </div>
  );
}

// ─── Cartão de pagamento ────────────────────────────────────
function CartaoPagamento({
  p,
  selecionado,
  onSelecionar,
  onAbrir,
}: {
  p: PagamentoDiario;
  selecionado: boolean;
  onSelecionar: () => void;
  onAbrir: () => void;
}) {
  const situacao = situacaoDe(p);
  const podeSelecionar = situacao === "pendente";

  return (
    <div
      className={`rounded-xl border p-3 shadow-sm transition-colors ${
        selecionado ? "border-primary/60 bg-[var(--primary-soft)]" : "border-border/70 bg-card"
      }`}
    >
      <div className="flex items-start gap-2.5">
        {podeSelecionar ? (
          <Checkbox
            checked={selecionado}
            onCheckedChange={onSelecionar}
            aria-label={`Selecionar ${p.titular}`}
            className="mt-0.5 h-[19px] w-[19px] rounded-[5px] border-[1.5px] data-[state=checked]:text-[var(--primary-ink)]"
          />
        ) : (
          <span className="mt-0.5 h-[19px] w-[19px] shrink-0" />
        )}

        <button type="button" onClick={onAbrir} className="min-w-0 flex-1 text-left">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-[14px] font-bold leading-tight">{p.titular}</p>
            <p className="shrink-0 text-[15px] font-bold leading-tight tracking-tight">
              {brl(p.valor)}
            </p>
          </div>

          <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 rounded-md bg-[var(--primary-tint)] px-1.5 py-0.5 text-[10px] font-bold leading-tight text-primary">
              {labelTipoChave(p.tipoChave)}
            </span>
            {p.descricao && (
              <span className="truncate text-[11.5px] text-muted-foreground">{p.descricao}</span>
            )}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <Pastilha situacao={situacao} />
            <span className="ml-auto inline-flex items-center gap-0.5 text-[11px] font-semibold text-muted-foreground">
              Detalhes <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </button>
      </div>
    </div>
  );
}

function Pastilha({ situacao }: { situacao: Situacao }) {
  const cor =
    situacao === "pendente"
      ? "bg-warning/15 text-warning-ink"
      : situacao === "pago"
        ? "bg-success/10 text-success"
        : "bg-destructive/10 text-destructive";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[10px] px-1.5 py-1 text-[11px] font-bold ${cor}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {situacao === "pendente" ? "Pendente" : situacao === "pago" ? "Pago" : "Estornado"}
    </span>
  );
}

// ─── Ações de um pagamento ──────────────────────────────────
function AcoesDoPagamento({
  p,
  isMaster,
  fechar,
  onCopiar,
  onEditar,
  onExcluir,
  onEstornar,
  onPagar,
  onAbrir,
}: {
  p: PagamentoDiario | null;
  isMaster: boolean;
  fechar: () => void;
  onCopiar: (p: PagamentoDiario) => void;
  onEditar: (p: PagamentoDiario) => void;
  onExcluir: (p: PagamentoDiario) => void;
  onEstornar: (p: PagamentoDiario) => void;
  onPagar: (p: PagamentoDiario) => void;
  onAbrir: (p: PagamentoDiario) => void;
}) {
  const aberto = p !== null;
  const situacao = p ? situacaoDe(p) : "pendente";
  const fazer = (acao: (x: PagamentoDiario) => void) => {
    if (!p) return;
    fechar();
    acao(p);
  };

  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && fechar()}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader className="text-left">
          <SheetTitle className="truncate">{p?.titular}</SheetTitle>
          <SheetDescription className="truncate">
            {p ? `${brl(p.valor)} · ${formatarChavePix(p.chavePix, p.tipoChave)}` : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-3 grid gap-0.5">
          <ItemAcao icone={ChevronRight} rotulo="Ver detalhes" onClick={() => fazer(onAbrir)} />
          <ItemAcao icone={Copy} rotulo="Copiar chave Pix" onClick={() => fazer(onCopiar)} />
          {situacao === "pendente" && (
            <>
              <ItemAcao
                icone={CheckCircle2}
                rotulo="Marcar como pago"
                onClick={() => fazer(onPagar)}
              />
              <ItemAcao icone={Pencil} rotulo="Editar" onClick={() => fazer(onEditar)} />
              <ItemAcao icone={Trash2} rotulo="Excluir" onClick={() => fazer(onExcluir)} perigo />
            </>
          )}
          {/* Estorno é do master: desfazer um pagamento já registrado. */}
          {situacao === "pago" && isMaster && (
            <ItemAcao
              icone={RotateCcw}
              rotulo="Estornar"
              onClick={() => fazer(onEstornar)}
              perigo
            />
          )}
          {situacao === "pago" && !isMaster && (
            <p className="px-2 py-2 text-[12px] text-muted-foreground">
              Pagamento registrado. Só o master pode estornar.
            </p>
          )}
          {situacao === "estornado" && p?.estornoMotivo && (
            <p className="px-2 py-2 text-[12px] text-muted-foreground">
              Estornado: {p.estornoMotivo}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ItemAcao({
  icone: Icone,
  rotulo,
  onClick,
  perigo,
}: {
  icone: typeof Copy;
  rotulo: string;
  onClick: () => void;
  perigo?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 rounded-lg px-2 py-2.5 text-left text-[14px] font-medium hover:bg-secondary ${
        perigo ? "text-destructive" : ""
      }`}
    >
      <Icone className={`h-4 w-4 shrink-0 ${perigo ? "" : "text-muted-foreground"}`} />
      {rotulo}
    </button>
  );
}

// ─── Confirmar pagamento (tela 04) ──────────────────────────
function FolhaConfirmarPagamento({
  alvos,
  salvando,
  fechar,
  confirmar,
}: {
  alvos: PagamentoDiario[] | null;
  salvando: boolean;
  fechar: () => void;
  confirmar: () => void;
}) {
  const total = (alvos ?? []).reduce((s, p) => s + p.valor, 0);
  return (
    <Sheet open={alvos !== null} onOpenChange={(v) => !v && fechar()}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-[24px]">
        <SheetHeader className="text-left">
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-[14px] bg-success/10">
            <CheckCircle2 className="h-5 w-5 text-success" />
          </div>
          <SheetTitle className="text-center text-[18px]">Confirmar pagamentos</SheetTitle>
          <SheetDescription className="mx-auto max-w-[280px] text-center text-[12px]">
            Confirme que os Pix já foram feitos no banco. O registro fica definitivo.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 overflow-hidden rounded-xl border border-border/70">
          {(alvos ?? []).map((p) => (
            <div
              key={p.id}
              className="flex min-h-[59px] items-center gap-2.5 border-b border-border/70 px-3 py-2 last:border-0"
            >
              <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-[var(--primary-tint)] text-[12px] font-bold text-primary">
                {p.titular.trim().charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <b className="block truncate text-[12.5px] font-bold leading-tight">{p.titular}</b>
                <small className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {labelTipoChave(p.tipoChave)}
                </small>
              </div>
              <strong className="shrink-0 text-[13px] font-bold">{brl(p.valor)}</strong>
            </div>
          ))}
        </div>

        <div className="my-3.5 flex items-center justify-between">
          <span className="text-[12.5px] text-muted-foreground">
            Total · {(alvos ?? []).length} Pix
          </span>
          <b className="text-[18px] font-bold tracking-tight">{brl(total)}</b>
        </div>

        <button
          type="button"
          onClick={confirmar}
          disabled={salvando}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-primary text-[13px] font-bold text-[var(--primary-ink)] disabled:opacity-60"
        >
          {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
          Confirmar pagamento
        </button>
      </SheetContent>
    </Sheet>
  );
}

// ─── Estorno (tela 05) ──────────────────────────────────────
function DialogoEstorno({ alvo, fechar }: { alvo: PagamentoDiario | null; fechar: () => void }) {
  const estornar = useEstornarPagamentoDiario();
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (alvo) {
      setMotivo("");
      setErro(null);
      estornar.reset();
    }
  }, [alvo]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmar = async () => {
    if (!alvo) return;
    if (!motivo.trim()) {
      setErro("Escreva o motivo — ele fica gravado no histórico.");
      return;
    }
    try {
      await estornar.mutateAsync({ id: alvo.id, motivo });
      toast.success("Pagamento estornado. O registro continua na lista, fora dos totais.");
      fechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao estornar.");
    }
  };

  return (
    <Dialog open={alvo !== null} onOpenChange={(v) => !v && !estornar.isPending && fechar()}>
      <DialogContent className="max-w-[calc(100vw-40px)] rounded-[20px] p-5">
        <div className="mx-auto grid h-10 w-10 place-items-center rounded-[13px] bg-destructive/10">
          <RotateCcw className="h-5 w-5 text-destructive" />
        </div>
        <h2 className="mt-1 text-center text-[18px] font-bold">Estornar pagamento?</h2>
        <p className="mx-auto max-w-[280px] text-center text-[12px] leading-relaxed text-muted-foreground">
          Um pagamento pago não é excluído nem editado. O lançamento continua na lista e no
          histórico, marcado como estornado e fora dos totais.
        </p>

        {alvo && (
          <div className="flex items-center justify-between gap-3 rounded-[9px] bg-secondary px-3 py-2.5">
            <span className="min-w-0 truncate text-[12px]">{alvo.titular}</span>
            <b className="shrink-0 text-[13px] font-bold">{brl(alvo.valor)}</b>
          </div>
        )}

        <div>
          <label className="text-[12px] font-semibold" htmlFor="motivo-estorno">
            Motivo do estorno <span className="text-destructive">*</span>
          </label>
          <Textarea
            id="motivo-estorno"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            className="mt-1.5 text-[13px]"
            placeholder="Ex.: valor digitado errado, Pix não chegou a ser feito..."
          />
        </div>

        {erro && (
          <p className="flex gap-1.5 rounded-md bg-destructive/10 px-2.5 py-2 text-[12px] font-medium text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" /> {erro}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={fechar}
            disabled={estornar.isPending}
            className="min-h-10 rounded-[10px] px-3.5 text-[12.5px] font-bold text-muted-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={estornar.isPending}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-[10px] bg-destructive px-4 text-[12.5px] font-bold text-destructive-foreground disabled:opacity-60"
          >
            {estornar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Estornar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
