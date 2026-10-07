import { useEffect, useMemo, useRef, useState } from "react";
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
  Plus, Search, MoreHorizontal, Loader2, AlertCircle, Pencil, Trash2,
  CheckCircle2, RotateCcw, Link2, ListChecks, Ban,
} from "lucide-react";
import { brl, numFromInput, clampDia } from "@/lib/format";
import { pad, hojeISO, compAtual, fmtBR as fmtData } from "@/lib/datas";
import {
  useClientes, useSaveCliente, useDeleteCliente, useCobrancas, useSincronizarCobrancas,
  useMarcarCobrancaPaga, useReabrirCobranca, useMensalidades, useSalvarMensalidade,
  useEncerrarMensalidade, useReativarMensalidade,
  type Cliente, type ClienteInput, type Cobranca, type Mensalidade,
} from "@/lib/queries";
import {
  cobrancasDaMensalidade, mensalidadesDoCliente, situacaoMensalidade, statusDoCliente,
  type SituacaoMensalidade, type StatusCliente,
} from "@/lib/mensalidades";

import { useSincronizacaoCobrancas } from "@/modulos/financeiro/receitas/dados-clientes";

const fmtMesAno = (iso: string) => { const [y, m] = iso.split("-"); return `${m}/${y}`; };
const diasEntre = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// Lista de competências (YYYY-MM-01) dos últimos n meses, mais antigo primeiro.
function mesesRecentes(n: number): string[] {
  const d = new Date();
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const dd = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${dd.getFullYear()}-${pad(dd.getMonth() + 1)}-01`);
  }
  return out;
}

const statusStyle: Record<StatusCliente, { card: string; badge: string; accent: string }> = {
  Pago: { card: "bg-success/5 border-success/30 hover:bg-success/10", badge: "bg-success/15 text-success border-success/30", accent: "bg-success" },
  Pendente: { card: "bg-warning/5 border-warning/40 hover:bg-warning/10", badge: "bg-warning/20 text-warning-foreground border-warning/40", accent: "bg-warning" },
  Atrasado: { card: "bg-destructive/5 border-destructive/30 hover:bg-destructive/10", badge: "bg-destructive/15 text-destructive border-destructive/30", accent: "bg-destructive" },
  Inativo: { card: "bg-secondary/40 border-border hover:bg-secondary/60", badge: "bg-secondary text-muted-foreground border-border", accent: "bg-muted-foreground" },
};

const emptyForm: ClienteInput = { nome: "", mens: 0, ticket: 0, ativo: true, diaVencimento: 5, clienteDesde: "", chaveOfx: "" };

// ─── Diálogo de criar/editar cliente ────────────────────────
function ClienteDialog({ open, onOpenChange, cliente, porTabela }: {
  open: boolean; onOpenChange: (v: boolean) => void; cliente: Cliente | null; porTabela: boolean;
}) {
  // Com as mensalidades em tabela própria, editar o cliente não mexe em valor
  // nem dia — isso é de cada mensalidade, no cartão. No cadastro novo o valor
  // digitado vira a primeira mensalidade.
  const mensalidadeNoForm = !cliente || !porTabela;
  const save = useSaveCliente();
  const [form, setForm] = useState<ClienteInput>(emptyForm);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setForm(
      cliente
        ? {
            nome: cliente.nome, mens: cliente.mens, ticket: cliente.ticket, ativo: cliente.ativo,
            diaVencimento: cliente.diaVencimento,
            clienteDesde: (cliente.clienteDesde ?? cliente.criadoEm ?? "").slice(0, 7),
            chaveOfx: cliente.chaveOfx,
          }
        : { ...emptyForm, clienteDesde: compAtual().slice(0, 7) }
    );
  }, [open, cliente]);

  const handleSave = async () => {
    if (!form.nome.trim()) { setErr("Informe o nome do cliente."); return; }
    if (mensalidadeNoForm && form.ativo && !(form.mens > 0)) { setErr("Cliente ativo precisa de mensalidade maior que zero (ou marque como inativo)."); return; }
    setErr(null);
    try {
      await save.mutateAsync({ id: cliente?.id, input: { ...form, nome: form.nome.trim() }, porTabela });
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao salvar o cliente.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{cliente ? "Editar cliente" : "Novo cliente"}</DialogTitle>
          <DialogDescription>Mensalidade, vencimento e como identificar o pagamento no extrato.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="col-span-2">
            <Label className="text-xs">Nome</Label>
            <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex: V4 Company" autoFocus />
          </div>
          {mensalidadeNoForm ? (
            <>
              <div>
                <Label className="text-xs">{porTabela ? "Primeira mensalidade (R$)" : "Mensalidade (R$)"}</Label>
                <Input type="number" min={0} step="0.01" inputMode="decimal"
                  value={Number.isFinite(form.mens) ? form.mens : 0}
                  onChange={(e) => setForm({ ...form, mens: numFromInput(e.target.valueAsNumber) })} />
              </div>
              <div>
                <Label className="text-xs">Ticket médio (R$)</Label>
                <Input type="number" min={0} step="0.01" inputMode="decimal"
                  value={Number.isFinite(form.ticket) ? form.ticket : 0}
                  onChange={(e) => setForm({ ...form, ticket: numFromInput(e.target.valueAsNumber) })} />
              </div>
              <div>
                <Label className="text-xs">Dia de vencimento (1–28)</Label>
                <Input type="number" min={1} max={28} step={1}
                  value={form.diaVencimento}
                  onChange={(e) => setForm({ ...form, diaVencimento: clampDia(e.target.valueAsNumber) })} />
              </div>
            </>
          ) : (
            <>
              <p className="col-span-2 rounded-md bg-secondary/60 px-3 py-2 text-[12px] text-muted-foreground">
                Valor e vencimento ficam em cada mensalidade: use <strong className="text-foreground">Adicionar</strong> ou o lápis ao lado dela, no cartão do cliente.
              </p>
              <div>
                <Label className="text-xs">Ticket médio (R$)</Label>
                <Input type="number" min={0} step="0.01" inputMode="decimal"
                  value={Number.isFinite(form.ticket) ? form.ticket : 0}
                  onChange={(e) => setForm({ ...form, ticket: numFromInput(e.target.valueAsNumber) })} />
              </div>
            </>
          )}
          <div>
            <Label className="text-xs">Cliente desde</Label>
            <Input type="month" value={form.clienteDesde} onChange={(e) => setForm({ ...form, clienteDesde: e.target.value })} />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Chave no extrato (opcional)</Label>
            <Input value={form.chaveOfx} onChange={(e) => setForm({ ...form, chaveOfx: e.target.value })}
              placeholder="Deixe vazio para usar o nome (ex.: V4 COMPANY, BARTE)" className="font-mono text-xs" />
            <p className="text-[11px] text-muted-foreground mt-1">
              Palavra que aparece na entrada do OFX para reconhecer o pagamento (nome + valor).
            </p>
          </div>
          <div className="col-span-2 flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div>
              <Label className="text-xs">Cliente ativo</Label>
              <p className="text-[11px] text-muted-foreground">Inativo não gera novas cobranças.</p>
            </div>
            <Switch checked={form.ativo} onCheckedChange={(v) => setForm({ ...form, ativo: v })} />
          </div>
        </div>

        {err && <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancelar</Button>
          <Button onClick={handleSave} disabled={save.isPending} className="bg-foreground text-background hover:bg-foreground/90">
            {save.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}{cliente ? "Salvar" : "Cadastrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Diálogo de adicionar/editar uma mensalidade ────────────
type AlvoMensalidade = { cliente: Cliente; mensalidade: Mensalidade | null };

function MensalidadeDialog({ alvo, onClose }: { alvo: AlvoMensalidade | null; onClose: () => void }) {
  const salvar = useSalvarMensalidade();
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState(0);
  const [dia, setDia] = useState(5);
  const [inicio, setInicio] = useState(compAtual().slice(0, 7));
  const [err, setErr] = useState<string | null>(null);
  const editando = alvo?.mensalidade ?? null;

  useEffect(() => {
    if (!alvo) return;
    setErr(null);
    const m = alvo.mensalidade;
    setDescricao(m?.descricao ?? "");
    setValor(m?.valor ?? 0);
    setDia(m?.diaVencimento ?? alvo.cliente.diaVencimento ?? 5);
    // Mensalidade nova começa no mês corrente: não gera meses atrasados para trás.
    setInicio((m?.inicio ?? compAtual()).slice(0, 7));
  }, [alvo]);

  const handleSave = async () => {
    if (!alvo) return;
    if (!descricao.trim()) { setErr("Dê um nome para a mensalidade (ex.: Suporte técnico)."); return; }
    if (!(valor > 0)) { setErr("Informe um valor maior que zero."); return; }
    setErr(null);
    try {
      await salvar.mutateAsync({
        id: editando?.id,
        input: { clienteId: alvo.cliente.id, descricao, valor, diaVencimento: dia, inicio },
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao salvar a mensalidade.");
    }
  };

  return (
    <Dialog open={!!alvo} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar mensalidade" : "Nova mensalidade"} · {alvo?.cliente.nome}</DialogTitle>
          <DialogDescription>
            Cada mensalidade gera a sua cobrança todo mês, com valor e vencimento próprios.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="col-span-2">
            <Label className="text-xs">O que é cobrado</Label>
            <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Suporte técnico" autoFocus />
          </div>
          <div>
            <Label className="text-xs">Valor por mês (R$)</Label>
            <Input type="number" min={0} step="0.01" inputMode="decimal" value={Number.isFinite(valor) ? valor : 0}
              onChange={(e) => setValor(numFromInput(e.target.valueAsNumber))} />
          </div>
          <div>
            <Label className="text-xs">Dia de vencimento (1–28)</Label>
            <Input type="number" min={1} max={28} step={1} value={dia}
              onChange={(e) => setDia(clampDia(e.target.valueAsNumber))} />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Cobrar a partir de</Label>
            <Input type="month" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            {editando && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Mudar valor ou dia refaz as cobranças em aberto deste mês em diante. As já pagas não mudam.
              </p>
            )}
          </div>
        </div>
        {err && <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>Cancelar</Button>
          <Button onClick={handleSave} disabled={salvar.isPending} className="bg-foreground text-background hover:bg-foreground/90">
            {salvar.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}{editando ? "Salvar" : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Diálogo de cobranças do cliente ────────────────────────
function CobrancasDialog({ cliente, cobrancas, mensalidades, onClose }: {
  cliente: Cliente | null; cobrancas: Cobranca[]; mensalidades: Mensalidade[]; onClose: () => void;
}) {
  const marcar = useMarcarCobrancaPaga();
  const reabrir = useReabrirCobranca();
  const hoje = hojeISO();
  const lista = useMemo(
    () => (cliente ? cobrancas.filter((c) => c.clienteId === cliente.id).sort((a, b) => b.competencia.localeCompare(a.competencia)) : []),
    [cliente, cobrancas]
  );

  return (
    <Dialog open={!!cliente} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Cobranças · {cliente?.nome}</DialogTitle>
          <DialogDescription>
            {mensalidades.filter((m) => m.ativo).map((m) => `${m.descricao} ${brl(m.valor)} (dia ${m.diaVencimento})`).join(" · ") || "Sem mensalidade ativa"}.
            {" "}Marcadas como pagas automaticamente quando a entrada bate no extrato (nome + valor).
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[420px] overflow-y-auto -mx-1 px-1">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left py-2">Mês</th>
                <th className="text-left py-2">Referente a</th>
                <th className="text-left py-2">Vencimento</th>
                <th className="text-right py-2">Valor</th>
                <th className="text-left py-2 pl-3">Status</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lista.map((c) => {
                const atrasada = c.status === "aberto" && c.vencimento < hoje;
                return (
                  <tr key={c.id} className="hover:bg-secondary/30">
                    <td className="py-2 font-medium">{fmtMesAno(c.competencia)}</td>
                    <td className="py-2 text-muted-foreground">
                      {c.vendaId ? `Venda ${c.parcela ?? 1}/${c.parcelasTotal ?? 1}` : c.descricao || "Mensalidade"}
                    </td>
                    <td className="py-2 text-muted-foreground tabular-nums">{fmtData(c.vencimento)}</td>
                    <td className="py-2 text-right font-numeric tabular-nums">{brl(c.valor)}</td>
                    <td className="py-2 pl-3">
                      {c.status === "pago" ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-success">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          pago {c.pagoEm ? fmtData(c.pagoEm) : ""}
                          {c.movimentacaoId && <Badge variant="outline" className="ml-1 text-[9px] border-success/30 text-success gap-0.5"><Link2 className="h-2.5 w-2.5" />OFX</Badge>}
                        </span>
                      ) : atrasada ? (
                        <span className="text-xs text-destructive font-medium">atrasada {diasEntre(c.vencimento, hoje)}d</span>
                      ) : (
                        <span className="text-xs text-warning-foreground">a cobrar</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {c.status === "pago" ? (
                        <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={reabrir.isPending}
                          onClick={() => reabrir.mutate(c.id)} title="Reabrir">
                          <RotateCcw className="h-3.5 w-3.5 mr-1" />Reabrir
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={marcar.isPending}
                          onClick={() => marcar.mutate({ id: c.id, valor: c.valor, pagoEm: hoje })} title="Marcar como pago manualmente">
                          Marcar pago
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {lista.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-muted-foreground text-xs">Sem cobranças ainda. Elas são geradas ao abrir a tela (cliente ativo com mensalidade).</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Clientes() {
  const { data: clientes = [], isLoading, error } = useClientes();
  const { data: cobrancas = [] } = useCobrancas();
  const { data: mensData } = useMensalidades();
  const porTabela = mensData?.disponivel ?? false;
  const todasMensalidades = useMemo(() => mensData?.itens ?? [], [mensData]);
  const encerrar = useEncerrarMensalidade();
  const reativar = useReativarMensalidade();
  const [alvoMensalidade, setAlvoMensalidade] = useState<AlvoMensalidade | null>(null);
  const [encerrarAlvo, setEncerrarAlvo] = useState<{ cliente: Cliente; mensalidade: Mensalidade } | null>(null);
  const del = useDeleteCliente();
  // Gerar as cobranças do mês ao abrir a área é do MÓDULO: a tela de celular
  // abre a mesma lista e precisa do mesmo preparo.
  const sync = useSincronizacaoCobrancas();

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Cliente | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Cliente | null>(null);
  const [detalhe, setDetalhe] = useState<Cliente | null>(null);

  const hoje = hojeISO();
  const compAtualStr = compAtual();
  const meses12 = useMemo(() => mesesRecentes(12), []);

  // Por cliente: cada mensalidade com a sua situação (atraso próprio) e, por
  // mês, as cobranças de mensalidade — a faixa de 12 meses pinta o pior caso.
  const porCliente = useMemo(() => {
    const out = new Map<string, {
      itens: { m: Mensalidade; s: SituacaoMensalidade }[];
      porMes: Map<string, Cobranca[]>;
    }>();
    for (const c of clientes) {
      const lista = mensalidadesDoCliente(c, porTabela, todasMensalidades);
      const itens = lista.map((m, i) => ({
        m,
        s: situacaoMensalidade(cobrancasDaMensalidade(m, i === 0, cobrancas), hoje, compAtualStr),
      }));
      const porMes = new Map<string, Cobranca[]>();
      for (const cb of cobrancas) {
        if (cb.clienteId !== c.id || cb.vendaId != null || cb.status === "cancelado") continue;
        porMes.set(cb.competencia, [...(porMes.get(cb.competencia) ?? []), cb]);
      }
      out.set(c.id, { itens, porMes });
    }
    return out;
  }, [clientes, porTabela, todasMensalidades, cobrancas, hoje, compAtualStr]);

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (c: Cliente) => { setEditing(c); setDialogOpen(true); };
  const confirmDelete = async () => { if (!deleteTarget) return; await del.mutateAsync(deleteTarget.id); setDeleteTarget(null); };

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return clientes;
    return clientes.filter((c) => c.nome.toLowerCase().includes(s));
  }, [search, clientes]);

  // KPIs do mês (das cobranças).
  const recebidoMes = cobrancas.filter((c) => c.competencia === compAtualStr && c.status === "pago").reduce((s, c) => s + (c.pagoValor ?? c.valor), 0);
  const aReceberMes = cobrancas.filter((c) => c.competencia === compAtualStr && c.status === "aberto").reduce((s, c) => s + c.valor, 0);
  const atrasadoTotal = cobrancas.filter((c) => c.status === "aberto" && c.vencimento < hoje).reduce((s, c) => s + c.valor, 0);
  const qtdAtrasadas = cobrancas.filter((c) => c.status === "aberto" && c.vencimento < hoje).length;
  const clientesAtivos = clientes.filter((c) => c.ativo).length;

  return (
    <AppShell
      title="Clientes"
      subtitle="Mensalidades por cliente · pagamento conferido pelo extrato (OFX)"
      actions={
        <Button onClick={openCreate} className="h-9 bg-foreground text-background hover:bg-foreground/90">
          <Plus className="h-4 w-4 mr-1.5" />Novo cliente
        </Button>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <Card className="p-5 card-elevated border-border/70">
          <p className="text-[13px] text-muted-foreground">Clientes ativos</p>
          <p className="font-numeric text-2xl font-semibold tabular-nums mt-1.5">{clientesAtivos}</p>
          <p className="text-xs text-muted-foreground mt-1">{clientes.length} no total</p>
        </Card>
        <Card className="p-5 card-elevated border-border/70">
          <p className="text-[13px] text-muted-foreground">Recebido no mês</p>
          <p className="font-numeric text-2xl font-semibold tabular-nums mt-1.5 text-success">{brl(recebidoMes)}</p>
          <p className="text-xs text-muted-foreground mt-1">conciliado pelo extrato</p>
        </Card>
        <Card className="p-5 card-elevated border-border/70">
          <p className="text-[13px] text-muted-foreground">A receber no mês</p>
          <p className="font-numeric text-2xl font-semibold tabular-nums mt-1.5 text-warning-foreground">{brl(aReceberMes)}</p>
          <p className="text-xs text-muted-foreground mt-1">cobranças em aberto</p>
        </Card>
        <Card className="p-5 card-elevated border-border/70">
          <p className="text-[13px] text-muted-foreground">Atrasado</p>
          <p className="font-numeric text-2xl font-semibold tabular-nums mt-1.5 text-destructive">{brl(atrasadoTotal)}</p>
          <p className="text-xs text-muted-foreground mt-1">{qtdAtrasadas} {qtdAtrasadas === 1 ? "cobrança vencida" : "cobranças vencidas"}</p>
        </Card>
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Buscar cliente..." className="pl-8 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {sync.isPending && <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />conciliando…</span>}
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" />Pago</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-warning" />A cobrar</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-destructive" />Atrasado</span>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando clientes...
        </div>
      )}
      {error && (
        <div className="flex items-center justify-center gap-2 py-20 text-destructive">
          <AlertCircle className="h-5 w-5" /> Erro ao carregar clientes. Verifique a conexão com o Supabase.
        </div>
      )}
      {!isLoading && !error && clientes.length === 0 && (
        <div className="py-20 text-center text-muted-foreground">
          Nenhum cliente cadastrado ainda. Clique em <strong>Novo cliente</strong> para começar.
        </div>
      )}
      {!isLoading && !error && clientes.length > 0 && filtered.length === 0 && (
        <div className="py-20 text-center text-muted-foreground">Nenhum cliente encontrado para “{search}”.</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((c) => {
          const dados = porCliente.get(c.id);
          const itens = dados?.itens ?? [];
          // Mensalidade encerrada só continua no cartão se ainda deve algo.
          const visiveis = itens.filter(({ m, s }) => m.ativo || s.emAtraso > 0);
          const encerradas = itens.length - visiveis.length;
          const ativas = itens.filter(({ m }) => m.ativo);
          const st = statusDoCliente(c.ativo, itens.filter(({ m, s }) => m.ativo || s.emAtraso > 0).map(({ s }) => s));
          const style = statusStyle[st];
          const desde = (c.clienteDesde ?? c.criadoEm ?? "").slice(0, 7);
          return (
            <Card key={c.id} className={`p-5 border transition-all group relative overflow-hidden ${style.card}`}>
              <span className={`absolute left-0 top-0 bottom-0 w-1 ${style.accent}`} />
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-display font-semibold tracking-tight truncate">{c.nome}</h3>
                    <Badge variant="outline" className={`border text-[10px] ${style.badge}`}>{st}</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{desde ? `Cliente desde ${fmtMesAno(desde)}` : "—"}</p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger className="opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 grid place-items-center rounded-md hover:bg-background/60 outline-none">
                    <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setDetalhe(c)}><ListChecks className="h-3.5 w-3.5 mr-2" /> Cobranças</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openEdit(c)}><Pencil className="h-3.5 w-3.5 mr-2" /> Editar</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDeleteTarget(c)} className="text-destructive focus:text-destructive">
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Mensalidades: cada uma com vencimento e atraso próprios */}
              <div className="mt-4 pt-4 border-t border-border/40" data-mensalidades={c.id}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {ativas.length > 1 ? `Mensalidades · ${brl(ativas.reduce((s, { m }) => s + m.valor, 0))}/mês` : "Mensalidade"}
                  </p>
                  <button
                    onClick={() => porTabela && setAlvoMensalidade({ cliente: c, mensalidade: null })}
                    disabled={!porTabela}
                    title={porTabela ? "Adicionar outra mensalidade a este cliente" : "Disponível depois que o banco receber a atualização 52 (mensalidades por cliente)"}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus className="h-3 w-3" /> Adicionar
                  </button>
                </div>
                {visiveis.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground">Nenhuma mensalidade ativa.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {visiveis.map(({ m, s }) => (
                      <li key={m.id} className={`group/m rounded-lg border border-border/50 bg-background/60 px-3 py-2 ${m.ativo ? "" : "opacity-70"}`}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="min-w-0 truncate text-[13px] font-medium">
                            {m.descricao}{!m.ativo && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">(encerrada)</span>}
                          </span>
                          <span className="whitespace-nowrap font-numeric text-[13px] font-semibold tabular-nums">{brl(m.valor)}</span>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between gap-2 text-[11.5px]">
                          <span className="text-muted-foreground">vence dia {m.diaVencimento}</span>
                          <span className="flex items-center gap-1.5">
                            {s.atrasoDias > 0 ? (
                              <span className="font-medium text-destructive" title={`${s.emAtraso} ${s.emAtraso === 1 ? "cobrança vencida" : "cobranças vencidas"} · ${brl(s.valorEmAtraso)}`}>
                                {s.atrasoDias}d de atraso{s.emAtraso > 1 ? ` · ${s.emAtraso} meses` : ""}
                              </span>
                            ) : (
                              <span className="text-success">em dia</span>
                            )}
                            {porTabela && (
                              <span className="flex items-center opacity-50 transition-opacity group-hover/m:opacity-100 focus-within:opacity-100">
                                <button onClick={() => setAlvoMensalidade({ cliente: c, mensalidade: m })} title="Editar mensalidade"
                                  className="grid h-5 w-5 place-items-center rounded hover:bg-secondary">
                                  <Pencil className="h-3 w-3 text-muted-foreground" />
                                </button>
                                {m.ativo ? (
                                  <button onClick={() => setEncerrarAlvo({ cliente: c, mensalidade: m })} title="Encerrar mensalidade"
                                    className="grid h-5 w-5 place-items-center rounded hover:bg-secondary">
                                    <Ban className="h-3 w-3 text-muted-foreground" />
                                  </button>
                                ) : (
                                  <button onClick={() => reativar.mutate(m.id)} title="Voltar a cobrar"
                                    className="grid h-5 w-5 place-items-center rounded hover:bg-secondary">
                                    <RotateCcw className="h-3 w-3 text-muted-foreground" />
                                  </button>
                                )}
                              </span>
                            )}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {encerradas > 0 && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {encerradas} {encerradas === 1 ? "mensalidade encerrada" : "mensalidades encerradas"}, sem pendência
                  </p>
                )}
              </div>

              <div className="mt-4 flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground mr-1">12m:</span>
                {meses12.map((comp) => {
                  const doMes = dados?.porMes.get(comp) ?? [];
                  const pago = doMes.length > 0 && doMes.every((cb) => cb.status === "pago");
                  const atrasado = doMes.some((cb) => cb.status === "aberto" && cb.vencimento < hoje);
                  const cor = doMes.length === 0 ? "bg-border" : pago ? "bg-success/70" : atrasado ? "bg-destructive/60" : "bg-warning/60";
                  const rotulo = doMes.length === 0 ? "—" : pago ? "pago" : atrasado ? "atrasado" : "a cobrar";
                  return <span key={comp} title={`${fmtMesAno(comp)}: ${rotulo}`} className={`h-1.5 flex-1 rounded-full ${cor}`} />;
                })}
              </div>

              <button onClick={() => setDetalhe(c)} className="mt-3 text-[11px] text-primary font-medium inline-flex items-center gap-1 hover:underline">
                <ListChecks className="h-3 w-3" /> Ver cobranças
              </button>
            </Card>
          );
        })}
      </div>

      <ClienteDialog open={dialogOpen} onOpenChange={setDialogOpen} cliente={editing} porTabela={porTabela} />
      <CobrancasDialog cliente={detalhe} cobrancas={cobrancas} onClose={() => setDetalhe(null)}
        mensalidades={detalhe ? (porCliente.get(detalhe.id)?.itens ?? []).map(({ m }) => m) : []} />
      <MensalidadeDialog alvo={alvoMensalidade} onClose={() => setAlvoMensalidade(null)} />

      <AlertDialog open={!!encerrarAlvo} onOpenChange={(v) => !v && setEncerrarAlvo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar “{encerrarAlvo?.mensalidade.descricao}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {encerrarAlvo?.cliente.nome} deixa de ser cobrado por ela a partir do mês que vem. A cobrança deste mês e o
              histórico continuam; o que estiver atrasado segue aparecendo até ser recebido. Dá para voltar a cobrar depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={encerrar.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={encerrar.isPending}
              onClick={async (e) => { e.preventDefault(); if (!encerrarAlvo) return; await encerrar.mutateAsync(encerrarAlvo.mensalidade.id); setEncerrarAlvo(null); }}>
              {encerrar.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Encerrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              O cliente <strong>{deleteTarget?.nome}</strong> e todas as suas cobranças serão removidos. Esta ação não pode ser desfeita.
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
