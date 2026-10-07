// ─── Filtrar pagamentos, no celular ─────────────────────────────────────────
// Tela 06 do desenho. Mexe numa CÓPIA dos filtros e só devolve o resultado no
// "Ver N resultados": assim a lista atrás não fica piscando a cada toque, e
// desistir (fechar) não muda nada.
//
// A regra de o que cada filtro faz não está aqui — está em src/lib/pix-filtros.ts,
// que é função pura e tem teste. Esta tela só coleta a escolha.
import { useState } from "react";
import { X, Search, Check } from "lucide-react";
import { TIPOS_CHAVE, type TipoChavePix } from "@/lib/pix";
import { nomeDoEmail } from "@/lib/format";
import {
  FILTROS_PADRAO,
  quantosFiltros,
  type Filtros,
  type ModoPeriodo,
  type Situacao,
} from "@/lib/pix-filtros";

const PERIODOS: { valor: ModoPeriodo; label: string }[] = [
  { valor: "dia", label: "O dia" },
  { valor: "7dias", label: "7 dias" },
  { valor: "mes", label: "Este mês" },
  { valor: "personalizado", label: "Escolher" },
];

const SITUACOES: { valor: Situacao; label: string }[] = [
  { valor: "pendente", label: "Pendente" },
  { valor: "pago", label: "Pago" },
  { valor: "estornado", label: "Estornado" },
];

export function TelaFiltrosPix({
  filtros,
  autores,
  fechar,
  aplicar,
  contar,
}: {
  filtros: Filtros;
  /** E-mails de quem lançou os Pix do período — vem do histórico. */
  autores: string[];
  fechar: () => void;
  aplicar: (f: Filtros) => void;
  /** Quantos lançamentos o rascunho atual mostraria. */
  contar: (f: Filtros) => { total: number; porSituacao: Record<Situacao, number> };
}) {
  const [rascunho, setRascunho] = useState<Filtros>(filtros);
  const { total, porSituacao } = contar(rascunho);
  const mudar = (parte: Partial<Filtros>) => setRascunho((f) => ({ ...f, ...parte }));

  const alternarSituacao = (s: Situacao) =>
    setRascunho((f) => {
      const tem = f.status.includes(s);
      // Nunca deixa ficar sem nenhuma: sem situação, a lista seria um mistério.
      if (tem && f.status.length === 1) return f;
      return { ...f, status: tem ? f.status.filter((x) => x !== s) : [...f.status, s] };
    });

  const alternarTipo = (t: TipoChavePix) =>
    setRascunho((f) => ({
      ...f,
      tipos: f.tipos.includes(t) ? f.tipos.filter((x) => x !== t) : [...f.tipos, t],
    }));

  const numero = (v: string): number | null => {
    const n = Number(v.replace(",", "."));
    return v.trim() === "" || !Number.isFinite(n) ? null : n;
  };

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
          <p className="truncate text-[17px] font-bold leading-tight">Filtrar pagamentos</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {quantosFiltros(rascunho) === 0
              ? "Nenhum filtro além do dia"
              : `${quantosFiltros(rascunho)} filtro${quantosFiltros(rascunho) === 1 ? "" : "s"} ativo${quantosFiltros(rascunho) === 1 ? "" : "s"}`}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pt-3.5">
        {/* ── Busca ── */}
        <div className="flex h-[42px] items-center gap-2 rounded-xl border border-border bg-card px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={rascunho.busca}
            onChange={(e) => mudar({ busca: e.target.value })}
            placeholder="Buscar titular, chave ou descrição"
            className="w-full bg-transparent text-[13px] outline-none"
          />
        </div>

        {/* ── Período ── */}
        <Grupo titulo="Período">
          <div className="flex gap-1.5">
            {PERIODOS.map((p) => (
              <Pastilha
                key={p.valor}
                ativa={rascunho.periodo === p.valor}
                onClick={() => mudar({ periodo: p.valor })}
                cheia
              >
                {p.label}
              </Pastilha>
            ))}
          </div>
          {rascunho.periodo === "personalizado" && (
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <CampoData rotulo="De" valor={rascunho.de} onChange={(v) => mudar({ de: v })} />
              <CampoData rotulo="Até" valor={rascunho.ate} onChange={(v) => mudar({ ate: v })} />
            </div>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            O período conta a partir do dia escolhido na tira de dias.
          </p>
        </Grupo>

        {/* ── Situação ── */}
        <Grupo titulo="Situação">
          <div className="flex flex-col">
            {SITUACOES.map((s) => {
              const marcada = rascunho.status.includes(s.valor);
              return (
                <button
                  key={s.valor}
                  type="button"
                  onClick={() => alternarSituacao(s.valor)}
                  className="flex h-9 items-center gap-2.5 text-left text-[13px]"
                >
                  <span
                    className={`grid h-[19px] w-[19px] shrink-0 place-items-center rounded-[5px] border-[1.5px] ${
                      marcada
                        ? "border-primary bg-primary text-[var(--primary-ink)]"
                        : "border-muted-foreground/60"
                    }`}
                  >
                    {marcada && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  {s.label}
                  <small className="ml-auto text-[12px] text-muted-foreground">
                    {porSituacao[s.valor]}
                  </small>
                </button>
              );
            })}
          </div>
        </Grupo>

        {/* ── Tipo de chave ── */}
        <Grupo titulo="Tipo de chave">
          <div className="flex flex-wrap gap-1.5">
            <Pastilha ativa={rascunho.tipos.length === 0} onClick={() => mudar({ tipos: [] })}>
              Todas
            </Pastilha>
            {TIPOS_CHAVE.map((t) => (
              <Pastilha
                key={t.valor}
                ativa={rascunho.tipos.includes(t.valor as TipoChavePix)}
                onClick={() => alternarTipo(t.valor as TipoChavePix)}
              >
                {t.label}
              </Pastilha>
            ))}
          </div>
        </Grupo>

        {/* ── Quem lançou ── */}
        {autores.length > 0 && (
          <Grupo titulo="Lançado por">
            <select
              value={rascunho.autor}
              onChange={(e) => mudar({ autor: e.target.value })}
              className="min-h-11 w-full rounded-[10px] border border-border bg-card px-3 text-[13px] outline-none"
            >
              <option value="">Todos</option>
              {autores.map((a) => (
                <option key={a} value={a}>
                  {nomeDoEmail(a)}
                </option>
              ))}
            </select>
          </Grupo>
        )}

        {/* ── Faixa de valor ── */}
        <Grupo titulo="Faixa de valor">
          <div className="grid grid-cols-2 gap-2">
            <CampoValor
              rotulo="Mínimo"
              valor={rascunho.valorMin}
              onChange={(v) => mudar({ valorMin: numero(v) })}
            />
            <CampoValor
              rotulo="Máximo"
              valor={rascunho.valorMax}
              onChange={(v) => mudar({ valorMax: numero(v) })}
            />
          </div>
        </Grupo>

        <div className="h-4" />
      </div>

      {/* ── Ações presas embaixo ── */}
      <div
        className="flex shrink-0 items-center gap-2 border-t border-border/70 bg-background px-3 pt-2.5"
        style={{ paddingBottom: "calc(0.875rem + env(safe-area-inset-bottom))" }}
      >
        <button
          type="button"
          onClick={() => setRascunho({ ...FILTROS_PADRAO, status: rascunho.status })}
          className="min-h-11 shrink-0 rounded-[10px] px-3 text-[12.5px] font-bold text-primary"
        >
          Limpar filtros
        </button>
        <button
          type="button"
          onClick={() => {
            aplicar(rascunho);
            fechar();
          }}
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-[10px] bg-primary text-[13px] font-bold text-[var(--primary-ink)]"
        >
          Ver {total} resultado{total === 1 ? "" : "s"}
        </button>
      </div>
    </div>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border/70 py-4 last:border-0">
      <h2 className="mb-2.5 text-[13px] font-bold">{titulo}</h2>
      {children}
    </section>
  );
}

function Pastilha({
  ativa,
  onClick,
  cheia,
  children,
}: {
  ativa: boolean;
  onClick: () => void;
  cheia?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[34px] rounded-[9px] border px-2.5 text-[12px] font-semibold transition-colors ${
        cheia ? "flex-1" : ""
      } ${ativa ? "border-primary/60 bg-[var(--primary-soft)] text-foreground" : "border-border bg-card text-muted-foreground"}`}
    >
      {children}
    </button>
  );
}

function CampoData({
  rotulo,
  valor,
  onChange,
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col">
      <span className="mb-1.5 text-[12px] font-semibold">{rotulo}</span>
      <input
        type="date"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 w-full rounded-[10px] border border-border bg-card px-3 text-[13px] outline-none focus:border-primary"
      />
    </label>
  );
}

function CampoValor({
  rotulo,
  valor,
  onChange,
}: {
  rotulo: string;
  valor: number | null;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col">
      <span className="mb-1.5 text-[12px] font-semibold">{rotulo}</span>
      <input
        type="number"
        min={0}
        step="0.01"
        inputMode="decimal"
        value={valor ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder="R$ 0,00"
        className="min-h-11 w-full rounded-[10px] border border-border bg-card px-3 text-[13px] outline-none focus:border-primary"
      />
    </label>
  );
}
