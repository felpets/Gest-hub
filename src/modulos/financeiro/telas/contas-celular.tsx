// ─── Pagamentos: Contas do mês e Dívidas, no celular ────────────────────────
// As duas abas que faltavam do módulo de Pagamentos, no desenho de app: a
// tabela de contas vira lista de cartões com a tarja de situação, o seletor de
// mês vira uma pastilha com as setas, e marcar como pagas se faz com o polegar.
// Entram quando a janela é estreita (ver src/lib/tela.ts). As telas de
// computador continuam em contas-a-pagar.tsx e processos.tsx.
//
// NADA de regra vive aqui:
//   · o que o mês mostra e o que cada número soma → contas/dados-contas.ts
//   · as contas de um acordo (pagas, saldo, cronograma) → lib/processos.ts
//   · criar conta e marcar pago → os MESMOS diálogos da tela de computador
//     (RegraDialog, MarcarPagoDialog), para não existirem duas ideias de
//     "conta válida".
//
// Cores, raios e espaçamentos saíram do arquivo do Figma (Make); os tokens
// próprios do desenho estão em styles.css, presos a .app-celular. O texto
// pequeno sobe para 11-12px: o desenho usa 8-9px, ilegível no aparelho.
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Plus,
  Receipt,
  Repeat,
  RotateCcw,
  Scale,
  Search,
  Trash2,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
import { ddMM, fmtBR, hojeISO, nomeMesLongo, mesAnterior, mesSeguinte } from "@/lib/datas";
import { useEmpresa } from "@/lib/empresa";
import { temCap } from "@/lib/permissoes";
import {
  useCreateRecorrente,
  useDeletePrevisto,
  useDeleteRecorrente,
  useMarcarPrevistoPago,
  useMarcarPrevistosPagosLote,
  useReabrirPrevisto,
  useRecorrentes,
  usePagamentosProcessos,
  useParcelasProcesso,
  useRegistrarPagamentoProcesso,
  statusPrevisto,
  type PagamentoProcesso,
  type Previsto,
  type Recorrente,
  type RecorrenteInput,
  type StatusPrevisto,
} from "@/lib/queries";
import {
  cronogramaParcelas,
  filtraProcessos,
  parcelasPagas,
  pctPago,
  proximoVencimento,
  resumoProcessos,
  saldoDevedor,
  totalDoAcordo,
  type ParcelaCronograma,
} from "@/lib/processos";
import {
  useCatGroups,
  useContasDoMes,
  useManutencaoContas,
  ymDeHoje,
} from "@/modulos/financeiro/contas/dados-contas";
// A descrição do vencimento de uma regra é a mesma do formulário dela.
import { descreveVencimento } from "@/components/ModoFields";
import { RegraDialog, MarcarPagoDialog } from "@/modulos/financeiro/telas/contas-a-pagar";

// ─────────────────────────────────────────────────────────────
// Contas do mês
// ─────────────────────────────────────────────────────────────

type FiltroConta = "abertas" | "pagas" | "todas";

export function ContasCelular() {
  useManutencaoContas();
  const catGroups = useCatGroups();
  const { caps } = useEmpresa();
  const podeGerir = temCap(caps, "contas_gerir");

  const [mes, setMes] = useState(ymDeHoje);
  const [filtro, setFiltro] = useState<FiltroConta>("abertas");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [novaAberta, setNovaAberta] = useState(false);
  const [recorrenciasAbertas, setRecorrenciasAbertas] = useState(false);
  const [pagoAlvo, setPagoAlvo] = useState<Previsto | null>(null);
  const [excluirAlvo, setExcluirAlvo] = useState<Previsto | null>(null);
  const [confirmarPagas, setConfirmarPagas] = useState(false);

  const { visiveis, vencidasTotal, vencidas, aVencerTotal, pagoMes, carregando, erro, hoje } =
    useContasDoMes(mes);

  const criar = useCreateRecorrente();
  const marcarPago = useMarcarPrevistoPago();
  const pagarLote = useMarcarPrevistosPagosLote();
  const reabrir = useReabrirPrevisto();
  const delPrev = useDeletePrevisto();
  const delRec = useDeleteRecorrente();

  const contagem = useMemo(
    () => ({
      abertas: visiveis.filter((p) => !p.pago).length,
      pagas: visiveis.filter((p) => p.pago).length,
      todas: visiveis.length,
    }),
    [visiveis],
  );

  const lista = useMemo(() => {
    if (filtro === "abertas") return visiveis.filter((p) => !p.pago);
    if (filtro === "pagas") return visiveis.filter((p) => p.pago);
    return visiveis;
  }, [visiveis, filtro]);

  // A seleção só paga o que está em aberto: conta paga já está fechada.
  const selecionadas = useMemo(() => visiveis.filter((p) => sel.has(p.id)), [visiveis, sel]);
  const selAbertas = useMemo(() => selecionadas.filter((p) => !p.pago), [selecionadas]);
  const selTotal = selAbertas.reduce((s, p) => s + p.valor, 0);

  const trocarMes = (novo: string) => {
    setMes(novo);
    setSel(new Set());
  };

  const alternar = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const confirmarLote = async () => {
    try {
      const n = await pagarLote.mutateAsync({
        itens: selAbertas.map((p) => ({ id: p.id, valor: p.valor })),
        pagoEm: hoje,
      });
      toast.success(
        `${n} conta${n === 1 ? "" : "s"} marcada${n === 1 ? "" : "s"} como paga${n === 1 ? "" : "s"}.`,
      );
      setSel(new Set());
      setConfirmarPagas(false);
    } catch {
      /* o erro aparece no próprio diálogo */
    }
  };

  if (recorrenciasAbertas) {
    return (
      <RecorrenciasCelular
        voltar={() => setRecorrenciasAbertas(false)}
        podeGerir={podeGerir}
        onNova={() => setNovaAberta(true)}
        criarAberto={novaAberta}
        fecharCriar={() => setNovaAberta(false)}
        catGroups={catGroups}
        salvando={criar.isPending}
        onCriar={async (input) => {
          await criar.mutateAsync(input);
          setNovaAberta(false);
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Mês e nova conta ── */}
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center justify-between rounded-[12px] border border-border/70 bg-card pl-1 pr-1">
          <button
            type="button"
            onClick={() => trocarMes(mesAnterior(mes))}
            aria-label="Mês anterior"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-muted-foreground"
          >
            <ChevronLeft className="h-[18px] w-[18px]" />
          </button>
          <b className="truncate text-[12.5px] font-bold">{nomeMesLongo(mes)}</b>
          <button
            type="button"
            onClick={() => trocarMes(mesSeguinte(mes))}
            aria-label="Próximo mês"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-muted-foreground"
          >
            <ChevronRight className="h-[18px] w-[18px]" />
          </button>
        </div>
        {podeGerir && (
          <button
            type="button"
            onClick={() => setNovaAberta(true)}
            className="inline-flex h-[42px] shrink-0 items-center gap-1.5 rounded-[12px] bg-primary px-3 text-[12.5px] font-bold text-[var(--primary-ink)]"
          >
            <Plus className="h-4 w-4" /> Nova
          </button>
        )}
      </div>

      {/* ── Resumo do mês ── */}
      <div className="grid grid-cols-3 gap-2">
        <Resumo
          rotulo="Vencidas"
          valor={vencidasTotal}
          nota={`${vencidas.length} em aberto`}
          tom="ruim"
        />
        <Resumo rotulo="A vencer" valor={aVencerTotal} nota="ainda no prazo" />
        <Resumo rotulo="Pagas" valor={pagoMes} nota="neste mês" tom="bom" />
      </div>

      {/* ── Situação ── */}
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {(
          [
            ["abertas", `Em aberto (${contagem.abertas})`],
            ["pagas", `Pagas (${contagem.pagas})`],
            ["todas", `Todas (${contagem.todas})`],
          ] as const
        ).map(([id, rotulo]) => (
          <Pastilha key={id} ativa={filtro === id} onClick={() => setFiltro(id)}>
            {rotulo}
          </Pastilha>
        ))}
      </div>

      {/* ── Lista ── */}
      {carregando ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-[86px] animate-pulse rounded-xl bg-secondary" />
          ))}
        </div>
      ) : erro ? (
        <Erro erro={erro} />
      ) : lista.length === 0 ? (
        <Vazio
          icone={Receipt}
          titulo={
            filtro === "pagas" ? "Nenhuma conta paga neste mês" : "Nenhuma conta a pagar neste mês"
          }
          texto={
            filtro === "abertas"
              ? "Quando houver contas em aberto, elas aparecem aqui — e as vencidas de outros meses vêm no topo."
              : "Troque o mês ou a situação para ver outras contas."
          }
        />
      ) : (
        <div className="space-y-2">
          {lista.map((p) => (
            <CartaoConta
              key={p.id}
              p={p}
              hoje={hoje}
              mes={mes}
              selecionada={sel.has(p.id)}
              podeGerir={podeGerir}
              onTocar={() => podeGerir && alternar(p.id)}
            />
          ))}
        </div>
      )}

      {/* ── As regras que geram estas contas ── */}
      <BotaoRecorrencias onAbrir={() => setRecorrenciasAbertas(true)} />

      {/* A barra de seleção é fixa e cobriria o fim da lista. */}
      {sel.size > 0 && <div aria-hidden className="h-[62px]" />}

      {/* ── Barra de seleção ── */}
      {sel.size > 0 && (
        <div
          className="fixed inset-x-2.5 bottom-[70px] z-20 flex min-h-[58px] items-center gap-2 rounded-[14px] bg-primary py-2 pl-3.5 pr-2 text-[var(--primary-ink)] shadow-xl shadow-primary/40"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-bold leading-tight">
              {sel.size} selecionada{sel.size === 1 ? "" : "s"}
            </p>
            <p className="mt-0.5 truncate text-[12px] leading-tight opacity-80">
              {selAbertas.length === 0 ? "nenhuma em aberto" : brl(selTotal)}
            </p>
          </div>
          {/* Com uma só em aberto dá para pagar com valor diferente do previsto
              — é o que o diálogo da tela de computador faz. */}
          {sel.size === 1 && selAbertas.length === 1 && (
            <button
              type="button"
              onClick={() => setPagoAlvo(selAbertas[0] ?? null)}
              aria-label="Pagar com outro valor"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[var(--primary-tint)]"
            >
              <FileText className="h-4 w-4" />
            </button>
          )}
          {sel.size === 1 && selecionadas[0]?.pago && (
            <button
              type="button"
              onClick={() => {
                const alvo = selecionadas[0];
                if (alvo) reabrir.mutate(alvo.id);
                setSel(new Set());
              }}
              aria-label="Reabrir conta"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[var(--primary-tint)]"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          {sel.size === 1 && (
            <button
              type="button"
              onClick={() => setExcluirAlvo(selecionadas[0] ?? null)}
              aria-label="Excluir conta"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[var(--primary-tint)] text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirmarPagas(true)}
            disabled={selAbertas.length === 0}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] bg-[var(--primary-tint)] px-3 text-[12.5px] font-bold disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" /> Pagas
          </button>
        </div>
      )}

      {/* ── Folha: confirmar as contas pagas ── */}
      <Sheet open={confirmarPagas} onOpenChange={(v) => !v && setConfirmarPagas(false)}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="text-left">
            <SheetTitle className="text-[15px]">
              Marcar {selAbertas.length} conta{selAbertas.length === 1 ? "" : "s"} como paga
              {selAbertas.length === 1 ? "" : "s"}?
            </SheetTitle>
            <SheetDescription className="text-[12.5px]">
              Confirme que os pagamentos já saíram do banco. Cada conta é registrada hoje (
              {fmtBR(hoje)}) com o próprio valor previsto.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-3 divide-y divide-border/60 rounded-xl border border-border/70">
            {selAbertas.map((p) => (
              <div key={p.id} className="flex items-center gap-2.5 px-3 py-2">
                <span className="w-9 shrink-0 text-[11px] font-bold tabular-nums text-muted-foreground">
                  {ddMM(p.data)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
                  {p.descricao}
                </span>
                <b className="shrink-0 text-[12px] font-bold tabular-nums">{brl(p.valor)}</b>
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex items-center justify-between rounded-xl bg-secondary px-3 py-2.5">
            <span className="text-[12px] text-muted-foreground">
              Total · {selAbertas.length} conta{selAbertas.length === 1 ? "" : "s"}
            </span>
            <b className="text-[13.5px] font-bold tabular-nums">{brl(selTotal)}</b>
          </div>
          {pagarLote.isError && (
            <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-[12px] font-semibold text-destructive">
              {pagarLote.error instanceof Error
                ? pagarLote.error.message
                : "Erro ao registrar os pagamentos."}
            </p>
          )}
          <button
            type="button"
            onClick={() => void confirmarLote()}
            disabled={pagarLote.isPending || selAbertas.length === 0}
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[12px] bg-primary text-[13px] font-bold text-[var(--primary-ink)] disabled:opacity-60"
          >
            <Check className="h-4 w-4" />
            {pagarLote.isPending ? "Registrando…" : "Confirmar pagamento"}
          </button>
        </SheetContent>
      </Sheet>

      {/* Os mesmos diálogos da tela de computador: o que é uma conta válida e
          o que é um pagamento válido não têm duas versões. */}
      <RegraDialog
        open={novaAberta}
        onClose={() => setNovaAberta(false)}
        catGroups={catGroups}
        saving={criar.isPending}
        onCreate={async (input) => {
          await criar.mutateAsync(input);
          setNovaAberta(false);
        }}
      />

      <MarcarPagoDialog
        alvo={pagoAlvo}
        saving={marcarPago.isPending}
        onClose={() => setPagoAlvo(null)}
        onConfirm={async (pagoEm, pagoValor) => {
          if (pagoAlvo) await marcarPago.mutateAsync({ id: pagoAlvo.id, pagoEm, pagoValor });
          setPagoAlvo(null);
          setSel(new Set());
        }}
      />

      <AlertDialog open={!!excluirAlvo} onOpenChange={(v) => !v && setExcluirAlvo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conta a pagar?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluirAlvo?.recorrenteId ? (
                <>
                  Esta conta vem de uma regra recorrente. Excluir só <strong>esta</strong> remove o
                  mês; excluir <strong>a regra</strong> remove todos os meses futuros.
                </>
              ) : (
                <>
                  A conta <strong>{excluirAlvo?.descricao}</strong> será removida.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={delPrev.isPending || delRec.isPending}>
              Cancelar
            </AlertDialogCancel>
            {excluirAlvo?.recorrenteId && (
              <button
                type="button"
                disabled={delRec.isPending}
                onClick={async () => {
                  const id = excluirAlvo?.recorrenteId;
                  if (id) await delRec.mutateAsync(id);
                  setExcluirAlvo(null);
                  setSel(new Set());
                }}
                className="inline-flex min-h-10 items-center justify-center rounded-md border border-border px-3 text-[13px] font-semibold"
              >
                Excluir a regra
              </button>
            )}
            <AlertDialogAction
              onClick={async (e) => {
                e.preventDefault();
                if (excluirAlvo) await delPrev.mutateAsync(excluirAlvo.id);
                setExcluirAlvo(null);
                setSel(new Set());
              }}
              disabled={delPrev.isPending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Excluir só esta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Cartão de uma conta ────────────────────────────────────
// A tarja da esquerda é a situação: vermelha vencida, âmbar a vencer, verde
// paga. É o que se lê antes do texto, de relance, com o aparelho na mão.
const TARJA: Record<StatusPrevisto, string> = {
  atrasado: "bg-destructive",
  aberto: "bg-warning",
  pago: "bg-success",
};

const TOM_VENC: Record<StatusPrevisto, string> = {
  atrasado: "text-destructive",
  aberto: "text-warning-ink",
  pago: "text-success",
};

// "Venceu em 12/09" · "Vence hoje" · "Vence em 3 dias" · "Pago em 09/09".
function rotuloVencimento(p: Previsto, hoje: string): string {
  if (p.pago) return `Pago em ${ddMM(p.pagoEm ?? p.data)}`;
  if (p.data < hoje) return `Venceu em ${ddMM(p.data)}`;
  if (p.data === hoje) return "Vence hoje";
  const dias = Math.round(
    (Date.parse(`${p.data}T12:00:00`) - Date.parse(`${hoje}T12:00:00`)) / 86400000,
  );
  if (dias <= 7) return `Vence em ${dias} dia${dias === 1 ? "" : "s"}`;
  return `Vence em ${ddMM(p.data)}`;
}

function CartaoConta({
  p,
  hoje,
  mes,
  selecionada,
  podeGerir,
  onTocar,
}: {
  p: Previsto;
  hoje: string;
  mes: string;
  selecionada: boolean;
  podeGerir: boolean;
  onTocar: () => void;
}) {
  const st = statusPrevisto(p, hoje);
  // Vencida de outro mês: a lista a trouxe para o topo, e o cartão diz de onde
  // ela veio — senão parece uma conta deste mês com a data errada.
  const deOutroMes = p.data.slice(0, 7) !== mes;
  return (
    <button
      type="button"
      onClick={onTocar}
      aria-pressed={podeGerir ? selecionada : undefined}
      className={`relative grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-2.5 overflow-hidden rounded-xl border p-3 pl-4 text-left transition-colors ${
        selecionada ? "border-primary bg-[var(--primary-soft)]" : "border-border/70 bg-card"
      }`}
    >
      <span className={`absolute inset-y-0 left-0 w-1.5 ${TARJA[st]}`} />
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-bold">{p.descricao}</span>
        <span className={`mt-0.5 block text-[11.5px] font-semibold ${TOM_VENC[st]}`}>
          {rotuloVencimento(p, hoje)}
          {deOutroMes && !p.pago && (
            <span className="font-normal text-muted-foreground"> · de outro mês</span>
          )}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="max-w-full truncate rounded-md bg-[var(--primary-tint)] px-1.5 py-0.5 text-[11px] font-semibold text-primary">
            {p.categoria || "sem categoria"}
          </span>
          {p.recorrenteId && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
              <Repeat className="h-3 w-3" /> mensal
            </span>
          )}
        </span>
      </span>
      <b className="whitespace-nowrap pt-0.5 text-[13px] font-bold tabular-nums">{brl(p.valor)}</b>
    </button>
  );
}

// ─── O cartão que leva às recorrências ──────────────────────
function BotaoRecorrencias({ onAbrir }: { onAbrir: () => void }) {
  const { data: recorrentes = [] } = useRecorrentes();
  const saidas = recorrentes.filter((r) => r.tipo === "out");
  const porMes = saidas.reduce((s, r) => s + r.valor, 0);
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="flex w-full items-center gap-3 rounded-xl border border-border/70 bg-card p-3 text-left"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[var(--primary-tint)]">
        <Repeat className="h-[18px] w-[18px] text-primary" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-bold">
          {saidas.length} recorrência{saidas.length === 1 ? "" : "s"}
        </span>
        <span className="block truncate text-[11.5px] text-muted-foreground">
          geram {brl(porMes)} por mês
        </span>
      </span>
      <ChevronRight className="h-[17px] w-[17px] shrink-0 text-muted-foreground" />
    </button>
  );
}

// ─── As recorrências ────────────────────────────────────────
// Leitura e criação. EDITAR uma regra fica na tela de computador: mudar o dia
// ou o valor reescreve os meses à frente (e a fonte do RH), e esse formulário
// não cabe honestamente num cartão de 360px. O desenho pedia uma chave
// liga-desliga por regra; o modelo não tem esse campo — uma regra vale até o
// "fim", ou para sempre —, então a linha mostra o prazo em vez de inventar
// um estado que o banco não guarda.
function RecorrenciasCelular({
  voltar,
  podeGerir,
  onNova,
  criarAberto,
  fecharCriar,
  catGroups,
  salvando,
  onCriar,
}: {
  voltar: () => void;
  podeGerir: boolean;
  onNova: () => void;
  criarAberto: boolean;
  fecharCriar: () => void;
  catGroups: ReturnType<typeof useCatGroups>;
  salvando: boolean;
  onCriar: (input: RecorrenteInput) => Promise<void>;
}) {
  const { data: recorrentes = [], isLoading, error } = useRecorrentes();
  const del = useDeleteRecorrente();
  const [excluir, setExcluir] = useState<Recorrente | null>(null);

  const saidas = useMemo(
    () => recorrentes.filter((r) => r.tipo === "out").sort((a, b) => a.dia - b.dia),
    [recorrentes],
  );
  const porMes = saidas.reduce((s, r) => s + r.valor, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={voltar}
          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-border/70 px-2.5 text-[12.5px] font-bold"
        >
          <ArrowLeft className="h-4 w-4" /> Contas do mês
        </button>
        {podeGerir && (
          <button
            type="button"
            onClick={onNova}
            className="ml-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-primary px-3 text-[12.5px] font-bold text-[var(--primary-ink)]"
          >
            <Plus className="h-4 w-4" /> Nova
          </button>
        )}
      </div>

      <div className="rounded-xl border border-border/70 bg-card p-3.5">
        <p className="text-[11.5px] text-muted-foreground">Previsão mensal</p>
        <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums">{brl(porMes)}</p>
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">
          {saidas.length} regra{saidas.length === 1 ? "" : "s"} de saída · geram sozinhas as contas
          da lista
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[62px] animate-pulse rounded-xl bg-secondary" />
          ))}
        </div>
      ) : error ? (
        <Erro erro={error} />
      ) : saidas.length === 0 ? (
        <Vazio
          icone={Repeat}
          titulo="Nenhuma recorrência cadastrada"
          texto="Uma recorrência é a regra que gera a conta todo mês — aluguel, internet, contabilidade."
        />
      ) : (
        <div className="space-y-2">
          {saidas.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-2.5 rounded-xl border border-border/70 bg-card p-3"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-secondary">
                <Repeat className="h-4 w-4 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-bold">{r.descricao}</p>
                <p className="truncate text-[11.5px] text-muted-foreground">
                  {descreveVencimento(r)} · {r.categoria || "sem categoria"}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <b className="block text-[12.5px] font-bold tabular-nums">{brl(r.valor)}</b>
                <span className="block text-[11px] text-muted-foreground">
                  {r.fim ? `até ${ddMM(r.fim)}` : "sem prazo"}
                </span>
              </div>
              {podeGerir && (
                <button
                  type="button"
                  onClick={() => setExcluir(r)}
                  aria-label={`Excluir ${r.descricao}`}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] text-destructive"
                >
                  <Trash2 className="h-[15px] w-[15px]" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="px-1 text-[11px] leading-snug text-muted-foreground">
        Para mudar o dia, o valor ou a categoria de uma regra, abra Contas do mês no computador: a
        alteração reescreve os meses à frente.
      </p>

      <RegraDialog
        open={criarAberto}
        onClose={fecharCriar}
        catGroups={catGroups}
        saving={salvando}
        onCreate={onCriar}
      />

      <AlertDialog open={!!excluir} onOpenChange={(v) => !v && setExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a recorrência?</AlertDialogTitle>
            <AlertDialogDescription>
              A regra <strong>{excluir?.descricao}</strong> deixa de gerar contas, e os meses
              futuros que ela criou saem da lista. O que já foi pago continua no histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={del.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async (e) => {
                e.preventDefault();
                if (excluir) await del.mutateAsync(excluir.id);
                setExcluir(null);
              }}
              disabled={del.isPending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {del.isPending ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Dívidas e acordos
// ─────────────────────────────────────────────────────────────

export function DividasCelular() {
  const { data: processos = [], isLoading, error } = usePagamentosProcessos();
  const { caps } = useEmpresa();
  const podeGerir = temCap(caps, "contas_gerir");
  const hoje = hojeISO();

  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"abertos" | "encerrados" | "todos">("abertos");
  const [abertoId, setAbertoId] = useState<string | null>(null);

  const { abertos, encerrados, valorMes, totalRestante } = useMemo(
    () => resumoProcessos(processos),
    [processos],
  );

  const lista = useMemo(() => {
    const base = filtro === "abertos" ? abertos : filtro === "encerrados" ? encerrados : processos;
    return filtraProcessos(base, busca);
  }, [filtro, abertos, encerrados, processos, busca]);

  // O detalhe lê do cache pelo id: assim ele acompanha o acordo depois de
  // registrar um pagamento (a parcela avança) sem fechar.
  const aberto = useMemo(
    () => processos.find((p) => p.id === abertoId) ?? null,
    [processos, abertoId],
  );

  if (aberto) {
    return (
      <DetalheAcordo
        p={aberto}
        hoje={hoje}
        podeGerir={podeGerir}
        voltar={() => setAbertoId(null)}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Resumo rotulo="Saldo devedor" valor={totalRestante} nota="o que falta pagar" tom="ruim" />
        <Resumo
          rotulo="Por mês"
          valor={valorMes}
          nota={`${abertos.length} acordo${abertos.length === 1 ? "" : "s"} em aberto`}
        />
      </div>

      <label className="flex min-w-0 items-center gap-2 rounded-[12px] border border-border/70 bg-card px-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar credor ou chave Pix"
          aria-label="Buscar acordo"
          className="h-10 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
        />
      </label>

      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {(
          [
            ["abertos", `Em aberto (${abertos.length})`],
            ["encerrados", `Encerrados (${encerrados.length})`],
            ["todos", `Todos (${processos.length})`],
          ] as const
        ).map(([id, rotulo]) => (
          <Pastilha key={id} ativa={filtro === id} onClick={() => setFiltro(id)}>
            {rotulo}
          </Pastilha>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[124px] animate-pulse rounded-xl bg-secondary" />
          ))}
        </div>
      ) : error ? (
        <Erro erro={error} />
      ) : lista.length === 0 ? (
        <Vazio
          icone={Scale}
          titulo={processos.length === 0 ? "Nenhum acordo cadastrado" : "Nada encontrado"}
          texto={
            processos.length === 0
              ? "Um acordo é uma dívida parcelada: credor, valor da parcela e quantas parcelas são."
              : "Mude a busca ou a situação para ver outros acordos."
          }
        />
      ) : (
        <div className="space-y-2">
          {lista.map((p) => (
            <CartaoAcordo key={p.id} p={p} hoje={hoje} onAbrir={() => setAbertoId(p.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function BarraProgresso({ pct, encerrado }: { pct: number; encerrado: boolean }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
      <div
        className={`h-full rounded-full ${encerrado ? "bg-success" : "bg-primary"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function CartaoAcordo({
  p,
  hoje,
  onAbrir,
}: {
  p: PagamentoProcesso;
  hoje: string;
  onAbrir: () => void;
}) {
  const pagas = parcelasPagas(p);
  const venc = proximoVencimento(p, hoje);
  const atrasada = !!venc && venc < hoje;
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="w-full rounded-xl border border-border/70 bg-card p-3 text-left"
    >
      <div className="flex items-start gap-2.5">
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${
            p.ativo ? "bg-[var(--primary-tint)]" : "bg-success/10"
          }`}
        >
          {p.ativo ? (
            <Scale className="h-[18px] w-[18px] text-primary" />
          ) : (
            <CheckCircle2 className="h-[18px] w-[18px] text-success" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-bold">{p.nome}</p>
          <p className="truncate text-[11.5px] text-muted-foreground">
            Valor total · {brl(totalDoAcordo(p))}
          </p>
        </div>
        <ChevronRight className="mt-1 h-[17px] w-[17px] shrink-0 text-muted-foreground" />
      </div>

      <div className="mt-2.5">
        <BarraProgresso pct={pctPago(p)} encerrado={!p.ativo} />
        <p className="mt-1 text-[11px] text-muted-foreground">
          {pagas} de {p.parcelasTotal} parcela{p.parcelasTotal === 1 ? " paga" : "s pagas"}
        </p>
      </div>

      {p.ativo ? (
        <div className="mt-2.5 flex items-end justify-between gap-2 border-t border-border/50 pt-2.5">
          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground">Próxima parcela</p>
            <b className="text-[13px] font-bold tabular-nums">{brl(p.valor)}</b>
          </div>
          <span
            className={`shrink-0 text-[11.5px] font-semibold ${
              atrasada ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {venc ? `${atrasada ? "venceu" : "vence"} ${fmtBR(venc)}` : "—"}
          </span>
        </div>
      ) : (
        <p className="mt-2.5 border-t border-border/50 pt-2.5 text-[11.5px] font-semibold text-success">
          Acordo quitado · {brl(totalDoAcordo(p))}
        </p>
      )}
    </button>
  );
}

const SIT_PARCELA: Record<ParcelaCronograma["situacao"], { rotulo: string; classe: string }> = {
  paga: { rotulo: "Paga", classe: "bg-success/15 text-success" },
  a_vencer: { rotulo: "A vencer", classe: "bg-warning/20 text-warning-ink" },
  vencida: { rotulo: "Vencida", classe: "bg-destructive/15 text-destructive" },
};

function DetalheAcordo({
  p,
  hoje,
  podeGerir,
  voltar,
}: {
  p: PagamentoProcesso;
  hoje: string;
  podeGerir: boolean;
  voltar: () => void;
}) {
  const { data: historico = [] } = useParcelasProcesso(p.id);
  const registrar = useRegistrarPagamentoProcesso();
  const [pagarAberto, setPagarAberto] = useState(false);
  const [pagoEm, setPagoEm] = useState(hoje);
  const [copiado, setCopiado] = useState(false);

  const parcelas = useMemo(() => cronogramaParcelas(p, historico, hoje), [p, historico, hoje]);
  const venc = proximoVencimento(p, hoje, historico);

  const copiar = async () => {
    if (!p.chavePix) return;
    try {
      await navigator.clipboard.writeText(p.chavePix);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      /* área de transferência indisponível */
    }
  };

  const confirmar = async () => {
    try {
      await registrar.mutateAsync({ processo: p, pagoEm, valor: p.valor });
      toast.success(`Parcela ${p.parcelaAtual} de ${p.parcelasTotal} registrada.`);
      setPagarAberto(false);
    } catch {
      /* o erro aparece no próprio diálogo */
    }
  };

  const dados: [string, string][] = [
    ["Credor", p.nome],
    ["Valor da parcela", brl(p.valor)],
    ["Parcelas", `${p.parcelasTotal} parcela${p.parcelasTotal === 1 ? "" : "s"}`],
    ["Dia do mês", `dia ${p.diaPagamento}`],
    ["Próximo vencimento", venc ? fmtBR(venc) : "—"],
  ];

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={voltar}
        className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-border/70 px-2.5 text-[12.5px] font-bold"
      >
        <ArrowLeft className="h-4 w-4" /> Dívidas e acordos
      </button>

      {/* ── O que o acordo é, em três números ── */}
      <div className="rounded-xl border border-border/70 bg-card p-3.5">
        <p className="truncate text-[13px] font-bold">{p.nome}</p>
        <p className="mt-2 text-[11.5px] text-muted-foreground">Valor total do acordo</p>
        <p className="text-[22px] font-bold leading-none tabular-nums">{brl(totalDoAcordo(p))}</p>
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <span className="text-[11.5px] text-muted-foreground">Saldo devedor</span>
          <b className="text-[14px] font-bold tabular-nums text-destructive">
            {brl(saldoDevedor(p))}
          </b>
        </div>
        <div className="mt-2.5">
          <BarraProgresso pct={pctPago(p)} encerrado={!p.ativo} />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {parcelasPagas(p)} de {p.parcelasTotal} pagas
          </p>
        </div>
      </div>

      {/* ── Dados ── */}
      <div className="rounded-xl border border-border/70 bg-card">
        <p className="border-b border-border/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Dados do acordo
        </p>
        <div className="divide-y divide-border/50">
          {dados.map(([rotulo, valor]) => (
            <div key={rotulo} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="shrink-0 text-[11.5px] text-muted-foreground">{rotulo}</span>
              <b className="min-w-0 truncate text-[12px] font-bold tabular-nums">{valor}</b>
            </div>
          ))}
        </div>
        {p.chavePix && (
          <button
            type="button"
            onClick={() => void copiar()}
            className="flex w-full items-center gap-2 border-t border-border/50 px-3 py-2.5 text-left"
          >
            {copiado ? (
              <Check className="h-4 w-4 shrink-0 text-success" />
            ) : (
              <Copy className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{p.chavePix}</span>
            <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
              {copiado ? "copiado" : "copiar Pix"}
            </span>
          </button>
        )}
      </div>

      {/* ── Parcelas ── */}
      <div className="flex items-end justify-between gap-2 px-1">
        <b className="text-[12.5px] font-bold">Parcelas</b>
        <span className="text-[11.5px] text-muted-foreground">
          {parcelasPagas(p)} de {p.parcelasTotal} pagas
        </span>
      </div>
      <div className="divide-y divide-border/50 rounded-xl border border-border/70 bg-card">
        {parcelas.map((x) => {
          const sit = SIT_PARCELA[x.situacao];
          return (
            <div key={x.numero} className="flex items-center gap-2.5 px-3 py-2.5">
              <span className="w-10 shrink-0 text-[11px] font-bold tabular-nums text-muted-foreground">
                {x.data ? ddMM(x.data) : "—"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-semibold">
                  Parcela {x.numero} de {p.parcelasTotal}
                </p>
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  {brl(x.valor)}
                  {x.comprovante && " · com comprovante"}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${sit.classe}`}
              >
                {sit.rotulo}
              </span>
            </div>
          );
        })}
      </div>

      {p.ativo && podeGerir && (
        <>
          <div aria-hidden className="h-12" />
          <button
            type="button"
            onClick={() => {
              setPagoEm(hoje);
              registrar.reset();
              setPagarAberto(true);
            }}
            className="fixed inset-x-2.5 bottom-[70px] z-20 inline-flex min-h-12 items-center justify-center gap-1.5 rounded-[14px] bg-primary text-[13px] font-bold text-[var(--primary-ink)] shadow-xl shadow-primary/40"
            style={{ marginBottom: "env(safe-area-inset-bottom)" }}
          >
            <CheckCircle2 className="h-4 w-4" />
            {p.parcelaAtual >= p.parcelasTotal
              ? "Pagar a última e encerrar"
              : `Registrar pagamento da ${p.parcelaAtual}ª`}
          </button>
        </>
      )}

      <Sheet open={pagarAberto} onOpenChange={(v) => !v && setPagarAberto(false)}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="text-left">
            <SheetTitle className="text-[15px]">Registrar a {p.parcelaAtual}ª parcela</SheetTitle>
            <SheetDescription className="text-[12.5px]">
              {p.nome} · {brl(p.valor)}
              {p.parcelaAtual >= p.parcelasTotal && " — é a última: o acordo será encerrado."}
            </SheetDescription>
          </SheetHeader>
          <label className="mt-3 block">
            <span className="text-[11.5px] font-semibold text-muted-foreground">
              Data do pagamento
            </span>
            <input
              type="date"
              value={pagoEm}
              onChange={(e) => setPagoEm(e.target.value)}
              className="mt-1 h-11 w-full rounded-[10px] border border-border/70 bg-card px-2.5 text-[12.5px]"
            />
          </label>
          {registrar.isError && (
            <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-[12px] font-semibold text-destructive">
              {registrar.error instanceof Error
                ? registrar.error.message
                : "Erro ao registrar o pagamento."}
            </p>
          )}
          <button
            type="button"
            onClick={() => void confirmar()}
            disabled={registrar.isPending || !pagoEm}
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[12px] bg-primary text-[13px] font-bold text-[var(--primary-ink)] disabled:opacity-60"
          >
            <Check className="h-4 w-4" />
            {registrar.isPending ? "Registrando…" : "Confirmar pagamento"}
          </button>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Peças compartilhadas pelas duas abas
// ─────────────────────────────────────────────────────────────

function Resumo({
  rotulo,
  valor,
  nota,
  tom,
}: {
  rotulo: string;
  valor: number;
  nota: string;
  tom?: "bom" | "ruim";
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card p-2.5">
      <p className="truncate text-[11px] text-muted-foreground">{rotulo}</p>
      <p
        className={`mt-0.5 text-[13px] font-bold leading-tight tabular-nums ${
          tom === "bom" ? "text-success" : tom === "ruim" ? "text-destructive" : ""
        }`}
      >
        {brl(valor)}
      </p>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{nota}</p>
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

function Erro({ erro }: { erro: unknown }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-6 text-center">
      <AlertCircle className="mx-auto h-5 w-5 text-destructive" />
      <p className="mt-2 text-[13px] font-bold">Não foi possível carregar os dados</p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        {erro instanceof Error ? erro.message : "Verifique sua conexão e tente novamente."}
      </p>
    </div>
  );
}

function Vazio({
  icone: Icone,
  titulo,
  texto,
}: {
  icone: typeof Receipt;
  titulo: string;
  texto: string;
}) {
  return (
    <div className="rounded-xl border border-border/70 px-3 py-8 text-center">
      <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[var(--primary-tint)]">
        <Icone className="h-5 w-5 text-primary" />
      </div>
      <p className="mt-2.5 text-[13px] font-bold">{titulo}</p>
      <p className="mx-auto mt-1 max-w-[260px] text-[12px] leading-snug text-muted-foreground">
        {texto}
      </p>
    </div>
  );
}
