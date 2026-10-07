import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Info, AlertTriangle } from "lucide-react";
import { brl, numFromInput } from "@/lib/format";
import { fmtBR, hojeISO } from "@/lib/datas";
import { useAjustarSaldoInicial, type ContaBancaria } from "@/lib/queries";

// Ajuste do saldo inicial — só o master chega aqui (a RPC também recusa
// qualquer outro, então esconder o botão é conveniência, não a guarda).
//
// Duas formas de informar, porque as duas aparecem na vida real: às vezes
// você tem o saldo do extrato na mão, às vezes já sabe de quanto é a
// diferença. O diálogo sempre mostra o resultado antes de gravar.
export function AjusteSaldoDialog({
  open,
  onOpenChange,
  contas,
  contaIdAtiva,
  saldoAtual,
  pendentes,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contas: ContaBancaria[];
  contaIdAtiva: string | null;
  saldoAtual: number;      // o que a tela mostra hoje (só faz sentido com 1 conta)
  pendentes: number;       // lançamentos aguardando revisão na empresa
}) {
  const ajustar = useAjustarSaldoInicial();
  const ativas = useMemo(() => contas.filter((c) => c.ativo), [contas]);

  const [contaId, setContaId] = useState("");
  const [modo, setModo] = useState<"saldo" | "ajuste">("saldo");
  const [saldoBanco, setSaldoBanco] = useState(0);
  const [delta, setDelta] = useState(0);
  const [dataISO, setDataISO] = useState(hojeISO());
  const [motivo, setMotivo] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    ajustar.reset();
    setContaId(contaIdAtiva ?? ativas[0]?.id ?? "");
    setModo("saldo");
    setSaldoBanco(0);
    setDelta(0);
    setDataISO(hojeISO());
    setMotivo("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contaIdAtiva]);

  const conta = ativas.find((c) => c.id === contaId);
  // A prévia da diferença só faz sentido quando a conta escolhida é a mesma
  // que está na tela — no consolidado, `saldoAtual` soma várias.
  const comparavel = !!contaIdAtiva && contaId === contaIdAtiva;
  const diferenca = modo === "saldo" ? saldoBanco - saldoAtual : delta;

  const salvar = async () => {
    if (!contaId) { setErr("Escolha a conta."); return; }
    if (!motivo.trim()) { setErr("Escreva o motivo — ele fica gravado na conta."); return; }
    if (modo === "saldo" && !dataISO) { setErr("Informe a data do saldo do banco."); return; }
    if (modo === "ajuste" && !delta) { setErr("Informe um valor de ajuste diferente de zero."); return; }
    setErr(null);
    try {
      const r = await ajustar.mutateAsync({
        contaId,
        modo,
        valor: modo === "saldo" ? saldoBanco : delta,
        dataISO: modo === "saldo" ? dataISO : null,
        motivo,
      });
      toast.success(
        `Saldo inicial de ${r.conta}: ${brl(r.antes)} → ${brl(r.depois)} (${r.diferenca >= 0 ? "+" : ""}${brl(r.diferenca)}).`
      );
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao ajustar o saldo.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!ajustar.isPending) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>Ajustar o saldo</DialogTitle>
          <DialogDescription>
            Corrige o <strong>saldo inicial</strong> da conta para o saldo do app bater com o do banco.
            Não cria lançamento no extrato — por isso o motivo é obrigatório e fica gravado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Conta</Label>
              <Select value={contaId} onValueChange={setContaId}>
                <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
                <SelectContent>
                  {ativas.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              {conta && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Hoje: {brl(conta.saldoInicial)} desde {fmtBR(conta.saldoInicialData)}
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs">O que você vai informar</Label>
              <div className="inline-flex rounded-lg border border-border/70 p-0.5 w-full">
                {([["saldo", "Saldo do banco"], ["ajuste", "Valor do ajuste"]] as const).map(([m, rotulo]) => (
                  <button key={m} type="button" onClick={() => setModo(m)}
                    className={`flex-1 h-8 rounded-md text-xs font-medium transition-colors ${modo === m ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                    {rotulo}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {modo === "saldo" ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Saldo real do banco (R$)</Label>
                <Input type="number" step="0.01" inputMode="decimal"
                  value={Number.isFinite(saldoBanco) ? saldoBanco : 0}
                  onChange={(e) => setSaldoBanco(numFromInput(e.target.valueAsNumber))} autoFocus />
              </div>
              <div>
                <Label className="text-xs">Nessa data</Label>
                <Input type="date" value={dataISO} onChange={(e) => setDataISO(e.target.value)} />
              </div>
            </div>
          ) : (
            <div>
              <Label className="text-xs">Valor do ajuste (R$)</Label>
              <Input type="number" step="0.01" inputMode="decimal"
                value={Number.isFinite(delta) ? delta : 0}
                onChange={(e) => setDelta(numFromInput(e.target.valueAsNumber))} autoFocus />
              <p className="text-[11px] text-muted-foreground mt-1">
                Negativo abaixa o saldo (ex.: <span className="font-numeric">-747,76</span>), positivo aumenta.
              </p>
            </div>
          )}

          {/* Prévia: sem isto, ajustar saldo é apostar no sinal. */}
          {comparavel && (
            <div className="rounded-lg border border-border/70 bg-secondary/30 px-3 py-2.5 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Saldo na tela hoje</span>
                <span className="font-numeric tabular-nums">{brl(saldoAtual)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ajuste</span>
                <span className={`font-numeric tabular-nums ${diferenca >= 0 ? "text-success" : "text-destructive"}`}>
                  {diferenca >= 0 ? "+" : ""}{brl(diferenca)}
                </span>
              </div>
              <div className="flex justify-between font-semibold border-t border-border/70 pt-1 mt-1">
                <span>Saldo depois</span>
                <span className="font-numeric tabular-nums">{brl(saldoAtual + diferenca)}</span>
              </div>
            </div>
          )}

          {!comparavel && contaId && (
            <p className="text-[12px] text-muted-foreground bg-secondary/50 rounded-md px-3 py-2 flex items-start gap-2">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              Selecione esta conta no topo da tela para ver a prévia do saldo antes e depois.
            </p>
          )}

          {/* As pendentes entram no saldo quando forem aprovadas — ajustar
              agora deixa a conta certa hoje e errada depois. */}
          {pendentes > 0 && (
            <p className="text-[12px] bg-warning/10 text-warning-foreground rounded-md px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                Há <strong>{pendentes}</strong> lançamento{pendentes > 1 ? "s" : ""} aguardando na Revisão. Eles ainda
                não contam no saldo e vão contar quando você aprovar — o saldo vai mudar de novo.
                Vale revisar antes de ajustar.
              </span>
            </p>
          )}

          <div>
            <Label className="text-xs">Motivo</Label>
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
              placeholder="Ex.: diferença de tarifas anteriores ao início do controle" />
          </div>
        </div>

        {err && <p className="text-[13px] font-medium text-destructive bg-destructive/10 rounded-md px-3 py-2">{err}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={ajustar.isPending}>Cancelar</Button>
          <Button onClick={salvar} disabled={ajustar.isPending} className="bg-foreground text-background hover:bg-foreground/90">
            {ajustar.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Ajustar saldo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
