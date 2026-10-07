import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Plus, Search, MoreHorizontal, Loader2, AlertCircle, Pencil, Trash2, Copy, Check, Scale,
  CheckCircle2, Paperclip, ExternalLink, X, FileText, Receipt,
} from "lucide-react";
import { brl, numFromInput, clampDia } from "@/lib/format";
import { fmtBR, hojeISO } from "@/lib/datas";
import { filtraProcessos, parcelasPagas, pctPago, resumoProcessos } from "@/lib/processos";
import {
  usePagamentosProcessos, useSavePagamentoProcesso, useDeletePagamentoProcesso,
  useRegistrarPagamentoProcesso, useParcelasProcesso, useAnexarComprovante, useRemoverComprovante,
  urlComprovante, AVISO_MIGRACAO_37,
  type PagamentoProcesso, type PagamentoProcessoInput, type ParcelaProcesso,
} from "@/lib/queries";

const emptyForm: PagamentoProcessoInput = {
  nome: "", valor: 0, diaPagamento: 5, parcelaAtual: 1, parcelasTotal: 1, chavePix: "", ativo: true,
};

const ACEITA_COMPROVANTE = "image/jpeg,image/png,image/webp,application/pdf";

// ─── Diálogo de criar/editar processo ───────────────────────
function ProcessoDialog({ open, onOpenChange, processo }: { open: boolean; onOpenChange: (v: boolean) => void; processo: PagamentoProcesso | null }) {
  const save = useSavePagamentoProcesso();
  const [form, setForm] = useState<PagamentoProcessoInput>(emptyForm);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setForm(
      processo
        ? {
            nome: processo.nome, valor: processo.valor, diaPagamento: processo.diaPagamento,
            parcelaAtual: processo.parcelaAtual, parcelasTotal: processo.parcelasTotal,
            chavePix: processo.chavePix, ativo: processo.ativo,
          }
        : emptyForm
    );
  }, [open, processo]);

  const handleSave = async () => {
    if (!form.nome.trim()) { setErr("Informe o nome do processo."); return; }
    if (!(form.valor > 0)) { setErr("Informe um valor maior que zero."); return; }
    if (form.parcelaAtual > form.parcelasTotal) { setErr("A parcela atual não pode ser maior que o total de parcelas."); return; }
    setErr(null);
    try {
      await save.mutateAsync({ id: processo?.id, input: { ...form, nome: form.nome.trim() } });
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao salvar o processo.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{processo ? "Editar processo" : "Novo processo"}</DialogTitle>
          <DialogDescription>Valor da parcela, dia de pagamento, parcela atual e a chave Pix para pagar.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="col-span-2">
            <Label className="text-xs">Nome</Label>
            <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex: Processo 0012345-67 / Fulano" autoFocus />
          </div>
          <div>
            <Label className="text-xs">Valor da parcela (R$)</Label>
            <Input type="number" min={0} step="0.01" inputMode="decimal"
              value={Number.isFinite(form.valor) ? form.valor : 0}
              onChange={(e) => setForm({ ...form, valor: numFromInput(e.target.valueAsNumber) })} />
          </div>
          <div>
            <Label className="text-xs">Dia de pagamento (1–28)</Label>
            <Input type="number" min={1} max={28} step={1}
              value={form.diaPagamento}
              onChange={(e) => setForm({ ...form, diaPagamento: clampDia(e.target.valueAsNumber) })} />
          </div>
          <div>
            <Label className="text-xs">Próxima parcela a pagar</Label>
            <Input type="number" min={1} step={1}
              value={form.parcelaAtual}
              onChange={(e) => setForm({ ...form, parcelaAtual: Math.max(1, Math.round(e.target.valueAsNumber || 1)) })} />
          </div>
          <div>
            <Label className="text-xs">Total de parcelas</Label>
            <Input type="number" min={1} step={1}
              value={form.parcelasTotal}
              onChange={(e) => setForm({ ...form, parcelasTotal: Math.max(1, Math.round(e.target.valueAsNumber || 1)) })} />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Chave Pix</Label>
            <Input value={form.chavePix} onChange={(e) => setForm({ ...form, chavePix: e.target.value })}
              placeholder="CPF/CNPJ, e-mail, telefone ou chave aleatória" className="font-mono text-xs" />
          </div>
          <div className="col-span-2 flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div>
              <Label className="text-xs">Em aberto</Label>
              <p className="text-[11px] text-muted-foreground">Encerra sozinho ao registrar a última parcela. Desmarque para encerrar à mão (ou reabrir).</p>
            </div>
            <Switch checked={form.ativo} onCheckedChange={(v) => setForm({ ...form, ativo: v })} />
          </div>
        </div>

        {err && <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancelar</Button>
          <Button onClick={handleSave} disabled={save.isPending} className="bg-foreground text-background hover:bg-foreground/90">
            {save.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}{processo ? "Salvar" : "Cadastrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Diálogo: registrar o pagamento da parcela atual ────────
function PagarDialog({ processo, onClose }: { processo: PagamentoProcesso | null; onClose: () => void }) {
  const registrar = useRegistrarPagamentoProcesso();
  const [pagoEm, setPagoEm] = useState(hojeISO());
  const [valor, setValor] = useState(0);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!processo) return;
    setPagoEm(hojeISO()); setValor(processo.valor); setArquivo(null); setErr(null); registrar.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processo?.id]);

  if (!processo) return null;
  const ultima = processo.parcelaAtual >= processo.parcelasTotal;

  const confirmar = async () => {
    if (!(valor > 0)) { setErr("Informe o valor pago."); return; }
    if (!pagoEm) { setErr("Informe a data do pagamento."); return; }
    setErr(null);
    try {
      const r = await registrar.mutateAsync({ processo, pagoEm, valor, arquivo });
      toast.success(
        r.encerrado
          ? `Última parcela (${r.numero}/${processo.parcelasTotal}) registrada — processo encerrado.`
          : `Parcela ${r.numero}/${processo.parcelasTotal} registrada.`
      );
      if (r.historicoIndisponivel) toast.warning(AVISO_MIGRACAO_37);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao registrar o pagamento.");
    }
  };

  return (
    <Dialog open={!!processo} onOpenChange={(v) => { if (!v && !registrar.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Registrar pagamento</DialogTitle>
          <DialogDescription>
            {processo.nome} · parcela <strong>{processo.parcelaAtual} de {processo.parcelasTotal}</strong>
            {ultima && <> — é a última: o processo será <strong>encerrado</strong>.</>}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="grid gap-1.5">
            <Label className="text-xs">Data do pagamento</Label>
            <Input type="date" value={pagoEm} onChange={(e) => setPagoEm(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Valor pago (R$)</Label>
            <Input type="number" step="0.01" inputMode="decimal" value={Number.isFinite(valor) ? valor : 0}
              onChange={(e) => setValor(numFromInput(e.target.valueAsNumber))} />
          </div>
          <div className="col-span-2 grid gap-1.5">
            <Label className="text-xs">Comprovante (opcional)</Label>
            <input ref={fileRef} type="file" accept={ACEITA_COMPROVANTE} className="hidden"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
            {arquivo ? (
              <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs">
                <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="truncate flex-1">{arquivo.name}</span>
                <button onClick={() => { setArquivo(null); if (fileRef.current) fileRef.current.value = ""; }} className="text-muted-foreground hover:text-foreground" title="Remover">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <Button type="button" variant="outline" className="h-9 justify-start" onClick={() => fileRef.current?.click()}>
                <Paperclip className="h-4 w-4 mr-1.5" />Anexar PDF ou imagem
              </Button>
            )}
            <p className="text-[11px] text-muted-foreground">Dá para anexar depois também, abrindo o processo.</p>
          </div>
        </div>
        {err && <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={registrar.isPending}>Cancelar</Button>
          <Button onClick={confirmar} disabled={registrar.isPending} className="bg-success text-white hover:bg-success/90">
            {registrar.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
            {ultima ? "Pagar e encerrar" : "Confirmar pagamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Diálogo: detalhe do processo com o histórico e os comprovantes ─
function DetalheDialog({
  processo, onClose, onPagar, onEditar,
}: { processo: PagamentoProcesso | null; onClose: () => void; onPagar: (p: PagamentoProcesso) => void; onEditar: (p: PagamentoProcesso) => void }) {
  const { data: parcelas = [], isLoading, error } = useParcelasProcesso(processo?.id ?? null);
  const anexar = useAnexarComprovante();
  const remover = useRemoverComprovante();
  const [alvoAnexo, setAlvoAnexo] = useState<ParcelaProcesso | null>(null);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setErr(null); }, [processo?.id]);

  if (!processo) return null;
  const pagas = Math.max(0, processo.ativo ? processo.parcelaAtual - 1 : processo.parcelasTotal);
  const pct = Math.min(100, Math.round((pagas / processo.parcelasTotal) * 100));
  const restante = processo.ativo ? processo.valor * Math.max(0, processo.parcelasTotal - processo.parcelaAtual + 1) : 0;

  const escolherArquivo = (parcela: ParcelaProcesso) => { setAlvoAnexo(parcela); fileRef.current?.click(); };
  const onArquivo = async (files: FileList | null) => {
    const f = files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!f || !alvoAnexo) return;
    setErr(null);
    try { await anexar.mutateAsync({ parcela: alvoAnexo, arquivo: f }); }
    catch (e) { setErr(e instanceof Error ? e.message : "Erro ao anexar."); }
    finally { setAlvoAnexo(null); }
  };
  const abrir = async (parcela: ParcelaProcesso) => {
    if (!parcela.comprovantePath) return;
    setAbrindo(parcela.id); setErr(null);
    try { window.open(await urlComprovante(parcela.comprovantePath), "_blank", "noopener"); }
    catch (e) { setErr(e instanceof Error ? e.message : "Erro ao abrir."); }
    finally { setAbrindo(null); }
  };
  const tirar = async (parcela: ParcelaProcesso) => {
    setErr(null);
    try { await remover.mutateAsync(parcela); }
    catch (e) { setErr(e instanceof Error ? e.message : "Erro ao remover."); }
  };

  return (
    <Dialog open={!!processo} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span className="truncate">{processo.nome}</span>
            {!processo.ativo && <Badge variant="outline" className="text-[10px] bg-secondary text-muted-foreground border-border">Encerrado</Badge>}
          </DialogTitle>
          <DialogDescription>
            {brl(processo.valor)} por parcela · vence dia {processo.diaPagamento}
            {processo.chavePix && <> · Pix <span className="font-mono">{processo.chavePix}</span></>}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-md border border-border px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pagas</p>
            <p className="font-numeric text-sm font-semibold tabular-nums">{pagas} / {processo.parcelasTotal}</p>
          </div>
          <div className="rounded-md border border-border px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Próxima</p>
            <p className="font-numeric text-sm font-semibold tabular-nums">{processo.ativo ? `${processo.parcelaAtual}ª` : "—"}</p>
          </div>
          <div className="rounded-md border border-border px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Restante</p>
            <p className="font-numeric text-sm font-semibold tabular-nums text-destructive">{brl(restante)}</p>
          </div>
        </div>
        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${processo.ativo ? "bg-primary" : "bg-success"}`} style={{ width: `${pct}%` }} />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium flex items-center gap-1.5"><Receipt className="h-3.5 w-3.5 text-muted-foreground" />Pagamentos registrados</p>
            {processo.ativo && (
              <Button size="sm" className="h-8 bg-success text-white hover:bg-success/90" onClick={() => onPagar(processo)}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Registrar pagamento
              </Button>
            )}
          </div>
          <input ref={fileRef} type="file" accept={ACEITA_COMPROVANTE} className="hidden" onChange={(e) => onArquivo(e.target.files)} />
          <div className="rounded-md border border-border divide-y divide-border max-h-[260px] overflow-y-auto">
            {isLoading ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Carregando...</div>
            ) : error ? (
              <div className="px-3 py-4 text-xs text-warning-foreground bg-warning/5">
                {error instanceof Error ? error.message : "Não consegui carregar o histórico."}
              </div>
            ) : parcelas.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nenhum pagamento registrado ainda{pagas > 0 ? " por aqui (as parcelas anteriores foram lançadas antes deste histórico existir)" : ""}.
              </div>
            ) : (
              parcelas.map((pc) => {
                const ocupado = (anexar.isPending && alvoAnexo?.id === pc.id) || (remover.isPending && remover.variables?.id === pc.id) || abrindo === pc.id;
                return (
                  <div key={pc.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="font-numeric tabular-nums font-medium w-14 shrink-0">{pc.numero}/{processo.parcelasTotal}</span>
                    <span className="font-numeric tabular-nums text-muted-foreground text-xs w-20 shrink-0">{fmtBR(pc.pagoEm)}</span>
                    <span className="font-numeric tabular-nums flex-1">{brl(pc.valor)}</span>
                    {pc.comprovantePath ? (
                      <div className="flex items-center gap-1 min-w-0">
                        <button onClick={() => abrir(pc)} disabled={ocupado} title={pc.comprovanteNome ?? "Ver comprovante"}
                          className="flex items-center gap-1 text-xs text-primary hover:underline max-w-[160px] disabled:opacity-60">
                          {abrindo === pc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" /> : <FileText className="h-3.5 w-3.5 shrink-0" />}
                          <span className="truncate">{pc.comprovanteNome ?? "comprovante"}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </button>
                        <button onClick={() => escolherArquivo(pc)} disabled={ocupado} title="Trocar comprovante" className="h-7 w-7 grid place-items-center rounded-md hover:bg-secondary text-muted-foreground">
                          <Paperclip className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => tirar(pc)} disabled={ocupado} title="Remover comprovante" className="h-7 w-7 grid place-items-center rounded-md hover:bg-destructive/10 text-destructive">
                          {remover.isPending && remover.variables?.id === pc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => escolherArquivo(pc)} disabled={ocupado}>
                        {anexar.isPending && alvoAnexo?.id === pc.id ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Paperclip className="h-3.5 w-3.5 mr-1" />}
                        Anexar comprovante
                      </Button>
                    )}
                  </div>
                );
              })
            )}
          </div>
          {err && <p className="mt-2 text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</p>}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={() => onEditar(processo)}><Pencil className="h-3.5 w-3.5 mr-1.5" />Editar processo</Button>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type FiltroStatus = "abertos" | "encerrados" | "todos";

export function Processos() {
  const { data: processos = [], isLoading, error } = usePagamentosProcessos();
  const del = useDeletePagamentoProcesso();

  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState<FiltroStatus>("abertos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PagamentoProcesso | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PagamentoProcesso | null>(null);
  const [pagarTarget, setPagarTarget] = useState<PagamentoProcesso | null>(null);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  // O detalhe lê do cache pelo id: assim ele acompanha o processo depois de
  // registrar um pagamento (parcela avança, status muda) sem fechar.
  const detalhe = useMemo(() => processos.find((p) => p.id === detalheId) ?? null, [processos, detalheId]);

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (p: PagamentoProcesso) => { setEditing(p); setDialogOpen(true); };
  const confirmDelete = async () => { if (!deleteTarget) return; await del.mutateAsync(deleteTarget.id); setDeleteTarget(null); };

  const copiarPix = async (p: PagamentoProcesso) => {
    if (!p.chavePix) return;
    try {
      await navigator.clipboard.writeText(p.chavePix);
      setCopiado(p.id);
      setTimeout(() => setCopiado((c) => (c === p.id ? null : c)), 1500);
    } catch { /* clipboard indisponível */ }
  };

  // As contas do acordo vivem em lib/processos (puras, com teste): a tela de
  // celular lê as mesmas, e assim os dois resumos não divergem.
  const { abertos, encerrados, valorMes, totalRestante } = useMemo(() => resumoProcessos(processos), [processos]);

  const filtered = useMemo(() => {
    const base = filtro === "abertos" ? abertos : filtro === "encerrados" ? encerrados : processos;
    return filtraProcessos(base, search);
  }, [search, filtro, processos, abertos, encerrados]);

  const FILTROS: { id: FiltroStatus; label: string; n: number }[] = [
    { id: "abertos", label: "Em aberto", n: abertos.length },
    { id: "encerrados", label: "Encerrados", n: encerrados.length },
    { id: "todos", label: "Todos", n: processos.length },
  ];

  return (
    <AppShell
      title="Pagamentos de processos"
      subtitle="Parcelas, registro de pagamento e comprovantes de cada processo"
      actions={
        <Button onClick={openCreate} className="h-9 bg-foreground text-background hover:bg-foreground/90">
          <Plus className="h-4 w-4 mr-1.5" />Novo processo
        </Button>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card className="p-5 card-elevated border-border/70">
          <p className="text-[13px] text-muted-foreground">Processos em aberto</p>
          <p className="font-numeric text-2xl font-semibold tabular-nums mt-1.5">{abertos.length}</p>
          <p className="text-xs text-muted-foreground mt-1">{encerrados.length} encerrado{encerrados.length === 1 ? "" : "s"} · {processos.length} no total</p>
        </Card>
        <Card className="p-5 card-elevated border-border/70">
          <p className="text-[13px] text-muted-foreground">Valor por mês</p>
          <p className="font-numeric text-2xl font-semibold tabular-nums mt-1.5">{brl(valorMes)}</p>
          <p className="text-xs text-muted-foreground mt-1">soma das parcelas em aberto</p>
        </Card>
        <Card className="p-5 card-elevated border-border/70">
          <p className="text-[13px] text-muted-foreground">Total restante</p>
          <p className="font-numeric text-2xl font-semibold tabular-nums mt-1.5 text-destructive">{brl(totalRestante)}</p>
          <p className="text-xs text-muted-foreground mt-1">parcelas que faltam pagar</p>
        </Card>
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Buscar processo ou chave Pix..." className="pl-8 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {/* Filtro por status */}
        <div className="inline-flex rounded-lg border border-border p-0.5 bg-secondary/40">
          {FILTROS.map((f) => (
            <button key={f.id} type="button" onClick={() => setFiltro(f.id)}
              className={`px-3 h-8 rounded-md text-xs font-medium transition-colors ${filtro === f.id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {f.label} <span className="font-numeric tabular-nums opacity-70">{f.n}</span>
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando processos...
        </div>
      )}
      {error && (
        <div className="flex items-center justify-center gap-2 py-20 text-destructive">
          <AlertCircle className="h-5 w-5" /> Erro ao carregar. Rode a migração 31 no Supabase e verifique a conexão.
        </div>
      )}
      {!isLoading && !error && processos.length === 0 && (
        <div className="py-20 text-center text-muted-foreground">
          Nenhum processo cadastrado ainda. Clique em <strong>Novo processo</strong> para começar.
        </div>
      )}
      {!isLoading && !error && processos.length > 0 && filtered.length === 0 && (
        <div className="py-20 text-center text-muted-foreground">
          {search.trim()
            ? <>Nenhum processo encontrado para “{search}”.</>
            : filtro === "encerrados" ? "Nenhum processo encerrado ainda." : "Nenhum processo em aberto."}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((p) => {
          const pagas = parcelasPagas(p);
          const pct = pctPago(p);
          return (
            <Card key={p.id} className={`p-5 border transition-all group relative overflow-hidden ${p.ativo ? "border-border/70" : "bg-secondary/40 border-border"}`}>
              <div className="flex items-start gap-3">
                <div className={`h-9 w-9 rounded-lg grid place-items-center shrink-0 ${p.ativo ? "bg-primary/10" : "bg-success/10"}`}>
                  {p.ativo ? <Scale className="h-4 w-4 text-primary" /> : <CheckCircle2 className="h-4 w-4 text-success" />}
                </div>
                {/* Clicar no nome abre o detalhe (histórico + comprovantes). */}
                <button type="button" onClick={() => setDetalheId(p.id)} className="flex-1 min-w-0 text-left rounded-md -m-1 p-1 hover:bg-secondary/60 transition-colors" title="Abrir histórico e comprovantes">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-display font-semibold tracking-tight truncate">{p.nome}</h3>
                    {!p.ativo && <Badge variant="outline" className="text-[10px] bg-secondary text-muted-foreground border-border">Encerrado</Badge>}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{p.ativo ? `Vence dia ${p.diaPagamento}` : "Todas as parcelas pagas"}</p>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger className="opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 grid place-items-center rounded-md hover:bg-background/60 outline-none">
                    <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setDetalheId(p.id)}><Receipt className="h-3.5 w-3.5 mr-2" /> Histórico e comprovantes</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5 mr-2" /> Editar</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDeleteTarget(p)} className="text-destructive focus:text-destructive">
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-border/40">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Valor</p>
                  <p className="font-numeric text-sm font-semibold tabular-nums mt-0.5">{brl(p.valor)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{p.ativo ? "Próxima parcela" : "Parcelas pagas"}</p>
                  <p className="font-numeric text-sm font-semibold tabular-nums mt-0.5">{p.ativo ? p.parcelaAtual : pagas} / {p.parcelasTotal}</p>
                </div>
              </div>

              <div className="mt-3">
                <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${p.ativo ? "bg-primary" : "bg-success"}`} style={{ width: `${pct}%` }} />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">{pagas} de {p.parcelasTotal} paga{pagas === 1 ? "" : "s"}</p>
              </div>

              {p.ativo && (
                <Button className="mt-4 w-full h-9 bg-success text-white hover:bg-success/90" onClick={() => setPagarTarget(p)}>
                  <CheckCircle2 className="h-4 w-4 mr-1.5" />
                  {p.parcelaAtual >= p.parcelasTotal ? "Pagar última parcela e encerrar" : `Registrar pagamento da ${p.parcelaAtual}ª`}
                </Button>
              )}

              {p.chavePix && (
                <button
                  onClick={() => copiarPix(p)}
                  title="Copiar chave Pix"
                  className="mt-2 w-full flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-left hover:bg-secondary/60 transition-colors"
                >
                  {copiado === p.id ? <Check className="h-3.5 w-3.5 text-success shrink-0" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                  <span className="font-mono truncate flex-1">{p.chavePix}</span>
                  <span className="text-muted-foreground shrink-0">{copiado === p.id ? "copiado" : "Pix"}</span>
                </button>
              )}
            </Card>
          );
        })}
      </div>

      <ProcessoDialog open={dialogOpen} onOpenChange={setDialogOpen} processo={editing} />
      <PagarDialog processo={pagarTarget} onClose={() => setPagarTarget(null)} />
      <DetalheDialog
        processo={detalhe}
        onClose={() => setDetalheId(null)}
        onPagar={(p) => setPagarTarget(p)}
        onEditar={(p) => { setDetalheId(null); openEdit(p); }}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir processo?</AlertDialogTitle>
            <AlertDialogDescription>
              O processo <strong>{deleteTarget?.nome}</strong> será removido, junto com o histórico de pagamentos. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={del.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmDelete(); }} disabled={del.isPending} className="bg-destructive hover:bg-destructive/90">
              {del.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
