// ─── Novo Pix / Editar, no celular ──────────────────────────────────────────
// Tela 03 do desenho: um campo embaixo do outro, tipo de chave em pastilhas (em
// vez da lista suspensa do computador) e as ações presas embaixo.
//
// A lógica NÃO mora aqui: estado, validação, leitura do QR e do Pix copia e cola
// vêm de modulos/financeiro/pix-formulario.ts, o mesmo miolo do diálogo de
// computador. Esta é só a forma.
//
// Como o detalhe, esta tela vive no endereço (?form=novo ou ?form=<id>): é o que
// faz o "voltar" do aparelho fechar o formulário em vez de sair da tela.
import { useState } from "react";
import { X, QrCode, Loader2, Calendar, Building2, AlertCircle, ClipboardPaste } from "lucide-react";
import { useEmpresa } from "@/lib/empresa";
import { numFromInput } from "@/lib/format";
import { brl } from "@/lib/format";
import { TIPOS_CHAVE, type TipoChavePix } from "@/lib/pix";
import { type PagamentoDiario } from "@/lib/queries";
import { useCampoChavePix, useFormularioPagamento } from "@/modulos/financeiro/pix-formulario";

export function FormularioPixCelular({
  pagamento,
  dataPadrao,
  fechar,
}: {
  pagamento: PagamentoDiario | null;
  dataPadrao: string;
  fechar: () => void;
}) {
  const { empresas, empresaId } = useEmpresa();
  const empresa = empresas.find((e) => e.id === empresaId)?.nome ?? "";

  const { form, setForm, erro, qrLido, aplicarPix, limparQr, salvar, salvando } =
    useFormularioPagamento({
      aberto: true,
      pagamento,
      dataPadrao,
      aoSalvar: fechar,
    });

  const campo = useCampoChavePix({
    chave: form.chavePix,
    tipo: form.tipoChave,
    onChange: (chavePix, tipoChave) => {
      limparQr();
      setForm((f) => ({ ...f, chavePix, tipoChave }));
    },
    onPixLido: aplicarPix,
  });

  const [colando, setColando] = useState(false);
  const colar = async () => {
    setColando(true);
    try {
      const texto = await navigator.clipboard.readText();
      if (texto.trim()) campo.receberTexto(texto.trim());
    } catch {
      // Sem permissão de leitura da área de transferência: quem cola é a pessoa,
      // no campo mesmo. Não vale gritar um erro por isso.
    } finally {
      setColando(false);
    }
  };

  const copiaECola = form.tipoChave === "copia_cola";
  const valorInvalido = erro !== null && !(form.valor > 0);

  return (
    <div className="app-celular fixed inset-0 z-40 flex flex-col bg-background">
      <header className="flex h-[68px] shrink-0 items-center gap-1 border-b border-border/70 px-3">
        <button
          type="button"
          onClick={fechar}
          aria-label="Fechar"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-secondary"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-bold leading-tight">
            {pagamento ? "Editar Pix" : "Novo Pix"}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {pagamento ? "Só enquanto está em aberto" : "Cadastre um pagamento"}
          </p>
        </div>
        <label className="inline-flex shrink-0 cursor-pointer items-center gap-1 px-1 text-[12.5px] font-bold text-primary">
          {campo.lendoQr ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <QrCode className="h-4 w-4" />
          )}
          Ler QR
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={campo.lendoQr}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void campo.lerImagem(f);
            }}
          />
        </label>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pt-4">
        {/* ── Data ── */}
        <Campo rotulo="Data de competência">
          <div className="relative flex items-center">
            <input
              type="date"
              value={form.data}
              onChange={(e) => setForm({ ...form, data: e.target.value })}
              className="min-h-11 w-full rounded-[10px] border border-border bg-card px-3 text-[13px] outline-none focus:border-primary"
            />
            <Calendar className="pointer-events-none absolute right-3 h-4 w-4 text-muted-foreground" />
          </div>
        </Campo>

        {/* ── Titular ── */}
        <Campo rotulo="Titular recebedor">
          <input
            value={form.titular}
            onChange={(e) => setForm({ ...form, titular: e.target.value })}
            placeholder="Nome de quem recebe"
            className="min-h-11 w-full rounded-[10px] border border-border bg-card px-3 text-[13px] outline-none focus:border-primary"
          />
        </Campo>

        {/* ── Tipo da chave ── */}
        <Campo rotulo="Tipo de chave">
          <div className="flex flex-wrap gap-1.5">
            {TIPOS_CHAVE.map((t) => {
              const ativo = form.tipoChave === t.valor;
              return (
                <button
                  key={t.valor}
                  type="button"
                  onClick={() => campo.escolherTipo(t.valor as TipoChavePix)}
                  className={`min-h-[34px] rounded-[9px] border px-2.5 text-[12px] font-semibold transition-colors ${
                    ativo
                      ? "border-primary/60 bg-[var(--primary-soft)] text-foreground"
                      : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </Campo>

        {/* ── Chave ── */}
        <Campo rotulo={copiaECola ? "Código Pix Copia e Cola" : "Chave Pix do recebedor"}>
          <div className="relative flex items-center">
            <input
              value={form.chavePix}
              onChange={(e) => campo.receberTexto(e.target.value)}
              onPaste={(e) => {
                const img = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
                if (img) {
                  e.preventDefault();
                  void campo.lerImagem(img);
                }
              }}
              placeholder={copiaECola ? "00020101..." : "CPF, CNPJ, e-mail, telefone ou aleatória"}
              className={`min-h-11 w-full rounded-[10px] border bg-card py-2 pl-3 pr-16 text-[13px] outline-none focus:border-primary ${
                campo.erro || campo.erroQr ? "border-destructive" : "border-border"
              }`}
            />
            <button
              type="button"
              onClick={colar}
              disabled={colando}
              className="absolute right-3 inline-flex items-center gap-1 text-[12px] font-bold text-primary"
            >
              <ClipboardPaste className="h-3.5 w-3.5" /> Colar
            </button>
          </div>
          {campo.erroQr ? (
            <p className="mt-1.5 text-[11.5px] text-destructive">{campo.erroQr}</p>
          ) : campo.erro ? (
            <p className="mt-1.5 text-[11.5px] text-destructive">{campo.erro}</p>
          ) : campo.previa ? (
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">
              Vai ser gravada como{" "}
              <strong className="break-all text-foreground">{campo.previa}</strong>.
            </p>
          ) : (
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">
              O tipo é reconhecido sozinho. Dá para colar o copia e cola ou ler o QR pela foto.
            </p>
          )}
        </Campo>

        {qrLido && (
          <div className="mb-3.5 flex items-start gap-2 rounded-[10px] border border-primary/30 bg-[var(--primary-tint)] px-3 py-2.5">
            <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-[11.5px] leading-snug text-muted-foreground">
              <strong className="text-foreground">Lido do QR code</strong>
              {qrLido.nome ? ` · ${qrLido.nome}` : ""}
              {qrLido.valor ? ` · ${brl(qrLido.valor)}` : ""}
              {qrLido.chave
                ? ". Vai gravar a chave de dentro dele."
                : ". QR dinâmico: o código inteiro fica gravado — quem paga cola no app do banco."}
              {qrLido.valor && Math.abs(qrLido.valor - form.valor) > 0.004 ? (
                <span className="block text-warning-ink">
                  O valor do QR é {brl(qrLido.valor)} e o do formulário está diferente — confira.
                </span>
              ) : null}
            </p>
          </div>
        )}

        {/* ── Valor ── */}
        <Campo rotulo="Valor">
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={Number.isFinite(form.valor) ? form.valor : 0}
            onChange={(e) => setForm({ ...form, valor: numFromInput(e.target.valueAsNumber) })}
            className={`min-h-11 w-full rounded-[10px] border bg-card px-3 text-[13px] outline-none focus:border-primary ${
              valorInvalido ? "border-destructive" : "border-border"
            }`}
          />
        </Campo>

        {/* ── Descrição ── */}
        <Campo rotulo="Descrição (opcional)">
          <input
            value={form.descricao}
            onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            placeholder="Ex.: diária, adiantamento, nº do pedido"
            className="min-h-11 w-full rounded-[10px] border border-border bg-card px-3 text-[13px] outline-none focus:border-primary"
          />
        </Campo>

        {empresa && (
          <div className="mb-3.5 flex items-center gap-2 rounded-[10px] bg-[var(--primary-tint)] p-2.5">
            <Building2 className="h-4 w-4 shrink-0 text-primary" />
            <p className="text-[11.5px] text-muted-foreground">
              Este lançamento será salvo em <strong className="text-foreground">{empresa}</strong>.
            </p>
          </div>
        )}

        {erro && (
          <p className="mb-4 flex items-start gap-1.5 rounded-[10px] bg-destructive/10 px-3 py-2.5 text-[12.5px] font-medium text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {erro}
          </p>
        )}

        <div className="h-4" />
      </div>

      {/* ── Ações presas embaixo ── */}
      <div
        className="flex shrink-0 items-center gap-2 border-t border-border/70 bg-background px-3 pt-2.5"
        style={{ paddingBottom: "calc(0.875rem + env(safe-area-inset-bottom))" }}
      >
        <button
          type="button"
          onClick={fechar}
          disabled={salvando}
          className="inline-flex min-h-11 items-center justify-center rounded-[10px] border border-border px-4 text-[12.5px] font-bold"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[10px] bg-primary text-[13px] font-bold text-[var(--primary-ink)] disabled:opacity-60"
        >
          {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
          {pagamento ? "Salvar alterações" : "Salvar lançamento"}
        </button>
      </div>
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="mb-3.5 flex flex-col">
      <label className="mb-1.5 text-[12px] font-semibold">{rotulo}</label>
      {children}
    </div>
  );
}
