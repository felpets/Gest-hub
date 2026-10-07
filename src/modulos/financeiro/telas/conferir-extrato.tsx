import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FileSearch, Upload, Loader2, CheckCircle2, AlertTriangle, ArrowRight, Landmark } from "lucide-react";
import { brl } from "@/lib/format";
import { fmtBR } from "@/lib/datas";
import { useContasBancarias } from "@/lib/queries";
import { useEmpresa } from "@/lib/empresa";
// Ler o arquivo e comparar com o app é a MESMA regra no celular.
import type { Lancamento } from "@/lib/conciliacao";
import { useAnaliseExtrato, ACEITA_EXTRATO } from "@/modulos/financeiro/extratos/analise-extrato";

const tipoLabel = (t: "in" | "out") => (t === "in" ? "Entrada" : "Saída");

export function ConferirExtrato() {
  const { data: contas = [] } = useContasBancarias();
  const { contaId: contaAtivaId } = useEmpresa();
  const ativas = contas.filter((c) => c.ativo);
  const [contaId, setContaId] = useState<string>(contaAtivaId ?? ativas[0]?.id ?? "");
  const { inputRef, analise, carregando: loading, erro, analisar, diverge } = useAnaliseExtrato();

  const contaSel = contas.find((c) => c.id === contaId) ?? (ativas.length === 1 ? ativas[0] : null);
  const handleFile = (files?: FileList | null) => analisar(files, contaSel ?? ativas[0] ?? null);

  const r = analise?.resultado;

  return (
    <AppShell
      title="Conferir extrato"
      subtitle="Compare um extrato do banco com o que já está no app — sem importar nada"
    >
      {/* Seleção de conta + arquivo */}
      <Card className="p-5 card-elevated border-border/70 mb-6">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="min-w-[200px]">
            <p className="text-xs text-muted-foreground mb-1.5">Conta</p>
            <Select value={contaId} onValueChange={setContaId}>
              <SelectTrigger className="h-10 w-[220px]"><SelectValue placeholder="Selecione a conta" /></SelectTrigger>
              <SelectContent>
                {ativas.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={ACEITA_EXTRATO}
            className="hidden"
            onChange={(e) => handleFile(e.target.files)}
          />
          <Button
            className="h-10 bg-foreground text-background hover:bg-foreground/90"
            disabled={loading || ativas.length === 0}
            onClick={() => inputRef.current?.click()}
          >
            {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}
            Escolher extrato (OFX/PDF/CSV/Excel)
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-3 flex items-start gap-1.5">
          <FileSearch className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          Confere sem alterar nada: mostra o que <strong>bate</strong>, o que <strong>falta importar</strong>, o que <strong>sobra</strong> (possível duplicata) e valores <strong>divergentes</strong>. Se o extrato trouxer o saldo do banco, compara com o saldo do app.
        </p>
        {ativas.length === 0 && (
          <p className="text-xs text-destructive mt-2">Nenhuma conta bancária ativa. Cadastre uma em Ajustes.</p>
        )}
        {erro && (
          <div className="mt-3 flex items-center gap-2 text-destructive text-sm">
            <AlertTriangle className="h-4 w-4" /> {erro}
          </div>
        )}
      </Card>

      {r && analise && (
        <>
          {/* Comparação de saldo */}
          {analise.banco && (
            <Card className={`p-4 card-elevated mb-6 ${diverge ? "border-warning/40 bg-warning/5" : "border-success/40 bg-success/5"}`}>
              <div className="flex items-center gap-3 flex-wrap text-sm">
                <Landmark className="h-5 w-5 text-primary shrink-0" />
                <span className="text-muted-foreground">
                  Saldo no banco em {fmtBR(analise.banco.data)}: <strong className="text-foreground font-numeric tabular-nums">{brl(analise.banco.saldo)}</strong>
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">
                  Saldo no app: <strong className="text-foreground font-numeric tabular-nums">{brl(analise.appSaldo ?? 0)}</strong>
                </span>
                {diverge ? (
                  <Badge className="border-0 bg-warning/15 text-warning-foreground font-medium">
                    ⚠ diferença de {brl(Math.abs(analise.banco.saldo - (analise.appSaldo ?? 0)))}
                  </Badge>
                ) : (
                  <Badge className="border-0 bg-success/10 text-success font-medium">✓ confere</Badge>
                )}
              </div>
            </Card>
          )}

          {/* Contadores */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="Conferem" valor={r.batem} cor="text-success" />
            <StatCard label="Faltam no app" valor={r.faltam.length} cor={r.faltam.length ? "text-warning-foreground" : "text-muted-foreground"} />
            <StatCard label="Sobram no app" valor={r.sobram.length} cor={r.sobram.length ? "text-destructive" : "text-muted-foreground"} />
            <StatCard label="Valor divergente" valor={r.divergentes.length} cor={r.divergentes.length ? "text-destructive" : "text-muted-foreground"} />
          </div>

          {r.faltam.length === 0 && r.sobram.length === 0 && r.divergentes.length === 0 && (
            <Card className="p-6 card-elevated border-success/40 bg-success/5 mb-6 text-center">
              <CheckCircle2 className="h-6 w-6 text-success mx-auto mb-2" />
              <p className="text-sm font-medium">Tudo certo! O extrato bate 100% com o app ({r.batem} lançamentos).</p>
            </Card>
          )}

          {/* Faltam (no extrato, não no app) */}
          {r.faltam.length > 0 && (
            <SecaoLista
              titulo={`Faltam no app (${r.faltam.length})`}
              descricao="Existem no extrato do banco mas não no app — precisam ser importadas."
              tom="warning"
              itens={r.faltam}
              acao={<Button asChild variant="outline" size="sm" className="h-8"><Link to="/financeiro/extratos" search={{ aba: "importar" }}><Upload className="h-3.5 w-3.5 mr-1.5" />Ir para Importar</Link></Button>}
            />
          )}

          {/* Sobram (no app, não no extrato) */}
          {r.sobram.length > 0 && (
            <SecaoLista
              titulo={`Sobram no app (${r.sobram.length})`}
              descricao="Existem no app mas não neste extrato — possíveis duplicatas ou lançamentos manuais a mais. Confira em Movimentações."
              tom="destructive"
              itens={r.sobram}
            />
          )}

          {/* Divergentes (mesmo FITID, valor diferente) */}
          {r.divergentes.length > 0 && (
            <Card className="card-elevated border-destructive/30 overflow-hidden mb-6">
              <div className="px-5 py-3 border-b border-border">
                <h3 className="font-display text-base font-semibold">Valor divergente ({r.divergentes.length})</h3>
                <p className="text-xs text-muted-foreground">Mesmo lançamento do banco, mas com valor/tipo diferente no app — provavelmente editado à mão.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/40 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="text-left px-5 py-2.5 font-medium">Data</th>
                      <th className="text-left px-5 py-2.5 font-medium">Descrição</th>
                      <th className="text-right px-5 py-2.5 font-medium">No extrato</th>
                      <th className="text-right px-5 py-2.5 font-medium">No app</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {r.divergentes.slice(0, 100).map((d, i) => (
                      <tr key={i}>
                        <td className="px-5 py-2.5 font-numeric tabular-nums">{fmtBR(d.ofx.dataISO)}</td>
                        <td className="px-5 py-2.5 max-w-[280px] truncate">{d.ofx.descricao}</td>
                        <td className="px-5 py-2.5 text-right font-numeric tabular-nums">{d.ofx.tipo === "in" ? "+" : "−"}{brl(d.ofx.valor)}</td>
                        <td className="px-5 py-2.5 text-right font-numeric tabular-nums text-destructive">{d.app.tipo === "in" ? "+" : "−"}{brl(d.app.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </AppShell>
  );
}

function StatCard({ label, valor, cor }: { label: string; valor: number; cor: string }) {
  return (
    <Card className="p-5 card-elevated border-border/70">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className={`font-numeric text-2xl font-semibold tabular-nums mt-1.5 ${cor}`}>{valor}</p>
    </Card>
  );
}

function SecaoLista({
  titulo, descricao, tom, itens, acao,
}: {
  titulo: string; descricao: string; tom: "warning" | "destructive"; itens: Lancamento[]; acao?: React.ReactNode;
}) {
  const border = tom === "warning" ? "border-warning/30" : "border-destructive/30";
  return (
    <Card className={`card-elevated ${border} overflow-hidden mb-6`}>
      <div className="px-5 py-3 border-b border-border flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-semibold">{titulo}</h3>
          <p className="text-xs text-muted-foreground">{descricao}</p>
        </div>
        {acao}
      </div>
      <div className="overflow-x-auto max-h-[360px]">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-xs uppercase tracking-wider text-muted-foreground sticky top-0">
            <tr>
              <th className="text-left px-5 py-2.5 font-medium">Data</th>
              <th className="text-left px-5 py-2.5 font-medium">Tipo</th>
              <th className="text-left px-5 py-2.5 font-medium">Descrição</th>
              <th className="text-right px-5 py-2.5 font-medium">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {itens.slice(0, 200).map((l, i) => (
              <tr key={i}>
                <td className="px-5 py-2.5 font-numeric tabular-nums">{fmtBR(l.dataISO)}</td>
                <td className="px-5 py-2.5 text-muted-foreground">{tipoLabel(l.tipo)}</td>
                <td className="px-5 py-2.5 max-w-[320px] truncate">{l.descricao}</td>
                <td className={`px-5 py-2.5 text-right font-numeric tabular-nums ${l.tipo === "in" ? "text-success" : ""}`}>{l.tipo === "in" ? "+" : "−"}{brl(l.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
