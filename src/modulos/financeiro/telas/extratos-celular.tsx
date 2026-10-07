// ─── Extratos no celular: revisar e conferir ────────────────────────────────
// Os dois passos dos Extratos que não cabiam numa tela estreita. A tabela de
// pendências vira uma pilha de cartões com a categoria em destaque — é a tarefa
// que se faz de pé, esperando —, e a conferência vira a comparação dos dois
// saldos, lado a lado, com as divergências embaixo.
//
// O passo 1 (Importar) NÃO tem versão de celular: a tela de computador já cabe
// em 390px, e refazer o importador — vários arquivos, destino por arquivo,
// duplicatas, cartão, acerto de saldo — criaria um segundo importador com
// outras regras. Ali o celular ganha só o texto certo para o dedo.
//
// NADA de regra vive aqui:
//   · a escolha de categoria, o que está pronto para aprovar, aprovar e
//     descartar → extratos/dados-revisao.ts
//   · ler o arquivo do banco e comparar com o app → extratos/analise-extrato.ts
//     (o casamento em si é lib/conciliacao, puro e com teste)
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  FileSearch,
  Landmark,
  ListChecks,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
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
import { ddMM, fmtBR } from "@/lib/datas";
import { useEmpresa } from "@/lib/empresa";
import { caminhoConta } from "@/lib/categorias";
import { useContasBancarias, type Conta } from "@/lib/queries";
import type { Lancamento } from "@/lib/conciliacao";
import { useRevisao } from "@/modulos/financeiro/extratos/dados-revisao";
import { useAnaliseExtrato, ACEITA_EXTRATO } from "@/modulos/financeiro/extratos/analise-extrato";

// ─────────────────────────────────────────────────────────────
// 2. Revisar e classificar
// ─────────────────────────────────────────────────────────────

export function RevisaoCelular({ lote }: { lote?: string } = {}) {
  const {
    pendentes,
    contas,
    carregando,
    escolhas,
    escolher,
    comCategoria,
    semCategoria,
    comSugestao,
    semPlano,
    aprovar,
    aprovarUma,
    aprovarTodas,
    excluirUma,
    excluirTodasMut,
    excluirTodas,
    sugerir,
  } = useRevisao(lote);

  const [sel, setSel] = useState<Set<string>>(new Set());
  const [folha, setFolha] = useState<{ ids: string[] } | null>(null);
  const [descartarAberto, setDescartarAberto] = useState(false);

  // Caminho "Pai / Filho" de cada categoria, para mostrar o que foi escolhido.
  const nomeDaCategoria = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of contas) map.set(c.id, caminhoConta(c, contas));
    return map;
  }, [contas]);

  const alternar = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const aplicarCategoria = (catId: string) => {
    for (const id of folha?.ids ?? []) escolher(id, catId);
    setFolha(null);
    setSel(new Set());
  };

  const pct = pendentes.length ? Math.round((comCategoria.length / pendentes.length) * 100) : 0;

  if (carregando) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-[118px] animate-pulse rounded-xl bg-secondary" />
        ))}
      </div>
    );
  }

  if (pendentes.length === 0) {
    return (
      <div className="rounded-xl border border-border/70 px-3 py-10 text-center">
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-success/10">
          <CheckCircle2 className="h-5 w-5 text-success" />
        </div>
        <p className="mt-2.5 text-[13.5px] font-bold">Nenhuma transação pendente</p>
        <p className="mx-auto mt-1 max-w-[260px] text-[12px] leading-snug text-muted-foreground">
          Tudo revisado. Importe um extrato para começar um novo lote.
        </p>
        <div className="mt-3.5 flex flex-col gap-2">
          <Link
            to="/financeiro/extratos"
            search={{ aba: "importar" }}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[10px] border border-border/70 text-[12.5px] font-bold"
          >
            <Upload className="h-4 w-4" /> Importar extrato
          </Link>
          <Link
            to="/financeiro/caixa"
            search={{ aba: "movimentacoes" }}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[10px] bg-primary text-[12.5px] font-bold text-[var(--primary-ink)]"
          >
            Ver movimentações <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {semPlano && (
        <div className="rounded-xl border border-warning/40 bg-warning/5 px-3 py-2.5">
          <p className="text-[12px] font-semibold leading-snug text-warning-ink">
            Seu plano de contas está vazio.{" "}
            <Link to="/financeiro/plano-de-contas" className="underline">
              Cadastre as categorias
            </Link>{" "}
            para conseguir aprovar.
          </p>
        </div>
      )}

      {/* ── Quanto falta ── */}
      <div className="rounded-xl border border-border/70 bg-card p-3.5">
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[20px] font-bold leading-none tabular-nums">
              {semCategoria} de {pendentes.length}
            </p>
            <p className="mt-1 text-[11.5px] text-muted-foreground">por classificar</p>
          </div>
          <span className="shrink-0 text-[12px] font-bold text-primary">{pct}% pronto</span>
        </div>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          {comSugestao} com sugestão da máquina. Aprovar grava a categoria e ensina o sistema — sem
          aprovar, nada conta nos relatórios.
        </p>
      </div>

      {/* ── Ações do lote ── */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => sugerir.mutate(lote)}
          disabled={sugerir.isPending}
          className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-border/70 px-2 text-[12.5px] font-bold disabled:opacity-60"
        >
          <Sparkles className="h-4 w-4" />
          {sugerir.isPending ? "Sugerindo…" : "Sugerir categorias"}
        </button>
        <button
          type="button"
          onClick={() => setDescartarAberto(true)}
          disabled={excluirTodasMut.isPending}
          aria-label="Descartar todas as pendências"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-destructive/30 text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {sugerir.isSuccess && (
        <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-[11.5px] leading-snug">
          {sugerir.data > 0
            ? `${sugerir.data} pendência(s) ganharam sugestão pelas regras cadastradas.`
            : "Nenhuma regra bateu com as descrições pendentes."}
        </p>
      )}
      {aprovar.isError && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[12px] font-semibold text-destructive">
          {aprovar.error instanceof Error ? aprovar.error.message : "Erro ao aprovar."}
        </p>
      )}

      {/* ── A pilha ── */}
      <div className="space-y-2">
        {pendentes.map((p) => {
          const catId = escolhas[p.id];
          const sugerida = !!p.sugeridaId && catId === p.sugeridaId;
          return (
            <div
              key={p.id}
              className={`rounded-xl border p-3 transition-colors ${
                sel.has(p.id)
                  ? "border-primary bg-[var(--primary-soft)]"
                  : "border-border/70 bg-card"
              }`}
            >
              <div className="flex items-start gap-2.5">
                <button
                  type="button"
                  onClick={() => alternar(p.id)}
                  aria-label={`Selecionar ${p.descricao}`}
                  aria-pressed={sel.has(p.id)}
                  className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border ${
                    sel.has(p.id)
                      ? "border-primary bg-primary text-[var(--primary-ink)]"
                      : "border-border"
                  }`}
                >
                  {sel.has(p.id) && <Check className="h-3 w-3" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-bold">{p.descricao}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {ddMM(p.dataISO)} · {p.tipo === "in" ? "entrada" : "saída"}
                  </p>
                </div>
                <b
                  className={`shrink-0 text-[12.5px] font-bold tabular-nums ${
                    p.tipo === "in" ? "text-success" : "text-destructive"
                  }`}
                >
                  {p.tipo === "in" ? "+" : "−"}
                  {brl(p.valor)}
                </b>
              </div>

              {/* A categoria é o campo da tela: ela ocupa a largura inteira. */}
              <button
                type="button"
                onClick={() => setFolha({ ids: [p.id] })}
                disabled={semPlano}
                className={`mt-2.5 flex w-full items-center gap-2 rounded-[10px] border px-2.5 py-2 text-left ${
                  catId
                    ? "border-primary/40 bg-[var(--primary-tint)]"
                    : "border-dashed border-border"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[10.5px] uppercase tracking-wider text-muted-foreground">
                    Categoria
                  </span>
                  <span
                    className={`block truncate text-[12px] font-bold ${
                      catId ? "" : "text-muted-foreground"
                    }`}
                  >
                    {catId ? (nomeDaCategoria.get(catId) ?? "—") : "Escolher categoria"}
                  </span>
                </span>
                {sugerida && (
                  <span className="shrink-0 rounded-md bg-primary/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-primary">
                    sugestão
                  </span>
                )}
              </button>

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void aprovarUma(p.id)}
                  disabled={!catId || aprovar.isPending}
                  className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-success/10 text-[12px] font-bold text-success disabled:opacity-40"
                >
                  <Check className="h-4 w-4" /> Aceitar
                </button>
                <button
                  type="button"
                  onClick={() => setFolha({ ids: [p.id] })}
                  disabled={semPlano}
                  className="inline-flex min-h-9 flex-1 items-center justify-center rounded-[10px] border border-border/70 text-[12px] font-bold"
                >
                  Trocar categoria
                </button>
                <button
                  type="button"
                  onClick={() => excluirUma.mutate(p.id)}
                  disabled={excluirUma.isPending}
                  aria-label={`Descartar ${p.descricao}`}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-border/70 text-destructive"
                >
                  <Trash2 className="h-[15px] w-[15px]" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Espaço da barra fixa que fica por cima do fim da lista. */}
      <div aria-hidden className="h-[62px]" />

      {/* ── Barra: aprovar tudo, ou classificar as selecionadas ── */}
      <div
        className="fixed inset-x-2.5 bottom-[70px] z-20 flex min-h-[58px] items-center gap-2 rounded-[14px] bg-primary py-2 pl-3.5 pr-2 text-[var(--primary-ink)] shadow-xl shadow-primary/40"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-bold leading-tight">
            {sel.size > 0
              ? `${sel.size} selecionada${sel.size === 1 ? "" : "s"}`
              : `${comCategoria.length} com categoria`}
          </p>
          <p className="mt-0.5 truncate text-[12px] leading-tight opacity-80">
            {sel.size > 0 ? "classifique em conjunto" : `${semCategoria} ainda sem`}
          </p>
        </div>
        {sel.size > 0 ? (
          <button
            type="button"
            onClick={() => setFolha({ ids: [...sel] })}
            disabled={semPlano}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] bg-[var(--primary-tint)] px-3 text-[12.5px] font-bold disabled:opacity-50"
          >
            Escolher categoria
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void aprovarTodas()}
            disabled={semPlano || comCategoria.length === 0 || aprovar.isPending}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] bg-[var(--primary-tint)] px-3 text-[12.5px] font-bold disabled:opacity-50"
          >
            <ListChecks className="h-4 w-4" />
            {aprovar.isPending ? "Aprovando…" : `Aprovar ${comCategoria.length}`}
          </button>
        )}
      </div>

      <FolhaCategoria
        aberta={!!folha}
        fechar={() => setFolha(null)}
        contas={contas}
        quantas={folha?.ids.length ?? 0}
        onEscolher={aplicarCategoria}
      />

      <AlertDialog open={descartarAberto} onOpenChange={setDescartarAberto}>
        <AlertDialogContent>
          <AlertDialogTitle>Descartar {pendentes.length} pendência(s)?</AlertDialogTitle>
          <AlertDialogHeader>
            <AlertDialogDescription>
              Os lançamentos somem sem entrar no caixa. Se vieram do banco, voltam na próxima
              importação do mesmo período.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluirTodasMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async (e) => {
                e.preventDefault();
                await excluirTodas();
                setDescartarAberto(false);
              }}
              disabled={excluirTodasMut.isPending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {excluirTodasMut.isPending ? "Descartando…" : "Descartar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Folha de categorias ────────────────────────────────────
// Lista plana com busca: no celular, abrir pai e depois filha são dois toques
// a mais numa tarefa que se repete dezenas de vezes.
function FolhaCategoria({
  aberta,
  fechar,
  contas,
  quantas,
  onEscolher,
}: {
  aberta: boolean;
  fechar: () => void;
  contas: Conta[];
  quantas: number;
  onEscolher: (catId: string) => void;
}) {
  const [busca, setBusca] = useState("");

  const opcoes = useMemo(() => {
    const todas = contas.map((c) => ({
      id: c.id,
      caminho: caminhoConta(c, contas),
      filha: !!c.parentId,
    }));
    todas.sort((a, b) => a.caminho.localeCompare(b.caminho, "pt-BR"));
    const t = busca.trim().toLowerCase();
    return t ? todas.filter((o) => o.caminho.toLowerCase().includes(t)) : todas;
  }, [contas, busca]);

  return (
    <Sheet
      open={aberta}
      onOpenChange={(v) => {
        if (!v) {
          setBusca("");
          fechar();
        }
      }}
    >
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="text-left">
          <SheetTitle className="text-[15px]">Escolher categoria</SheetTitle>
          <SheetDescription className="text-[12.5px]">
            Classifica {quantas} lançamento{quantas === 1 ? "" : "s"}.
          </SheetDescription>
        </SheetHeader>
        <label className="mt-3 flex items-center gap-2 rounded-[12px] border border-border/70 bg-card px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar categoria"
            aria-label="Buscar categoria"
            className="h-10 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
          />
          {busca && (
            <button type="button" onClick={() => setBusca("")} aria-label="Limpar busca">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </label>
        <div className="mt-2 space-y-0.5">
          {opcoes.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-muted-foreground">
              Nenhuma categoria com esse nome.
            </p>
          ) : (
            opcoes.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => onEscolher(o.id)}
                className={`block w-full truncate rounded-lg px-2.5 py-2.5 text-left text-[12.5px] ${
                  o.filha ? "pl-5 font-medium" : "font-bold"
                }`}
              >
                {o.caminho}
              </button>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────
// 3. Conferir com o banco
// ─────────────────────────────────────────────────────────────

export function ConferirCelular() {
  const { data: contas = [] } = useContasBancarias();
  const { contaId: contaAtivaId } = useEmpresa();
  const ativas = contas.filter((c) => c.ativo);
  const [contaId, setContaId] = useState<string>(contaAtivaId ?? ativas[0]?.id ?? "");
  const { inputRef, analise, carregando, erro, analisar, diverge } = useAnaliseExtrato();

  const contaSel = contas.find((c) => c.id === contaId) ?? (ativas.length === 1 ? ativas[0] : null);
  const r = analise?.resultado;
  const diferenca =
    analise?.banco && analise.appSaldo != null ? analise.banco.saldo - analise.appSaldo : 0;

  return (
    <div className="space-y-3">
      <p className="px-1 text-[12px] leading-snug text-muted-foreground">
        Compara um extrato do banco com o que já está no app. Não importa nem altera nada: só diz o
        que bate, o que falta e o que sobra.
      </p>

      {/* ── Conta e arquivo ── */}
      <div className="space-y-2 rounded-xl border border-border/70 bg-card p-3">
        <label className="block">
          <span className="text-[11.5px] font-semibold text-muted-foreground">Conta bancária</span>
          <select
            value={contaId}
            onChange={(e) => setContaId(e.target.value)}
            className="mt-1 h-11 w-full rounded-[10px] border border-border/70 bg-card px-2.5 text-[12.5px]"
          >
            {ativas.length === 0 && <option value="">Nenhuma conta ativa</option>}
            {ativas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
        <input
          ref={inputRef}
          type="file"
          accept={ACEITA_EXTRATO}
          className="hidden"
          onChange={(e) => void analisar(e.target.files, contaSel ?? ativas[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={carregando || ativas.length === 0}
          className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[12px] bg-primary text-[13px] font-bold text-[var(--primary-ink)] disabled:opacity-60"
        >
          <Upload className="h-4 w-4" />
          {carregando ? "Conferindo…" : "Escolher extrato do banco"}
        </button>
        <p className="text-[11px] leading-snug text-muted-foreground">
          OFX, PDF do extrato do C6, CSV ou Excel.
        </p>
        {ativas.length === 0 && (
          <p className="text-[11.5px] font-semibold text-destructive">
            Nenhuma conta bancária ativa. Cadastre uma em Configurações.
          </p>
        )}
      </div>

      {erro && (
        <p className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-[12px] font-semibold text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {erro}
        </p>
      )}

      {analise && r && (
        <>
          <p className="px-1 text-[11.5px] text-muted-foreground">
            {analise.fileName} · {analise.contaNome}
          </p>

          {/* ── Os dois saldos ── */}
          {analise.banco && analise.appSaldo != null ? (
            <div
              className={`rounded-xl border p-3.5 ${
                diverge
                  ? "border-destructive/40 bg-destructive/5"
                  : "border-success/40 bg-success/5"
              }`}
            >
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground">Saldo no app</p>
                  <b className="block truncate text-[14px] font-bold tabular-nums">
                    {brl(analise.appSaldo)}
                  </b>
                </div>
                <span className="shrink-0 text-[13px] text-muted-foreground">×</span>
                <div className="min-w-0 text-right">
                  <p className="text-[11px] text-muted-foreground">Saldo no banco</p>
                  <b className="block truncate text-[14px] font-bold tabular-nums">
                    {brl(analise.banco.saldo)}
                  </b>
                </div>
              </div>
              <div
                className={`mt-2.5 flex items-center justify-center gap-1.5 border-t pt-2.5 text-[12px] font-bold ${
                  diverge
                    ? "border-destructive/30 text-destructive"
                    : "border-success/30 text-success"
                }`}
              >
                {diverge ? (
                  <>
                    <AlertTriangle className="h-4 w-4" /> Diferença de {brl(Math.abs(diferenca))}
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" /> Os saldos conferem
                  </>
                )}
              </div>
              <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
                em {fmtBR(analise.banco.data)}
              </p>
            </div>
          ) : (
            <p className="flex items-start gap-2 rounded-xl border border-border/70 px-3 py-2.5 text-[11.5px] leading-snug text-muted-foreground">
              <Landmark className="mt-0.5 h-4 w-4 shrink-0" />
              Este arquivo não traz o saldo do banco — dá para conferir os lançamentos, mas não os
              saldos.
            </p>
          )}

          {/* ── O placar ── */}
          <div className="grid grid-cols-3 gap-2">
            <Placar rotulo="Batem" n={r.batem} tom="bom" />
            <Placar
              rotulo="Faltam"
              n={r.faltam.length}
              tom={r.faltam.length ? "ruim" : undefined}
            />
            <Placar
              rotulo="Sobram"
              n={r.sobram.length}
              tom={r.sobram.length ? "aviso" : undefined}
            />
          </div>

          {r.faltam.length === 0 && r.sobram.length === 0 && r.divergentes.length === 0 ? (
            <div className="rounded-xl border border-success/40 bg-success/5 px-3 py-6 text-center">
              <CheckCircle2 className="mx-auto h-6 w-6 text-success" />
              <p className="mt-2 text-[13px] font-bold">Período conferido</p>
              <p className="mx-auto mt-1 max-w-[270px] text-[12px] leading-snug text-muted-foreground">
                Todos os {r.batem} lançamentos do extrato já estão no app, com o mesmo valor.
              </p>
            </div>
          ) : (
            <>
              <ListaDivergencia
                titulo="Está no banco, mas não no app"
                descricao="Falta importar — abra o passo 1."
                marca="B"
                tom="destructive"
                itens={r.faltam}
              />
              <ListaDivergencia
                titulo="Está no app, mas não no extrato"
                descricao="Pode ser lançamento manual ou duplicata."
                marca="A"
                tom="warning"
                itens={r.sobram}
              />
              {r.divergentes.length > 0 && (
                <div className="rounded-xl border border-warning/40">
                  <p className="border-b border-warning/30 px-3 py-2 text-[11.5px] font-bold">
                    {r.divergentes.length} com valor diferente
                  </p>
                  <div className="divide-y divide-border/50">
                    {r.divergentes.map((d, i) => (
                      <div key={`${d.ofx.fitid ?? i}`} className="px-3 py-2">
                        <p className="truncate text-[12px] font-semibold">{d.ofx.descricao}</p>
                        <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                          banco {brl(d.ofx.valor)} · app {brl(d.app.valor)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <Link
                to="/financeiro/extratos"
                search={{ aba: "importar" }}
                className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[12px] border border-border/70 text-[12.5px] font-bold"
              >
                <Upload className="h-4 w-4" /> Importar o que falta
              </Link>
            </>
          )}
        </>
      )}

      {!analise && !carregando && !erro && (
        <div className="rounded-xl border border-border/70 px-3 py-8 text-center">
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[var(--primary-tint)]">
            <FileSearch className="h-5 w-5 text-primary" />
          </div>
          <p className="mt-2.5 text-[13px] font-bold">Nenhum extrato conferido ainda</p>
          <p className="mx-auto mt-1 max-w-[260px] text-[12px] leading-snug text-muted-foreground">
            Escolha o arquivo do banco para comparar com o que o app já tem.
          </p>
        </div>
      )}
    </div>
  );
}

function Placar({ rotulo, n, tom }: { rotulo: string; n: number; tom?: "bom" | "ruim" | "aviso" }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card p-2.5 text-center">
      <p
        className={`text-[18px] font-bold leading-none tabular-nums ${
          tom === "bom"
            ? "text-success"
            : tom === "ruim"
              ? "text-destructive"
              : tom === "aviso"
                ? "text-warning-ink"
                : ""
        }`}
      >
        {n}
      </p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground">{rotulo}</p>
    </div>
  );
}

function ListaDivergencia({
  titulo,
  descricao,
  marca,
  tom,
  itens,
}: {
  titulo: string;
  descricao: string;
  marca: string;
  tom: "warning" | "destructive";
  itens: Lancamento[];
}) {
  if (itens.length === 0) return null;
  const borda = tom === "warning" ? "border-warning/40" : "border-destructive/40";
  const selo =
    tom === "warning" ? "bg-warning/20 text-warning-ink" : "bg-destructive/15 text-destructive";
  return (
    <div className={`rounded-xl border ${borda}`}>
      <div className="border-b border-border/50 px-3 py-2">
        <p className="text-[11.5px] font-bold">
          {itens.length} {titulo.toLowerCase()}
        </p>
        <p className="text-[11px] text-muted-foreground">{descricao}</p>
      </div>
      <div className="divide-y divide-border/50">
        {itens.slice(0, 20).map((l, i) => (
          <div key={l.id ?? `${l.fitid ?? i}`} className="flex items-center gap-2.5 px-3 py-2">
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-[11px] font-bold ${selo}`}
            >
              {marca}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold">
                {l.descricao || "(sem descrição)"}
              </p>
              <p className="text-[11px] text-muted-foreground">{ddMM(l.dataISO)}</p>
            </div>
            <b
              className={`shrink-0 text-[12px] font-bold tabular-nums ${
                l.tipo === "in" ? "text-success" : "text-destructive"
              }`}
            >
              {l.tipo === "in" ? "+" : "−"}
              {brl(l.valor)}
            </b>
          </div>
        ))}
        {itens.length > 20 && (
          <p className="px-3 py-2 text-[11px] text-muted-foreground">
            e mais {itens.length - 20} — a lista inteira está no computador.
          </p>
        )}
      </div>
    </div>
  );
}
