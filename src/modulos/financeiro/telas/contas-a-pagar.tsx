import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Plus, Trash2, Loader2, AlertCircle, Upload, CheckCircle2, RotateCcw, X, CopyX,
} from "lucide-react";
import { brl, norm, numFromInput, clampDia } from "@/lib/format";
import { pad, fmtBR, hojeISO, nthDiaUtil, diaUtilAnterior, isoDiaDoMes } from "@/lib/datas";
import {
  useCreateRecorrente, useCreateRecorrentesLote, useDeleteRecorrente, useLimparRecorrentesDuplicadas,
  useExcluirEmMassa, useDeletePrevisto, useMarcarPrevistoPago, useMarcarPrevistosPagosLote, useReabrirPrevisto,
  statusPrevisto, fetchFeriadosEfetivos,
  type Previsto, type RecorrenteInput, type ModoDia, type StatusPrevisto,
} from "@/lib/queries";
// Quem mostra as contas do mês — aqui e no celular — soma pelos mesmos números.
import {
  useContasDoMes, useCatGroups, useManutencaoContas, ymDe, ymDeHoje, fmtMesAno, type CatGroups,
} from "@/modulos/financeiro/contas/dados-contas";
import { parseContasPagarSheet, type ParsedContaPagarRow } from "@/lib/import-parsers";
import { BoletosCell } from "@/components/BoletosEditor";
import { Recorrentes } from "@/modulos/financeiro/telas/recorrentes";

import { toast } from "sonner";
import { ModoFields, DIA_ULTIMO } from "@/components/ModoFields";

const NONE = "__none__";

const statusStyle: Record<StatusPrevisto, { badge: string; label: string }> = {
  pago: { badge: "bg-success/15 text-success border-success/30", label: "Pago" },
  aberto: { badge: "bg-warning/20 text-warning-foreground border-warning/40", label: "A pagar" },
  atrasado: { badge: "bg-destructive/15 text-destructive border-destructive/30", label: "Vencida" },
};

// Descreve o vencimento de uma regra em texto (p/ a coluna "Regra").
const descreveModo = (p: Previsto) => (p.recorrenteId ? "Recorrente" : "Avulso");

export function ContasAPagar() {
  const criar = useCreateRecorrente();
  const criarLote = useCreateRecorrentesLote();
  const delRec = useDeleteRecorrente();
  const limparDup = useLimparRecorrentesDuplicadas();
  const excluirMassa = useExcluirEmMassa();
  const delPrev = useDeletePrevisto();
  const marcarPago = useMarcarPrevistoPago();
  const pagarLote = useMarcarPrevistosPagosLote();
  const reabrir = useReabrirPrevisto();

  useManutencaoContas();
  const catGroups = useCatGroups();
  const [mesSel, setMesSel] = useState(ymDeHoje);
  const { hoje, saidas, visiveis, aPagarMes, pagoMes, vencidas, vencidasTotal, carregando: isLoading, erro: error } =
    useContasDoMes(mesSel);

  // ─── Dialogs ──────────────────────────────────────────────
  const [regraOpen, setRegraOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pagoTarget, setPagoTarget] = useState<Previsto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Previsto | null>(null);
  const [limparOpen, setLimparOpen] = useState(false);
  const [limparMsg, setLimparMsg] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  // Pagar em lote: data única para todas as selecionadas em aberto.
  const [pagarLoteOpen, setPagarLoteOpen] = useState(false);
  const [pagoEmLote, setPagoEmLote] = useState(hoje);

  // Seleção em massa (por ocorrência/previsto visível).
  const selArr = useMemo(() => saidas.filter((p) => sel.has(p.id)), [saidas, sel]);
  // Só as em aberto entram no pagamento em lote (as pagas já estão fechadas).
  const selAbertas = useMemo(() => selArr.filter((p) => !p.pago), [selArr]);
  const selAbertasTotal = selAbertas.reduce((s, p) => s + p.valor, 0);

  const abrirPagarLote = () => { setPagoEmLote(hoje); pagarLote.reset(); setPagarLoteOpen(true); };
  const confirmarPagarLote = async () => {
    try {
      const n = await pagarLote.mutateAsync({ itens: selAbertas.map((p) => ({ id: p.id, valor: p.valor })), pagoEm: pagoEmLote });
      toast.success(`${n} conta${n === 1 ? "" : "s"} marcada${n === 1 ? "" : "s"} como paga${n === 1 ? "" : "s"} em ${fmtBR(pagoEmLote)}.`);
      setSel(new Set());
      setPagarLoteOpen(false);
    } catch { /* erro exibido no diálogo via pagarLote.isError; mantém aberto */ }
  };
  const selRecorrenteIds = useMemo(
    () => [...new Set(selArr.map((p) => p.recorrenteId).filter((x): x is string => !!x))],
    [selArr]
  );
  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allVisSel = visiveis.length > 0 && visiveis.every((p) => sel.has(p.id));
  const toggleAllVis = () => setSel((s) => {
    const n = new Set(s);
    if (allVisSel) visiveis.forEach((p) => n.delete(p.id));
    else visiveis.forEach((p) => n.add(p.id));
    return n;
  });

  const confirmarBulk = async (modo: "regras" | "ocorrencias") => {
    try {
      if (modo === "regras") {
        const prevIds = selArr.filter((p) => !p.recorrenteId).map((p) => p.id);
        await excluirMassa.mutateAsync({ recorrenteIds: selRecorrenteIds, previstoIds: prevIds });
      } else {
        await excluirMassa.mutateAsync({ previstoIds: selArr.map((p) => p.id) });
      }
      setSel(new Set());
    } finally {
      setBulkOpen(false);
    }
  };

  const confirmarLimpar = async () => {
    try {
      const n = await limparDup.mutateAsync();
      setLimparMsg(n > 0 ? `${n} recorrência(s) duplicada(s) removida(s).` : "Nenhuma duplicata encontrada.");
    } catch (e) {
      setLimparMsg(e instanceof Error ? e.message : "Erro ao limpar duplicatas.");
    } finally {
      setLimparOpen(false);
    }
  };

  return (
    <AppShell
      title="Contas do mês"
      subtitle="As obrigações do período e as regras que se repetem, na mesma tela · alimentam a projeção de caixa"
      actions={
        <>
          <Button variant="outline" className="h-9" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-1.5" />Importar planilha
          </Button>
          <Button variant="outline" className="h-9" onClick={() => { setLimparMsg(null); setLimparOpen(true); }} disabled={limparDup.isPending}>
            {limparDup.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CopyX className="h-4 w-4 mr-1.5" />}Limpar duplicatas
          </Button>
          <Button onClick={() => setRegraOpen(true)} className="h-9 bg-foreground text-background hover:bg-foreground/90">
            <Plus className="h-4 w-4 mr-1.5" />Nova conta
          </Button>
        </>
      }
    >
      {limparMsg && (
        <Card className="p-3 card-elevated border-primary/30 bg-primary/5 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
            <span className="flex-1">{limparMsg}</span>
            <button onClick={() => setLimparMsg(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card className="p-5 card-elevated border-border/70">
          <p className="text-[13px] text-muted-foreground">A pagar em {fmtMesAno(mesSel)}</p>
          <p className="font-numeric text-2xl font-semibold tabular-nums text-destructive">{brl(aPagarMes)}</p>
        </Card>
        <Card className="p-5 card-elevated border-border/70">
          <p className="text-[13px] text-muted-foreground">Vencidas em aberto</p>
          <p className="font-numeric text-2xl font-semibold tabular-nums text-destructive">{brl(vencidasTotal)}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{vencidas.length} {vencidas.length === 1 ? "conta" : "contas"}</p>
        </Card>
        <Card className="p-5 card-elevated border-border/70">
          <p className="text-[13px] text-muted-foreground">Pago em {fmtMesAno(mesSel)}</p>
          <p className="font-numeric text-2xl font-semibold tabular-nums text-success">{brl(pagoMes)}</p>
        </Card>
      </div>

      {/* Seletor de mês */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Label className="text-xs text-muted-foreground">Mês</Label>
        <Input type="month" value={mesSel} onChange={(e) => setMesSel(e.target.value)} className="h-9 w-40" />
        <span className="text-xs text-muted-foreground">· vencidas de outros meses aparecem no topo</span>
      </div>

      {/* Barra de seleção em massa */}
      {sel.size > 0 && (
        <div className="flex items-center gap-3 mb-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 flex-wrap">
          <span className="text-sm font-medium">{sel.size} selecionada(s)</span>
          <button onClick={() => setSel(new Set())} className="text-xs text-muted-foreground hover:text-foreground">Limpar seleção</button>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm" className="h-8 bg-success text-white hover:bg-success/90"
              onClick={abrirPagarLote}
              disabled={selAbertas.length === 0 || pagarLote.isPending}
              title={selAbertas.length === 0 ? "Nenhuma conta em aberto na seleção" : undefined}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              Marcar {selAbertas.length} como paga{selAbertas.length === 1 ? "" : "s"}
            </Button>
            <Button size="sm" variant="destructive" className="h-8" onClick={() => setBulkOpen(true)} disabled={excluirMassa.isPending}>
              {excluirMassa.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
              Excluir selecionadas
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="py-16 grid place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : error ? (
        <div className="py-16 grid place-items-center text-destructive"><AlertCircle className="h-5 w-5 mr-2" />Erro ao carregar.</div>
      ) : (
        <Card className="card-elevated border-border/70 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 w-9">
                    <Checkbox checked={allVisSel} onCheckedChange={toggleAllVis} aria-label="Selecionar todas" />
                  </th>
                  <th className="text-left font-medium px-4 py-2.5">Vencimento</th>
                  <th className="text-left font-medium px-4 py-2.5">Descrição</th>
                  <th className="text-left font-medium px-4 py-2.5">Categoria</th>
                  <th className="text-left font-medium px-4 py-2.5">Origem</th>
                  <th className="text-left font-medium px-4 py-2.5">Boletos / PIX</th>
                  <th className="text-right font-medium px-4 py-2.5">Valor</th>
                  <th className="text-center font-medium px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visiveis.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">Nenhuma conta a pagar neste mês.</td></tr>
                ) : (
                  visiveis.map((p) => {
                    const st = statusPrevisto(p, hoje);
                    return (
                      <tr key={p.id} className={`hover:bg-secondary/30 group ${sel.has(p.id) ? "bg-primary/5" : ""}`}>
                        <td className="px-4 py-2.5">
                          <Checkbox checked={sel.has(p.id)} onCheckedChange={() => toggleSel(p.id)} aria-label={`Selecionar ${p.descricao}`} />
                        </td>
                        <td className="px-4 py-2.5 font-numeric tabular-nums whitespace-nowrap">{fmtBR(p.data)}</td>
                        <td className="px-4 py-2.5 font-medium">{p.descricao}</td>
                        <td className="px-4 py-2.5">
                          {p.categoria
                            ? <Badge variant="outline" className="bg-secondary border-0 font-medium text-[11px]">{p.categoria}</Badge>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">{descreveModo(p)}</td>
                        <td className="px-4 py-2.5"><BoletosCell boletos={p.boletos} /></td>
                        <td className="px-4 py-2.5 text-right font-numeric tabular-nums whitespace-nowrap">{brl(p.valor)}</td>
                        <td className="px-4 py-2.5 text-center">
                          <Badge variant="outline" className={`${statusStyle[st].badge} font-medium text-[11px]`}>{statusStyle[st].label}</Badge>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {p.pago ? (
                              <button onClick={() => reabrir.mutate(p.id)} title="Reabrir" className="h-7 w-7 grid place-items-center rounded-md hover:bg-secondary text-muted-foreground">
                                <RotateCcw className="h-3.5 w-3.5" />
                              </button>
                            ) : (
                              <button onClick={() => setPagoTarget(p)} title="Marcar pago" className="h-7 w-7 grid place-items-center rounded-md hover:bg-success/10 text-success">
                                <CheckCircle2 className="h-4 w-4" />
                              </button>
                            )}
                            <button onClick={() => setDeleteTarget(p)} title="Excluir" className="h-7 w-7 grid place-items-center rounded-md hover:bg-destructive/10 text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <RegraDialog
        open={regraOpen}
        onClose={() => setRegraOpen(false)}
        catGroups={catGroups}
        saving={criar.isPending}
        onCreate={async (input) => { await criar.mutateAsync(input); setRegraOpen(false); }}
      />

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        catGroups={catGroups}
        saving={criarLote.isPending}
        onCreate={async (inputs) => { await criarLote.mutateAsync(inputs); setImportOpen(false); }}
      />

      <MarcarPagoDialog
        alvo={pagoTarget}
        saving={marcarPago.isPending}
        onClose={() => setPagoTarget(null)}
        onConfirm={async (pagoEm, pagoValor) => {
          if (pagoTarget) await marcarPago.mutateAsync({ id: pagoTarget.id, pagoEm, pagoValor });
          setPagoTarget(null);
        }}
      />

      {/* Excluir: ocorrência ou a regra inteira */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conta a pagar?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.recorrenteId
                ? <>Esta conta vem de uma regra recorrente. Excluir só <strong>esta ocorrência</strong> remove o mês; excluir <strong>a regra</strong> remove todos os meses futuros.</>
                : <>A conta <strong>{deleteTarget?.descricao}</strong> será removida.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={delPrev.isPending || delRec.isPending}>Cancelar</AlertDialogCancel>
            {deleteTarget?.recorrenteId && (
              <Button
                variant="outline"
                disabled={delRec.isPending}
                onClick={async () => { if (deleteTarget?.recorrenteId) { await delRec.mutateAsync(deleteTarget.recorrenteId); setDeleteTarget(null); } }}
              >
                {delRec.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Excluir a regra
              </Button>
            )}
            <AlertDialogAction
              onClick={async (e) => { e.preventDefault(); if (deleteTarget) { await delPrev.mutateAsync(deleteTarget.id); setDeleteTarget(null); } }}
              disabled={delPrev.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {delPrev.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Excluir só esta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Limpar recorrências duplicadas */}
      <AlertDialog open={limparOpen} onOpenChange={(v) => !v && setLimparOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Limpar recorrências duplicadas?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove contas recorrentes repetidas (mesma descrição, valor e tipo), mantendo uma de cada.
              Recorrências que já têm algum pagamento registrado são <strong>preservadas</strong> — nada de histórico é perdido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={limparDup.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmarLimpar(); }} disabled={limparDup.isPending} className="bg-destructive hover:bg-destructive/90">
              {limparDup.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Limpar duplicatas
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Excluir em massa as selecionadas */}
      <AlertDialog open={bulkOpen} onOpenChange={(v) => !v && setBulkOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {sel.size} conta(s) selecionada(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              {selRecorrenteIds.length > 0
                ? <>Há contas recorrentes na seleção. <strong>Excluir as regras</strong> remove a recorrência inteira (todos os meses futuros); <strong>excluir só estas ocorrências</strong> remove apenas os meses marcados (voltam na próxima extensão, se a recorrência continuar).</>
                : <>As contas selecionadas serão removidas. Esta ação não pode ser desfeita.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluirMassa.isPending}>Cancelar</AlertDialogCancel>
            {selRecorrenteIds.length > 0 && (
              <Button variant="outline" disabled={excluirMassa.isPending} onClick={() => confirmarBulk("ocorrencias")}>
                {excluirMassa.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Excluir só estas ocorrências
              </Button>
            )}
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmarBulk(selRecorrenteIds.length > 0 ? "regras" : "ocorrencias"); }}
              disabled={excluirMassa.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {excluirMassa.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              {selRecorrenteIds.length > 0 ? "Excluir as regras" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pagar em lote: uma data para todas, cada uma com o próprio valor previsto */}
      <Dialog open={pagarLoteOpen} onOpenChange={(v) => { if (!pagarLote.isPending) setPagarLoteOpen(v); }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Marcar {selAbertas.length} conta{selAbertas.length === 1 ? "" : "s"} como paga{selAbertas.length === 1 ? "" : "s"}</DialogTitle>
            <DialogDescription>
              Total de <strong>{brl(selAbertasTotal)}</strong>. Cada conta é registrada com o próprio valor previsto —
              para pagar com valor diferente, marque aquela conta individualmente.
              {selArr.length > selAbertas.length && (
                <> {selArr.length - selAbertas.length} da seleção já {selArr.length - selAbertas.length === 1 ? "estava paga e fica" : "estavam pagas e ficam"} como {selArr.length - selAbertas.length === 1 ? "está" : "estão"}.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5 py-2">
            <Label className="text-xs">Data do pagamento</Label>
            <Input type="date" value={pagoEmLote} onChange={(e) => setPagoEmLote(e.target.value)} disabled={pagarLote.isPending} />
          </div>
          <div className="max-h-[200px] overflow-y-auto rounded-md border border-border divide-y divide-border text-sm">
            {selAbertas.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-3 py-1.5">
                <span className="font-numeric tabular-nums text-muted-foreground text-xs w-12 shrink-0">{fmtBR(p.data).slice(0, 5)}</span>
                <span className="flex-1 truncate">{p.descricao}</span>
                <span className="font-numeric tabular-nums">{brl(p.valor)}</span>
              </div>
            ))}
          </div>
          {pagarLote.isError && (
            <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {pagarLote.error instanceof Error ? pagarLote.error.message : "Erro ao registrar os pagamentos."}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPagarLoteOpen(false)} disabled={pagarLote.isPending}>Cancelar</Button>
            <Button onClick={confirmarPagarLote} disabled={pagarLote.isPending || !pagoEmLote || selAbertas.length === 0} className="bg-success text-white hover:bg-success/90">
              {pagarLote.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Confirmar {selAbertas.length} pagamento{selAbertas.length === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recorrências: a regra e o que ela gera na mesma tela (antes era uma
          aba à parte, e ir e voltar para conferir era o normal). */}
      <Recorrentes embutida />
    </AppShell>
  );
}


// (ModoFields — seletor do modo de vencimento — vive em components/ModoFields,
//  compartilhado com a tela de Recorrentes.)

// ─── Dialog: nova conta (regra recorrente) ────────────────────
type RegraFormState = {
  descricao: string; categoria: string; valor: number;
  modoDia: ModoDia; dia: number; diaUtilN: number; dia2: number;
  semPrazo: boolean; inicioMes: string; fimMes: string;
};
const emptyRegra = (): RegraFormState => {
  const now = new Date();
  const fim = new Date(now.getFullYear(), now.getMonth() + 11, 1);
  return {
    descricao: "", categoria: "", valor: 0, modoDia: "fixo", dia: 10, diaUtilN: 5, dia2: 20,
    semPrazo: true, inicioMes: ymDe(now), fimMes: ymDe(fim),
  };
};

export function RegraDialog({
  open, onClose, catGroups, saving, onCreate,
}: {
  open: boolean; onClose: () => void; catGroups: CatGroups; saving: boolean;
  onCreate: (input: RecorrenteInput) => Promise<void>;
}) {
  const [form, setForm] = useState<RegraFormState>(emptyRegra());
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setForm(emptyRegra()); setErr(null); } }, [open]);

  const handle = async () => {
    if (!form.descricao.trim()) { setErr("Informe a descrição."); return; }
    if (!form.valor || form.valor <= 0) { setErr("Informe um valor maior que zero."); return; }
    if (!form.semPrazo && form.fimMes < form.inicioMes) { setErr("O mês final deve ser igual ou depois do inicial."); return; }
    setErr(null);
    const input: RecorrenteInput = {
      descricao: form.descricao.trim(),
      categoria: form.categoria === NONE ? "" : form.categoria,
      valor: form.valor,
      tipo: "out",
      dia: form.modoDia === "dia_util" ? 1 : form.dia,
      modoDia: form.modoDia,
      diaUtilN: form.modoDia === "dia_util" ? form.diaUtilN : null,
      dia2: form.modoDia === "quinzenal" ? form.dia2 : null,
      inicio: `${form.inicioMes}-01`,
      fim: form.semPrazo ? null : `${form.fimMes}-01`,
      boletos: [],
      modoBoletos: "todos",
    };
    try { await onCreate(input); } catch (e) { setErr(e instanceof Error ? e.message : "Erro ao criar."); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Nova conta a pagar</DialogTitle>
          <DialogDescription>Cria um pagamento recorrente de saída. Vencimentos em fim de semana/feriado são antecipados para o dia útil anterior.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label className="text-xs">Descrição</Label>
            <Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Ex: Aluguel 913 / Salário / Energia" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Valor (R$)</Label>
              <Input type="number" step="0.01" inputMode="decimal" value={Number.isFinite(form.valor) ? form.valor : 0}
                onChange={(e) => setForm({ ...form, valor: numFromInput(e.target.valueAsNumber) })} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Categoria</Label>
              <Select value={form.categoria || undefined} onValueChange={(v) => setForm({ ...form, categoria: v })}>
                <SelectTrigger><SelectValue placeholder="Sem categoria" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sem categoria</SelectItem>
                  {catGroups.map((g) => (
                    <SelectGroup key={g.label}>
                      <SelectLabel>{g.label}</SelectLabel>
                      {g.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Vencimento</Label>
            <ModoFields
              modoDia={form.modoDia} dia={form.dia} diaUtilN={form.diaUtilN} dia2={form.dia2}
              onChange={(patch) => setForm({ ...form, ...patch })}
            />
            <p className="text-[11px] text-muted-foreground">
              {form.modoDia === "fixo" && form.dia >= DIA_ULTIMO && "Sempre no último dia do mês: 31 em janeiro, 30 em abril, 28 (ou 29) em fevereiro."}
              {form.modoDia === "fixo" && form.dia < DIA_ULTIMO && "Todo mês no dia informado (1–31). No mês que não tem esse dia, cai no último dia dele."}
              {form.modoDia === "dia_util" && "No N-ésimo dia útil do mês (ex.: 5º dia útil = salário). Contagem trabalhista: sábado conta; se a data cair no sábado, antecipa para a sexta."}
              {form.modoDia === "quinzenal" && "Dois vencimentos por mês (ex.: adiantamento)."}
            </p>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <Label className="text-xs">Sem prazo (todo mês)</Label>
            <Switch checked={form.semPrazo} onCheckedChange={(v) => setForm({ ...form, semPrazo: v })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Mês inicial</Label>
              <Input type="month" value={form.inicioMes} onChange={(e) => setForm({ ...form, inicioMes: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Mês final</Label>
              <Input type="month" value={form.fimMes} disabled={form.semPrazo} onChange={(e) => setForm({ ...form, fimMes: e.target.value })} />
            </div>
          </div>
          {err && <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handle} disabled={saving} className="bg-foreground text-background hover:bg-foreground/90">
            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dialog: marcar pago ──────────────────────────────────────
export function MarcarPagoDialog({
  alvo, saving, onClose, onConfirm,
}: {
  alvo: Previsto | null; saving: boolean; onClose: () => void;
  onConfirm: (pagoEm: string, pagoValor: number) => Promise<void>;
}) {
  const [pagoEm, setPagoEm] = useState(hojeISO());
  const [pagoValor, setPagoValor] = useState(0);
  useEffect(() => { if (alvo) { setPagoEm(hojeISO()); setPagoValor(alvo.valor); } }, [alvo]);
  return (
    <Dialog open={!!alvo} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Marcar como pago</DialogTitle>
          <DialogDescription>{alvo?.descricao} · vencimento {alvo && fmtBR(alvo.data)}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="grid gap-1.5">
            <Label className="text-xs">Data do pagamento</Label>
            <Input type="date" value={pagoEm} onChange={(e) => setPagoEm(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Valor pago (R$)</Label>
            <Input type="number" step="0.01" value={Number.isFinite(pagoValor) ? pagoValor : 0} onChange={(e) => setPagoValor(numFromInput(e.target.valueAsNumber))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={() => onConfirm(pagoEm, pagoValor)} disabled={saving || !(pagoValor > 0)} className="bg-success text-white hover:bg-success/90">
            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Confirmar pagamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dialog: importar planilha ────────────────────────────────
type ImportRow = {
  descricao: string; valor: number; categoria: string;
  modoDia: ModoDia; dia: number; diaUtilN: number; dia2: number;
  statusPago: boolean; incluir: boolean;
};

const toImportRow = (r: ParsedContaPagarRow): ImportRow => ({
  descricao: r.descricao ?? r.descRaw,
  valor: r.valor ?? 0,
  categoria: "",
  modoDia: "fixo",
  dia: r.dia ?? 10,
  diaUtilN: 5,
  dia2: 20,
  statusPago: r.statusPago ?? false,
  incluir: r.ok,
});

function ImportDialog({
  open, onClose, catGroups, saving, onCreate,
}: {
  open: boolean; onClose: () => void; catGroups: CatGroups; saving: boolean;
  onCreate: (inputs: RecorrenteInput[]) => Promise<void>;
}) {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [erros, setErros] = useState<ParsedContaPagarRow[]>([]);
  const [agrupadas, setAgrupadas] = useState(0);
  const [parsing, setParsing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [feriados, setFeriados] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) { setRows([]); setErros([]); setAgrupadas(0); setErr(null); return; }
    // Feriados do mês corrente + próximos p/ a prévia de vencimento.
    const now = new Date();
    const de = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
    const ate = `${now.getFullYear()}-${pad(now.getMonth() + 3)}-28`;
    fetchFeriadosEfetivos(de, ate).then(setFeriados).catch(() => setFeriados(new Set()));
  }, [open]);

  const handleFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setParsing(true); setErr(null);
    try {
      const parsed = await parseContasPagarSheet(f);
      // Cada linha vira uma conta RECORRENTE. Se a mesma conta aparece em várias
      // linhas (planilha tipo extrato/mês a mês), agrupa por descrição + valor
      // para não criar a recorrência (e o previsto de cada mês) repetida.
      const ok = parsed.filter((r) => r.ok).map(toImportRow);
      const vistos = new Set<string>();
      const unicos: ImportRow[] = [];
      let repetidas = 0;
      for (const r of ok) {
        const chave = `${norm(r.descricao)}|${r.valor.toFixed(2)}`;
        if (vistos.has(chave)) { repetidas++; continue; }
        vistos.add(chave);
        unicos.push(r);
      }
      setRows(unicos);
      setAgrupadas(repetidas);
      setErros(parsed.filter((r) => !r.ok));
      if (parsed.length === 0) setErr("Planilha vazia ou sem linhas reconhecidas.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível ler a planilha.");
    } finally { setParsing(false); }
  };

  const patch = (i: number, p: Partial<ImportRow>) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));

  const now = new Date();
  const inicioMes = ymDe(now);
  const vencPreview = (r: ImportRow): string => {
    const y = now.getFullYear(), m = now.getMonth() + 1;
    if (r.modoDia === "dia_util") return nthDiaUtil(y, m, r.diaUtilN || 1, feriados);
    return diaUtilAnterior(isoDiaDoMes(y, m, r.dia || 1), feriados);
  };

  const confirmar = async () => {
    const sel = rows.filter((r) => r.incluir && r.descricao.trim() && r.valor > 0);
    if (sel.length === 0) { setErr("Nenhuma linha válida selecionada."); return; }
    const inputs: RecorrenteInput[] = sel.map((r) => ({
      descricao: r.descricao.trim(),
      categoria: r.categoria === NONE ? "" : r.categoria,
      valor: r.valor,
      tipo: "out",
      dia: r.modoDia === "dia_util" ? 1 : r.dia,
      modoDia: r.modoDia,
      diaUtilN: r.modoDia === "dia_util" ? r.diaUtilN : null,
      dia2: r.modoDia === "quinzenal" ? r.dia2 : null,
      inicio: `${inicioMes}-01`,
      fim: null,
      boletos: [],
      modoBoletos: "todos",
    }));
    try { await onCreate(inputs); } catch (e) { setErr(e instanceof Error ? e.message : "Erro ao criar."); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[860px]">
        <DialogHeader>
          <DialogTitle>Importar planilha de contas a pagar</DialogTitle>
          <DialogDescription>
            Colunas reconhecidas: descrição, custo (R$), dia, status. Cada linha vira um pagamento recorrente sem prazo. Ajuste o vencimento e a categoria antes de criar.
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <div className="py-6">
            <input ref={inputRef} type="file" className="hidden" accept=".xlsx,.xls,.csv"
              onChange={(e) => handleFile(e.target.files)} />
            <button
              onClick={() => inputRef.current?.click()}
              className="w-full border-2 border-dashed border-border rounded-xl py-10 grid place-items-center gap-2 hover:bg-secondary/40 transition-colors"
            >
              {parsing ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : <Upload className="h-6 w-6 text-muted-foreground" />}
              <span className="text-sm text-muted-foreground">Clique para escolher a planilha (.xlsx, .xls, .csv)</span>
            </button>
            {err && <p className="mt-3 text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</p>}
          </div>
        ) : (
          <div className="py-2">
            <div className="max-h-[50vh] overflow-y-auto overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground sticky top-0">
                  <tr>
                    <th className="px-2 py-2 text-center">Incluir</th>
                    <th className="px-2 py-2 text-left">Descrição</th>
                    <th className="px-2 py-2 text-right">Valor</th>
                    <th className="px-2 py-2 text-left">Vencimento</th>
                    <th className="px-2 py-2 text-left">Categoria</th>
                    <th className="px-2 py-2 text-left">Prévia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r, i) => (
                    <tr key={i} className={r.incluir ? "" : "opacity-50"}>
                      <td className="px-2 py-1.5 text-center">
                        <Switch checked={r.incluir} onCheckedChange={(v) => patch(i, { incluir: v })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input value={r.descricao} onChange={(e) => patch(i, { descricao: e.target.value })} className="h-8 min-w-[160px]" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input type="number" step="0.01" value={Number.isFinite(r.valor) ? r.valor : 0}
                          onChange={(e) => patch(i, { valor: numFromInput(e.target.valueAsNumber) })} className="h-8 w-24 text-right" />
                      </td>
                      <td className="px-2 py-1.5">
                        <ModoFields compact modoDia={r.modoDia} dia={r.dia} diaUtilN={r.diaUtilN} dia2={r.dia2}
                          onChange={(p) => patch(i, p)} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Select value={r.categoria || undefined} onValueChange={(v) => patch(i, { categoria: v })}>
                          <SelectTrigger className="h-8 min-w-[140px]"><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>Sem categoria</SelectItem>
                            {catGroups.map((g) => (
                              <SelectGroup key={g.label}>
                                <SelectLabel>{g.label}</SelectLabel>
                                {g.options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                              </SelectGroup>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1.5 font-numeric tabular-nums text-muted-foreground whitespace-nowrap">{fmtBR(vencPreview(r))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground flex-wrap">
              <span>{rows.filter((r) => r.incluir).length} de {rows.length} serão criadas.</span>
              {agrupadas > 0 && (
                <span className="text-warning-foreground">
                  <AlertCircle className="h-3 w-3 inline" /> {agrupadas} linha(s) repetida(s) foram agrupadas (mesma conta + valor na planilha). Cada conta vira 1 recorrência.
                </span>
              )}
              {erros.length > 0 && <span className="text-destructive"><X className="h-3 w-3 inline" /> {erros.length} linha(s) ignorada(s) (sem descrição/custo).</span>}
            </div>
            {err && <p className="mt-2 text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          {rows.length > 0 && (
            <Button onClick={confirmar} disabled={saving} className="bg-foreground text-background hover:bg-foreground/90">
              {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Criar {rows.filter((r) => r.incluir).length} conta(s)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
