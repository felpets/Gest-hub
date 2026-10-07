import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell, TelaEmbutida } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Moon, Sun, RotateCcw, Bell, BellRing, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useEmpresa } from "@/lib/empresa";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { isMock } from "@/lib/supabase";
import { restaurarDadosDemo } from "@/lib/mock";
import { podeGerirUsuarios, temAlguma } from "@/lib/permissoes";
import { SECOES_CONFIG, secaoConfigAtiva, podeVerModuloRH, type SecaoConfig } from "@/lib/navegacao";
import { useAcessoRH } from "@/modulos/rh/acesso";
import { ModuloRH } from "@/modulos/rh/ModuloRH";
import { FUNCIONALIDADES, ligada } from "@/lib/funcionalidades";
import { useFuncionalidades, useSalvarFuncionalidade } from "@/lib/queries";
import {
  gravarPrefsAvisos, lerPrefsAvisos, notificacaoSuportada, pedirPermissaoNotificacao,
  consultarPermissaoNotificacao, notificarSistema, tocarAlerta, type PrefsAvisosPix,
} from "@/lib/avisos-pix";
import { NO_APP } from "@/lib/nativo";
import { Ajustes } from "@/modulos/financeiro/telas/ajustes";
import { PlanoContas } from "@/modulos/financeiro/telas/plano-de-contas";
import { Usuarios } from "@/modulos/gestao/telas/usuarios";
import { Empresas } from "@/modulos/gestao/telas/empresas";
import { useEhCelular } from "@/lib/tela";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Configurações — uma área só para o sistema inteiro (engrenagem no topo).
// Reúne o que antes estava espalhado pelo menu lateral: Ajustes do Financeiro,
// Plano de contas, Configurações do RH, Usuários, Empresas e cargos. Cada seção
// continua sendo a MESMA tela de antes (nada foi reescrito nem duplicado): só
// mudou o caminho até ela.
export const Route = createFileRoute("/configuracoes")({
  validateSearch: (s: Record<string, unknown>): { secao?: string } => ({
    secao: typeof s.secao === "string" && s.secao ? s.secao : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Configurações · Finance HUB" },
      { name: "description", content: "Configurações do sistema: geral, Financeiro, RH, usuários, permissões e funcionalidades." },
    ],
  }),
  component: Configuracoes,
});

// Seções que este login abre — mesma regra do menu e do guarda de rota.
function useSecoesPermitidas(): SecaoConfig[] {
  const { caps, isMaster, papel } = useEmpresa();
  const { perfil } = useAcessoRH();
  return SECOES_CONFIG.filter((s) => {
    if (s.especial === "master") return isMaster;
    if (s.especial === "gerir_usuarios") return podeGerirUsuarios(isMaster, papel);
    if (s.moduloRH && !podeVerModuloRH(perfil, s.moduloRH)) return false;
    return temAlguma(caps, s.caps);
  });
}

function Configuracoes() {
  const { secao } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const secoes = useSecoesPermitidas();
  const ativa = secaoConfigAtiva(secoes, secao);
  // No celular a coluna da esquerda não é uma coluna: ela é a TELA. Sem
  // seção no endereço mostra a lista; com seção, só ela, com o voltar. Fica
  // no endereço de propósito — assim o botão do aparelho fecha a seção em vez
  // de sair das Configurações, como no Pix do dia.
  const celular = useEhCelular();
  const emLista = celular && !secao;

  // Agrupa as seções da coluna da esquerda pelos títulos do catálogo.
  const grupos: { nome: string; itens: SecaoConfig[] }[] = [];
  for (const s of secoes) {
    const g = grupos.find((x) => x.nome === s.grupo);
    if (g) g.itens.push(s);
    else grupos.push({ nome: s.grupo, itens: [s] });
  }

  if (emLista) {
    return (
      <AppShell title="Configurações" subtitle={undefined}>
        <div className="space-y-4">
          {grupos.length === 0 && (
            <p className="py-16 text-center text-[12.5px] text-muted-foreground">
              Nenhuma configuração está liberada para o seu acesso.
            </p>
          )}
          {grupos.map((g) => (
            <div key={g.nome}>
              <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {g.nome}
              </p>
              <div className="space-y-2">
                {g.itens.map((sec) => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => navigate({ search: { secao: sec.id } })}
                    className="flex w-full items-center gap-3 rounded-xl border border-border/70 bg-card p-3 text-left"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[var(--primary-tint)]">
                      <sec.icon className="h-[18px] w-[18px] text-primary stroke-[1.7]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-bold">{sec.titulo}</span>
                      <span className="block text-[11.5px] leading-snug text-muted-foreground">
                        {sec.desc}
                      </span>
                    </span>
                    <ChevronRight className="h-[17px] w-[17px] shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={celular ? (ativa?.titulo ?? "Configurações") : "Configurações"}
      subtitle={ativa?.desc ?? "Preferências e parâmetros do sistema"}
    >
      {celular && (
        <button
          type="button"
          onClick={() => navigate({ search: {} })}
          className="mb-3 inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-border/70 px-2.5 text-[12.5px] font-bold"
        >
          <ChevronLeft className="h-4 w-4" /> Configurações
        </button>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-[264px_minmax(0,1fr)] gap-6">
        <nav
          aria-label="Seções das configurações"
          className={cn("lg:sticky lg:top-24 h-fit", celular && "hidden")}
        >
          <Card className="p-2 card-elevated border-border/70">
            {grupos.map((g) => (
              <div key={g.nome} className="mb-1 last:mb-0">
                <p className="px-3 pb-1 pt-2.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">{g.nome}</p>
                <div className="space-y-0.5">
                  {g.itens.map((s) => {
                    const on = s.id === ativa?.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => navigate({ search: { secao: s.id } })}
                        aria-current={on ? "page" : undefined}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors cursor-pointer",
                          on ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                        )}
                      >
                        <s.icon className={cn("h-4 w-4 shrink-0 stroke-[1.7]", on ? "text-primary" : "")} />
                        <span className="truncate">{s.titulo}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </Card>
        </nav>

        <div className="min-w-0">
          {!ativa ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Nenhuma configuração está liberada para o seu acesso.
            </p>
          ) : ativa.id === "geral" ? (
            <SecaoGeral />
          ) : ativa.id === "funcionalidades" ? (
            <SecaoFuncionalidades />
          ) : ativa.id === "rh" ? (
            <ModuloRH seguirFinanceiro modulo="config" sub="" />
          ) : (
            <TelaEmbutida caps={ativa.caps}>
              {ativa.id === "financeiro" && <Ajustes />}
              {ativa.id === "plano" && <PlanoContas />}
              {ativa.id === "usuarios" && <Usuarios />}
              {ativa.id === "empresas" && <Empresas />}
            </TelaEmbutida>
          )}
        </div>
      </div>
    </AppShell>
  );
}

// ─── Geral: o que vale para este login (não para a empresa) ────────────────
function SecaoGeral() {
  const { isDark, toggle } = useTheme();
  const { user, signOut } = useAuth();
  const { papelNome, empresas, empresaId, caps } = useEmpresa();
  const navigate = useNavigate();
  const empresa = empresas.find((e) => e.id === empresaId)?.nome ?? "—";

  const restaurar = async () => {
    restaurarDadosDemo();
    await signOut();
    toast.success("Dados de demonstração restaurados. Entre novamente.");
    navigate({ to: "/login" });
  };

  return (
    <div className="space-y-5">
      <Card className="card-elevated border-border/70 overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="font-display text-base font-semibold">Aparência</h3>
          <p className="text-xs text-muted-foreground">Vale só para este navegador.</p>
        </div>
        <div className="flex items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-lg bg-secondary grid place-items-center shrink-0">
              {isDark ? <Moon className="h-[18px] w-[18px] stroke-[1.6]" /> : <Sun className="h-[18px] w-[18px] stroke-[1.6]" />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">Modo escuro</p>
              <p className="text-xs text-muted-foreground">{isDark ? "Ligado" : "Desligado"} — o mesmo botão fica no topo da tela.</p>
            </div>
          </div>
          <Switch checked={isDark} onCheckedChange={toggle} aria-label="Modo escuro" />
        </div>
      </Card>

      <Card className="card-elevated border-border/70 overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="font-display text-base font-semibold">Este login</h3>
          <p className="text-xs text-muted-foreground">Para mudar cargo ou acessos, fale com quem administra.</p>
        </div>
        <dl className="divide-y divide-border text-sm">
          {[
            ["E-mail", user?.email ?? "—"],
            ["Cargo no Financeiro", papelNome],
            ["Empresa ativa", empresa],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 px-6 py-3">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium truncate">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {caps.has("pag_diario_gerir") && <AvisosPix />}

      {isMock && (
        <Card className="card-elevated border-primary/30 bg-primary/5 p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Protótipo com dados fictícios</p>
            <p className="text-xs text-muted-foreground">Restaura a base de demonstração e volta tudo ao início.</p>
          </div>
          <button
            onClick={restaurar}
            className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 h-9 text-sm font-medium hover:bg-secondary"
          >
            <RotateCcw className="h-4 w-4" /> Restaurar dados de demonstração
          </button>
        </Card>
      )}
    </div>
  );
}

// ─── Avisos do Pix do dia (migração 58) ────────────────────────────────────
// Quando outra pessoa lança, altera, paga, estorna ou exclui um Pix, quem tem
// a tela aberta recebe o aviso na hora. O QUE chega é fixo (o aviso no canto);
// como ele chega em CADA aparelho é escolha daqui — por isso fica no
// localStorage e não no banco: o celular no bolso quer som, o desktop da mesa
// nem sempre. Quem fez a ação nunca é avisado do próprio clique.
function AvisosPix() {
  const [prefs, setPrefs] = useState<PrefsAvisosPix>({ toast: true, som: true, sistema: false });
  const [permissao, setPermissao] = useState<NotificationPermission>("default");

  // Só depois de montar: localStorage e Notification não existem no servidor.
  useEffect(() => {
    setPrefs(lerPrefsAvisos());
    // No app a resposta vem do Android, por isso é assíncrona nos dois casos.
    void consultarPermissaoNotificacao().then(setPermissao);
  }, []);

  const salvar = (mudanca: Partial<PrefsAvisosPix>) => {
    setPrefs((atual) => {
      const novo = { ...atual, ...mudanca };
      gravarPrefsAvisos(novo);
      return novo;
    });
  };

  // O navegador só abre a caixa de permissão a partir de um clique — por isso
  // ela é pedida aqui, no switch, e nunca sozinha ao carregar o sistema.
  const ligarSistema = async (ligado: boolean) => {
    if (!ligado) return salvar({ sistema: false });
    if (!notificacaoSuportada()) {
      toast.error("Este navegador não tem notificações do sistema.");
      return;
    }
    const p = (await consultarPermissaoNotificacao()) === "granted" ? "granted" : await pedirPermissaoNotificacao();
    setPermissao(p);
    if (p !== "granted") {
      toast.error(NO_APP
        ? "O Android bloqueou as notificações do app. Libere em Configurações do celular › Apps › Notificações."
        : "O navegador bloqueou as notificações. Libere nas permissões do site e tente de novo.");
      return;
    }
    salvar({ sistema: true });
  };

  const linhas: { chave: keyof PrefsAvisosPix; icone: typeof Bell; titulo: string; desc: string; ao: (v: boolean) => void }[] = [
    {
      chave: "toast", icone: Bell, titulo: "Aviso na tela",
      desc: "Mostra no canto quem lançou ou pagou, em qualquer tela do sistema.",
      ao: (v) => salvar({ toast: v }),
    },
    {
      chave: "som", icone: Volume2, titulo: "Som de alerta",
      desc: "Bipe curto junto com o aviso. Toca depois do primeiro clique na aba (regra do navegador).",
      ao: (v) => { salvar({ som: v }); if (v) tocarAlerta(); },
    },
    {
      chave: "sistema", icone: BellRing, titulo: NO_APP ? "Notificação do celular" : "Notificação do computador",
      desc: NO_APP
        ? permissao === "denied"
          ? "Bloqueada no Android — libere em Configurações do celular › Apps › Notificações."
          : "Avisa na barra do Android quando o app está em segundo plano ou com a tela apagada."
        : permissao === "denied"
          ? "Bloqueada neste navegador — libere nas permissões do site para poder ligar."
          : "Avisa quando o Finance HUB está minimizado, em outra aba ou atrás de outra janela.",
      ao: (v) => void ligarSistema(v),
    },
  ];

  // Dispara o que estiver ligado, AGORA — a notificação sai mesmo com a tela
  // em foco, para dar para ver se o Windows está deixando ela aparecer.
  const testar = async () => {
    if (prefs.toast) toast.info("Novo Pix no dia", { description: "Teste: é assim que o aviso aparece." });
    if (prefs.som) tocarAlerta();
    if (prefs.sistema) {
      if ((await consultarPermissaoNotificacao()) !== "granted") {
        toast.error(NO_APP ? "O Android não liberou as notificações do app." : "O navegador não liberou as notificações deste site.");
      } else {
        notificarSistema("Novo Pix no dia", `Teste: é assim que a notificação do ${NO_APP ? "celular" : "computador"} aparece.`);
        toast.message("Notificação enviada", {
          description: NO_APP
            ? "Não apareceu? Confira em Configurações do celular › Apps › Finance HUB › Notificações e se o Não perturbe está desligado."
            : "Não apareceu? Confira nas Configurações do Windows › Notificações se o navegador está liberado e se o Não perturbe está desligado.",
          duration: 10000,
        });
      }
    }
  };

  return (
    <Card className="card-elevated border-border/70 overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold">Avisos do Pix do dia</h3>
          <p className="text-xs text-muted-foreground">
            Vale só para este aparelho. O contador no menu aparece sempre e zera ao abrir a tela.
          </p>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={() => void testar()}
          disabled={!prefs.toast && !prefs.som && !prefs.sistema}>
          Testar avisos
        </Button>
      </div>
      <div className="divide-y divide-border">
        {linhas.map((l) => (
          <div key={l.chave} className="flex items-center justify-between gap-4 px-6 py-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-9 w-9 rounded-lg bg-secondary grid place-items-center shrink-0">
                <l.icone className="h-[18px] w-[18px] stroke-[1.6]" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">{l.titulo}</p>
                <p className="text-xs text-muted-foreground">{l.desc}</p>
              </div>
            </div>
            <Switch checked={prefs[l.chave]} onCheckedChange={l.ao} aria-label={l.titulo} />
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Funcionalidades opcionais (migração 47) ───────────────────────────────
function SecaoFuncionalidades() {
  const { data: mapa, isLoading } = useFuncionalidades();
  const salvar = useSalvarFuncionalidade();
  const { empresas, empresaId } = useEmpresa();
  const empresa = empresas.find((e) => e.id === empresaId)?.nome ?? "esta empresa";

  return (
    <div className="space-y-5">
      <Card className="p-4 card-elevated border-primary/20 bg-primary/5">
        <p className="text-xs text-muted-foreground">
          Estas chaves valem para <strong className="text-foreground">{empresa}</strong>. Desligar não apaga nada:
          os registros continuam no banco e voltam a aparecer quando você religar.
        </p>
      </Card>

      {FUNCIONALIDADES.map((f) => {
        const on = ligada(mapa, f.chave);
        const salvando = salvar.isPending && salvar.variables?.chave === f.chave;
        return (
          <Card key={f.chave} className="card-elevated border-border/70 p-5 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-display text-base font-semibold">{f.nome}</h3>
                <Badge variant="outline" className={on ? "bg-success/10 text-success border-0" : "bg-secondary border-0 text-muted-foreground"}>
                  {on ? "Ligada" : "Desligada"}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
              <p className="mt-1 text-xs text-muted-foreground">Aparece em: {f.onde}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {(isLoading || salvando) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <Switch
                checked={on}
                disabled={isLoading || salvar.isPending}
                aria-label={f.nome}
                onCheckedChange={(v) =>
                  salvar.mutate(
                    { chave: f.chave, ligada: v },
                    {
                      onSuccess: () => toast.success(`${f.nome}: ${v ? "ligada" : "desligada"}.`),
                      onError: (e) => toast.error(e instanceof Error ? e.message : "Não consegui salvar."),
                    },
                  )
                }
              />
            </div>
          </Card>
        );
      })}
    </div>
  );
}
