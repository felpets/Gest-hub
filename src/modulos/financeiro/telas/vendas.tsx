import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus, Search, Loader2, AlertCircle, Pencil, Trash2, ShoppingCart, FileSpreadsheet, Info,
} from "lucide-react";
import { brl, numFromInput } from "@/lib/format";
import { fmtBR, hojeISO, pad } from "@/lib/datas";
import { exportToXlsx } from "@/lib/export";
import {
  useVendas, useSaveVenda, useDeleteVenda, useClientes, useCobrancas, useGerarCobrancasDaVenda,
  type Venda, type VendaInput,
} from "@/lib/queries";
import {
  erroParcelamento, parcelasIguais, redimensionar, somaParcelas,
  type ModoParcelamento, type Parcela,
} from "@/lib/parcelamento";

// Formas de pagamento (chave gravada → rótulo).
const FORMAS: { valor: string; label: string }[] = [
  { valor: "pix", label: "Pix" },
  { valor: "dinheiro", label: "Dinheiro" },
  { valor: "credito", label: "Cartão de crédito" },
  { valor: "debito", label: "Cartão de débito" },
  { valor: "boleto", label: "Boleto" },
  { valor: "transferencia", label: "Transferência" },
  { valor: "outro", label: "Outro" },
];
const labelForma = (v: string) => FORMAS.find((f) => f.valor === v)?.label ?? v;

const ymOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const fmtMes = (ym: string) => (ym ? `${MESES_PT[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}` : "todo o período");

const emptyForm = (): VendaInput => ({
  data: hojeISO(), clienteId: null, cliente: "", descricao: "", vendedor: "",
  formaPagamento: "pix", valorBruto: 0, valorLiquido: 0, observacao: "",
});

const MODOS: { valor: ModoParcelamento; label: string; desc: string }[] = [
  { valor: "sem", label: "Não gerar", desc: "A venda fica só como registro (já recebida, ou a cobrança vem por fora)." },
  { valor: "avista", label: "À vista", desc: "Uma cobrança só, na data escolhida." },
  { valor: "iguais", label: "Parcelas iguais", desc: "Divide o valor da venda em N vezes, uma por mês." },
  { valor: "personalizado", label: "Personalizado", desc: "Você define o valor e a data de cada parcela." },
];

// ─── Diálogo de criar/editar venda ──────────────────────────
function VendaDialog({ open, onOpenChange, venda }: { open: boolean; onOpenChange: (v: boolean) => void; venda: Venda | null }) {
  const save = useSaveVenda();
  const gerar = useGerarCobrancasDaVenda();
  const { data: clientes = [] } = useClientes();
  const { data: cobrancas = [] } = useCobrancas();
  const [form, setForm] = useState<VendaInput>(emptyForm());
  const [err, setErr] = useState<string | null>(null);
  // Enquanto o usuário não mexe no líquido, ele acompanha o bruto (venda sem desconto/taxa).
  const [liquidoManual, setLiquidoManual] = useState(false);
  const [modo, setModo] = useState<ModoParcelamento>("sem");
  const [qtd, setQtd] = useState(1);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);

  // Parcelas já geradas desta venda: com alguma PAGA, regerar é bloqueado — o
  // banco mantém a paga, e mexer no resto mudaria o acordo pela metade.
  const daVenda = useMemo(
    () => (venda ? cobrancas.filter((c) => c.vendaId === venda.id) : []),
    [cobrancas, venda],
  );
  const temPaga = daVenda.some((c) => c.status === "pago");

  useEffect(() => {
    if (!open) return;
    setErr(null);
    save.reset();
    gerar.reset();
    if (venda) {
      const { id: _id, criadoEm: _c, ...rest } = venda;
      setForm(rest);
      setLiquidoManual(venda.valorLiquido !== venda.valorBruto);
    } else {
      setForm(emptyForm());
      setLiquidoManual(false);
    }
    setModo("sem");
    setQtd(1);
    setParcelas([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, venda]);

  const setBruto = (v: number) => setForm((f) => ({ ...f, valorBruto: v, valorLiquido: liquidoManual ? f.valorLiquido : v }));
  const setLiquido = (v: number) => { setLiquidoManual(true); setForm((f) => ({ ...f, valorLiquido: v })); };
  const desconto = Math.max(0, form.valorBruto - form.valorLiquido);

  // Ao escolher o modo (ou mudar valor/quantidade), monta a sugestão de parcelas.
  const escolherModo = (m: ModoParcelamento) => {
    setModo(m);
    if (m === "sem") return setParcelas([]);
    const n = m === "avista" ? 1 : Math.max(1, qtd);
    if (m === "avista") setQtd(1);
    setParcelas(parcelasIguais(form.valorBruto, n, form.data));
  };
  const trocarQtd = (n: number) => {
    setQtd(n);
    setParcelas((atual) =>
      modo === "iguais"
        ? parcelasIguais(form.valorBruto, n, atual[0]?.vencimento || form.data)
        : redimensionar(atual, n, form.valorBruto, form.data),
    );
  };
  const editarParcela = (i: number, patch: Partial<Parcela>) =>
    setParcelas((atual) => atual.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  const erroParcelas = modo === "sem" ? null : erroParcelamento(parcelas, form.valorBruto);
  const soma = somaParcelas(parcelas);

  const handleSave = async () => {
    if (!form.data) { setErr("Informe a data da venda."); return; }
    if (!form.clienteId) { setErr("Escolha o cliente do cadastro."); return; }
    if (!(form.valorBruto > 0)) { setErr("Informe a venda bruta (maior que zero)."); return; }
    if (form.valorLiquido < 0) { setErr("A venda líquida não pode ser negativa."); return; }
    if (form.valorLiquido > form.valorBruto) { setErr("A venda líquida não pode ser maior que a bruta."); return; }
    if (modo !== "sem" && erroParcelas) { setErr(erroParcelas); return; }
    setErr(null);
    try {
      const nome = clientes.find((c) => c.id === form.clienteId)?.nome ?? form.cliente;
      const salva = await save.mutateAsync({ id: venda?.id, input: { ...form, cliente: nome } });
      if (modo !== "sem") {
        const alvo = venda?.id ?? salva?.id;
        if (!alvo) throw new Error("A venda foi gravada, mas não consegui ligar as cobranças a ela.");
        await gerar.mutateAsync({ vendaId: alvo, parcelas });
      }
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao salvar a venda.";
      setErr(/vendas/.test(msg) && /not find|does not exist|schema cache/i.test(msg)
        ? "A tabela de vendas ainda não existe: rode supabase/38_vendas.sql no SQL Editor."
        : msg);
    }
  };
  const salvando = save.isPending || gerar.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!save.isPending) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{venda ? "Editar venda" : "Nova venda"}</DialogTitle>
          <DialogDescription>Registro de controle — não entra no saldo das contas bancárias.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <div>
            <Label className="text-xs">Data da venda</Label>
            <Input type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Forma de pagamento</Label>
            <Select value={form.formaPagamento} onValueChange={(v) => setForm({ ...form, formaPagamento: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FORMAS.map((f) => <SelectItem key={f.valor} value={f.valor}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Cliente</Label>
            <Select value={form.clienteId ?? ""} onValueChange={(v) => setForm({ ...form, clienteId: v })}>
              <SelectTrigger><SelectValue placeholder={clientes.length ? "Escolha o cliente" : "Nenhum cliente cadastrado"} /></SelectTrigger>
              <SelectContent>
                {clientes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {clientes.length === 0
                ? "Cadastre o cliente na aba Clientes e cobranças primeiro."
                : venda && !form.clienteId && form.cliente
                  ? `Esta venda é anterior ao cadastro e está no nome de "${form.cliente}". Escolha o cliente para ligar as cobranças.`
                  : "É por aqui que a venda se liga às cobranças e ao Financeiro."}
            </p>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">O que foi vendido</Label>
            <Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              placeholder="Ex.: Desenvolvimento de site" autoFocus />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Vendedor</Label>
            <Input value={form.vendedor} onChange={(e) => setForm({ ...form, vendedor: e.target.value })} placeholder="Quem fez a venda" />
          </div>
          <div>
            <Label className="text-xs">Venda bruta (R$)</Label>
            <Input type="number" min={0} step="0.01" inputMode="decimal"
              value={Number.isFinite(form.valorBruto) ? form.valorBruto : 0}
              onChange={(e) => setBruto(numFromInput(e.target.valueAsNumber))} />
          </div>
          <div>
            <Label className="text-xs">Venda líquida (R$)</Label>
            <Input type="number" min={0} step="0.01" inputMode="decimal"
              value={Number.isFinite(form.valorLiquido) ? form.valorLiquido : 0}
              onChange={(e) => setLiquido(numFromInput(e.target.valueAsNumber))} />
            <p className="text-[11px] text-muted-foreground mt-1">
              {desconto > 0 ? `Descontos/taxas: ${brl(desconto)}` : "Igual à bruta quando não há desconto ou taxa."}
            </p>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Observação (opcional)</Label>
            <Input value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} placeholder="Ex.: pedido nº, condição especial" />
          </div>
        </div>

        {/* ─── Cobranças da venda ─── */}
        <div className="rounded-xl border border-border/70 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Cobranças desta venda</p>
              <p className="text-[11px] text-muted-foreground">
                O que for gerado aqui vira conta a receber e já entra como entrada prevista no caixa.
              </p>
            </div>
            {daVenda.length > 0 && (
              <Badge variant="outline" className="bg-secondary border-0 text-[11px]">
                {daVenda.length} já {daVenda.length === 1 ? "gerada" : "geradas"}
                {temPaga ? " · com parcela paga" : ""}
              </Badge>
            )}
          </div>

          {temPaga ? (
            <p className="rounded-md bg-secondary/60 px-3 py-2 text-[12px] text-muted-foreground">
              Esta venda já tem parcela recebida. Para não desmontar um acordo pela metade, o parcelamento não é
              refeito aqui — ajuste a parcela em aberto na aba Cobranças.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {MODOS.map((m) => (
                  <button
                    key={m.valor}
                    type="button"
                    onClick={() => escolherModo(m.valor)}
                    title={m.desc}
                    className={`h-8 cursor-pointer rounded-md px-2.5 text-xs font-medium transition-colors ${
                      modo === m.valor ? "bg-foreground text-background" : "bg-secondary/60 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">{MODOS.find((m) => m.valor === modo)?.desc}</p>

              {(modo === "iguais" || modo === "personalizado") && (
                <div className="mt-3 flex items-end gap-2">
                  <div>
                    <Label className="text-xs">Quantas parcelas</Label>
                    <Input type="number" min={1} max={60} className="h-9 w-24"
                      value={qtd}
                      onChange={(e) => trocarQtd(Math.max(1, Math.min(60, Math.floor(e.target.valueAsNumber || 1))))} />
                  </div>
                  {modo === "iguais" && (
                    <p className="pb-2 text-[11px] text-muted-foreground">
                      A sobra dos centavos entra na primeira parcela.
                    </p>
                  )}
                </div>
              )}

              {parcelas.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {parcelas.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-10 shrink-0 text-[11px] text-muted-foreground">{i + 1}/{parcelas.length}</span>
                      <Input
                        type="number" min={0} step="0.01" inputMode="decimal" className="h-8"
                        aria-label={`Valor da parcela ${i + 1}`}
                        disabled={modo !== "personalizado"}
                        value={Number.isFinite(p.valor) ? p.valor : 0}
                        onChange={(e) => editarParcela(i, { valor: numFromInput(e.target.valueAsNumber) })}
                      />
                      <Input
                        type="date" className="h-8 w-[150px]"
                        aria-label={`Vencimento da parcela ${i + 1}`}
                        value={p.vencimento}
                        onChange={(e) => editarParcela(i, { vencimento: e.target.value })}
                      />
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-1 text-[12px]">
                    <span className="text-muted-foreground">Soma das parcelas</span>
                    <span className={`font-numeric font-semibold tabular-nums ${erroParcelas ? "text-destructive" : "text-success"}`}>
                      {brl(soma)} de {brl(form.valorBruto)}
                    </span>
                  </div>
                  {erroParcelas && <p className="text-[12px] font-medium text-destructive">{erroParcelas}</p>}
                </div>
              )}
            </>
          )}
        </div>

        {err && <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>Cancelar</Button>
          <Button onClick={handleSave} disabled={salvando} className="bg-foreground text-background hover:bg-foreground/90">
            {salvando && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}{venda ? "Salvar" : "Registrar venda"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Vendas() {
  const { data: vendas = [], isLoading, error } = useVendas();
  const del = useDeleteVenda();

  const [mes, setMes] = useState(() => ymOf(new Date()));
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Venda | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Venda | null>(null);

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (v: Venda) => { setEditing(v); setDialogOpen(true); };
  const confirmDelete = async () => { if (!deleteTarget) return; await del.mutateAsync(deleteTarget.id); setDeleteTarget(null); };

  // Período (mês) primeiro — os KPIs olham o período; a busca refina a tabela.
  const doPeriodo = useMemo(() => (mes ? vendas.filter((v) => v.data.slice(0, 7) === mes) : vendas), [vendas, mes]);
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return doPeriodo;
    return doPeriodo.filter((v) =>
      v.cliente.toLowerCase().includes(s) || v.vendedor.toLowerCase().includes(s) || labelForma(v.formaPagamento).toLowerCase().includes(s)
    );
  }, [doPeriodo, search]);

  const bruto = doPeriodo.reduce((s, v) => s + v.valorBruto, 0);
  const liquido = doPeriodo.reduce((s, v) => s + v.valorLiquido, 0);
  const ticket = doPeriodo.length ? liquido / doPeriodo.length : 0;

  const handleXlsx = () => {
    exportToXlsx({
      filename: `vendas-${mes || "todas"}`,
      sheets: [{
        name: "Vendas",
        columns: ["Data", "Cliente", "Vendedor", "Forma de pagamento", "Venda bruta", "Venda líquida", "Observação"],
        rows: filtered.map((v) => [fmtBR(v.data), v.cliente, v.vendedor, labelForma(v.formaPagamento), v.valorBruto, v.valorLiquido, v.observacao]),
      }],
    });
  };

  const tabelaSemMigracao = !!error && /vendas/.test(error instanceof Error ? error.message : "");

  return (
    <AppShell
      title="Vendas"
      subtitle="Controle de vendas — bruto, líquido, forma de pagamento, cliente e vendedor"
      actions={
        <>
          <Button variant="outline" className="h-9" onClick={handleXlsx} disabled={filtered.length === 0}>
            <FileSpreadsheet className="h-4 w-4 mr-1.5" />Excel
          </Button>
          <Button onClick={openCreate} className="h-9 bg-foreground text-background hover:bg-foreground/90">
            <Plus className="h-4 w-4 mr-1.5" />Nova venda
          </Button>
        </>
      }
    >
      <Card className="p-3 card-elevated border-primary/20 bg-primary/5 mb-5">
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <Info className="h-3.5 w-3.5 text-primary shrink-0" />
          As vendas registradas aqui são só controle: <strong className="text-foreground">não entram no saldo</strong> das contas bancárias nem nas movimentações. O dinheiro continua entrando pelo extrato.
        </p>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-5 card-elevated border-border/70">
          <p className="text-[13px] text-muted-foreground">Vendas em {fmtMes(mes)}</p>
          <p className="font-numeric text-2xl font-semibold tabular-nums mt-1.5">{doPeriodo.length}</p>
        </Card>
        <Card className="p-5 card-elevated border-border/70">
          <p className="text-[13px] text-muted-foreground">Venda bruta</p>
          <p className="font-numeric text-2xl font-semibold tabular-nums mt-1.5">{brl(bruto)}</p>
        </Card>
        <Card className="p-5 card-elevated border-border/70">
          <p className="text-[13px] text-muted-foreground">Venda líquida</p>
          <p className="font-numeric text-2xl font-semibold tabular-nums mt-1.5 text-success">{brl(liquido)}</p>
          {bruto > liquido && <p className="text-[11px] text-muted-foreground mt-1">descontos/taxas: {brl(bruto - liquido)}</p>}
        </Card>
        <Card className="p-5 card-elevated border-border/70">
          <p className="text-[13px] text-muted-foreground">Ticket médio</p>
          <p className="font-numeric text-2xl font-semibold tabular-nums mt-1.5">{brl(ticket)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">líquido por venda</p>
        </Card>
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Mês</Label>
          <Input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="h-9 w-40" />
          {mes ? (
            <button onClick={() => setMes("")} className="text-xs text-muted-foreground hover:text-foreground">ver todo o período</button>
          ) : (
            <button onClick={() => setMes(ymOf(new Date()))} className="text-xs text-muted-foreground hover:text-foreground">voltar ao mês atual</button>
          )}
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Buscar cliente, vendedor ou forma..." className="pl-8 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando vendas...
        </div>
      ) : error ? (
        <Card className="card-elevated border-destructive/30 bg-destructive/5 p-6 text-sm">
          <div className="flex items-start gap-2 text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              {tabelaSemMigracao
                ? <>A tabela de vendas ainda não existe. Rode <strong>supabase/38_vendas.sql</strong> no SQL Editor e recarregue.</>
                : <>Erro ao carregar as vendas. {error instanceof Error ? error.message : ""}</>}
            </div>
          </div>
        </Card>
      ) : (
        <Card className="card-elevated border-border/70 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">Data</th>
                  <th className="text-left px-5 py-3 font-medium">Cliente</th>
                  <th className="text-left px-5 py-3 font-medium">Vendedor</th>
                  <th className="text-left px-5 py-3 font-medium">Forma de pagamento</th>
                  <th className="text-right px-5 py-3 font-medium">Venda bruta</th>
                  <th className="text-right px-5 py-3 font-medium">Venda líquida</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-14 text-center text-muted-foreground">
                      {vendas.length === 0
                        ? <>Nenhuma venda registrada ainda. Clique em <strong>Nova venda</strong> para começar.</>
                        : search.trim() ? <>Nenhuma venda encontrada para “{search}”.</> : <>Nenhuma venda em {fmtMes(mes)}.</>}
                    </td>
                  </tr>
                ) : (
                  filtered.map((v) => (
                    <tr key={v.id} className="hover:bg-secondary/30 group">
                      <td className="px-5 py-3 font-numeric tabular-nums whitespace-nowrap">{fmtBR(v.data)}</td>
                      <td className="px-5 py-3 font-medium">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-md bg-success/10 text-success grid place-items-center shrink-0">
                            <ShoppingCart className="h-3.5 w-3.5" />
                          </div>
                          <span className="truncate max-w-[220px]" title={v.observacao || undefined}>{v.cliente}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{v.vendedor || "—"}</td>
                      <td className="px-5 py-3">
                        <Badge variant="outline" className="bg-secondary border-0 font-medium text-[11px]">{labelForma(v.formaPagamento)}</Badge>
                      </td>
                      <td className="px-5 py-3 text-right font-numeric tabular-nums whitespace-nowrap">{brl(v.valorBruto)}</td>
                      <td className="px-5 py-3 text-right font-numeric font-semibold tabular-nums whitespace-nowrap text-success">{brl(v.valorLiquido)}</td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(v)} title="Editar"
                          className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(v)} title="Excluir"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {filtered.length > 0 && (
                <tfoot className="bg-secondary/30 text-sm font-semibold">
                  <tr>
                    <td className="px-5 py-3" colSpan={4}>{filtered.length} venda{filtered.length === 1 ? "" : "s"}</td>
                    <td className="px-5 py-3 text-right font-numeric tabular-nums">{brl(filtered.reduce((s, v) => s + v.valorBruto, 0))}</td>
                    <td className="px-5 py-3 text-right font-numeric tabular-nums text-success">{brl(filtered.reduce((s, v) => s + v.valorLiquido, 0))}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      )}

      <VendaDialog open={dialogOpen} onOpenChange={setDialogOpen} venda={editing} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir venda?</AlertDialogTitle>
            <AlertDialogDescription>
              A venda de <strong>{deleteTarget?.cliente}</strong> em {deleteTarget && fmtBR(deleteTarget.data)} ({deleteTarget && brl(deleteTarget.valorLiquido)}) será removida. Esta ação não pode ser desfeita.
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
