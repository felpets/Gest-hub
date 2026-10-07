// ─── Avisos do Pix do dia (tempo real) ─────────────────────────────────────
// Peças SEM React usadas pelo aviso que aparece quando outra pessoa mexe no
// Pix do dia: o texto do alarme, as preferências de quem recebe, o som, a
// notificação do sistema e o contador do menu.
//
// Quem escuta o banco é o componente <AvisosPixDiario /> (montado uma vez na
// raiz do app); aqui fica só o que dá para testar sem montar tela nenhuma.
import { useSyncExternalStore } from "react";
import { brl, nomeDoEmail } from "@/lib/format";
import { NO_APP } from "@/lib/nativo";

// As mesmas ações do gatilho da migração 39 (coluna `acao` do histórico).
export type AcaoPix = "criado" | "alterado" | "pago" | "estornado" | "excluido";

export type EventoPix = {
  acao: AcaoPix;
  titular: string;
  valor: number;
  autorEmail: string;
};

export type AvisoPix = {
  titulo: string;
  detalhe: string;
  // Só 'criado' e 'pago' são rotina; o resto é coisa que o outro pagador
  // precisa MESMO ver antes de continuar (a linha mudou debaixo dele).
  urgente: boolean;
};

// ─── Texto do aviso ────────────────────────────────────────────────────────
// Sempre na ordem "quem → o quê → quanto → para quem": é como a pessoa lê o
// aviso de canto de olho, sem parar o que está fazendo.
export function textoDoAviso(e: EventoPix): AvisoPix {
  const quem = nomeDoEmail(e.autorEmail) || "Outro usuário";
  const quanto = brl(Math.abs(e.valor || 0));
  const paraQuem = e.titular?.trim() ? ` para ${e.titular.trim()}` : "";

  switch (e.acao) {
    case "criado":
      return { titulo: "Novo Pix no dia", detalhe: `${quem} lançou ${quanto}${paraQuem}.`, urgente: false };
    case "pago":
      return { titulo: "Pix pago", detalhe: `${quem} marcou ${quanto}${paraQuem} como pago.`, urgente: false };
    case "alterado":
      return { titulo: "Pix alterado", detalhe: `${quem} mudou o pagamento de ${quanto}${paraQuem}. Confira antes de pagar.`, urgente: true };
    case "estornado":
      return { titulo: "Pix estornado", detalhe: `${quem} estornou ${quanto}${paraQuem}. A linha saiu dos totais.`, urgente: true };
    case "excluido":
      return { titulo: "Pix excluído", detalhe: `${quem} excluiu ${quanto}${paraQuem}. Não pague.`, urgente: true };
  }
}

// Quando chegam vários eventos de uma vez (alguém colou a lista do dia
// inteira, ou marcou 12 como pagos de uma tacada), 12 avisos empilhados viram
// ruído e escondem o que importa. A tela junta a rajada e chama isto.
const PLURAL: Record<AcaoPix, { titulo: string; verbo: string }> = {
  criado:    { titulo: "Novos Pix no dia",  verbo: "lançou" },
  pago:      { titulo: "Pix pagos",         verbo: "marcou como pagos" },
  alterado:  { titulo: "Pix alterados",     verbo: "alterou" },
  estornado: { titulo: "Pix estornados",    verbo: "estornou" },
  excluido:  { titulo: "Pix excluídos",     verbo: "excluiu" },
};

export function resumirEventos(eventos: EventoPix[]): AvisoPix {
  if (eventos.length === 1) return textoDoAviso(eventos[0]);

  const urgente = eventos.some((e) => textoDoAviso(e).urgente);
  const autores = new Set(eventos.map((e) => e.autorEmail).filter(Boolean));
  const quem =
    autores.size === 1 ? nomeDoEmail([...autores][0]) || "Outro usuário"
    : autores.size > 1 ? `${autores.size} pessoas`
    : "Outro usuário";

  const acoes = new Set(eventos.map((e) => e.acao));
  if (acoes.size === 1) {
    const { titulo, verbo } = PLURAL[eventos[0].acao];
    const total = eventos.reduce((s, e) => s + Math.abs(e.valor || 0), 0);
    return { titulo, detalhe: `${quem} ${verbo} ${eventos.length} pagamentos — ${brl(total)} no total.`, urgente };
  }
  return { titulo: "Pix do dia mudou", detalhe: `${quem} fez ${eventos.length} alterações na lista.`, urgente };
}

// Só conta para o contador do menu o que ainda está por pagar. Estorno e
// exclusão avisam, mas não são "tarefa nova" — nada entrou na fila.
export const contaComoNovo = (acao: AcaoPix) => acao === "criado";

// ─── Preferências (deste navegador) ────────────────────────────────────────
// Ficam no localStorage e não no banco de propósito: som e notificação do
// sistema são escolha do aparelho (o celular no bolso quer som, o desktop da
// mesa talvez não), não do usuário no sistema inteiro.
export type PrefsAvisosPix = {
  toast: boolean;    // aviso no canto da tela
  som: boolean;      // bipe curto
  sistema: boolean;  // notificação do Windows/celular (fora da aba)
};

const CHAVE_PREFS = "zaytan.avisosPix";
const PADRAO: PrefsAvisosPix = { toast: true, som: true, sistema: false };

export function lerPrefsAvisos(): PrefsAvisosPix {
  if (typeof localStorage === "undefined") return PADRAO;
  try {
    const raw = localStorage.getItem(CHAVE_PREFS);
    if (!raw) return PADRAO;
    const p = JSON.parse(raw) as Partial<PrefsAvisosPix>;
    return {
      toast: p.toast ?? PADRAO.toast,
      som: p.som ?? PADRAO.som,
      sistema: p.sistema ?? PADRAO.sistema,
    };
  } catch {
    return PADRAO;
  }
}

export function gravarPrefsAvisos(p: PrefsAvisosPix) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CHAVE_PREFS, JSON.stringify(p));
  } catch {
    /* storage cheio ou bloqueado: vale só esta sessão */
  }
}

// ─── Som ───────────────────────────────────────────────────────────────────
// Gerado no próprio navegador (Web Audio), sem arquivo de áudio para baixar.
// Dois bipes curtos: um só se confunde com notificação de mensagem.
//
// O aviso chega pela rede, não de um clique — e o Chrome só deixa tocar som
// que nasce de um gesto da pessoa. Um AudioContext criado na hora do aviso
// nascia "suspended" e o bipe saía mudo (só o teste em Configurações tocava,
// porque ali há clique). Por isso há UM contexto para a aba inteira, criado e
// destravado no primeiro clique ou tecla em qualquer lugar do sistema; depois
// disso ele toca sozinho, inclusive com a aba em segundo plano.
let audioCtx: AudioContext | null = null;

function contextoAudio(): AudioContext | null {
  if (audioCtx) return audioCtx;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  audioCtx = new Ctx();
  return audioCtx;
}

// Chamado uma vez na raiz do app: espera o primeiro gesto e destrava o áudio.
export function destravarAudioNoPrimeiroGesto() {
  if (typeof window === "undefined") return;
  const destravar = () => {
    try {
      const ctx = contextoAudio();
      if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
    } catch {
      /* sem áudio neste navegador */
    }
    if (audioCtx?.state === "running") {
      window.removeEventListener("pointerdown", destravar, true);
      window.removeEventListener("keydown", destravar, true);
    }
  };
  window.addEventListener("pointerdown", destravar, true);
  window.addEventListener("keydown", destravar, true);
}

// Nunca lança: navegador sem áudio ou aba que ainda não recebeu clique nenhum
// só significam "ficou sem som" — o aviso visual já apareceu.
export function tocarAlerta(urgente = false) {
  try {
    const ctx = contextoAudio();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      void ctx.resume().then(() => bipar(ctx, urgente)).catch(() => {});
      return;
    }
    bipar(ctx, urgente);
  } catch {
    /* sem som neste navegador */
  }
}

function bipar(ctx: AudioContext, urgente: boolean) {
  try {
    const agora = ctx.currentTime;
    // Grave e curto no aviso de rotina; mais agudo quando é coisa para conferir.
    const notas = urgente ? [880, 1174] : [660, 880];
    notas.forEach((hz, i) => {
      const t = agora + i * 0.16;
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = hz;
      // Rampa na saída: corte seco vira "clique" no alto-falante.
      vol.gain.setValueAtTime(0.0001, t);
      vol.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      vol.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      osc.connect(vol).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.15);
    });
  } catch {
    /* sem som neste navegador */
  }
}

// ─── Notificação do sistema ────────────────────────────────────────────────
// No navegador é a Notification da web (Windows, macOS, Chrome do celular).
// Dentro do APK ela não existe — o WebView do Android não mostra notificação
// da web —, então lá o aviso sai pelo plugin @capacitor/local-notifications,
// direto na barra do Android. A regra de QUANDO notificar é a mesma nos dois.
export const notificacaoSuportada = () =>
  NO_APP || (typeof window !== "undefined" && "Notification" in window);

// Só o navegador responde na hora; no app a resposta vem do Android
// (ver consultarPermissaoNotificacao).
export const permissaoNotificacao = (): NotificationPermission =>
  !NO_APP && notificacaoSuportada() ? Notification.permission : "default";

const doPlugin = (estado: string): NotificationPermission =>
  estado === "granted" ? "granted" : estado === "denied" ? "denied" : "default";

const plugin = () => import("@capacitor/local-notifications").then((m) => m.LocalNotifications);

export async function consultarPermissaoNotificacao(): Promise<NotificationPermission> {
  if (!notificacaoSuportada()) return "denied";
  if (!NO_APP) return Notification.permission;
  try {
    return doPlugin((await (await plugin()).checkPermissions()).display);
  } catch {
    return "denied";
  }
}

// O navegador só pergunta quando o pedido sai de um clique — por isso a
// autorização é pedida pelo botão em Configurações, e nunca no carregamento.
// No Android 13+ é o mesmo: a caixa "Permitir notificações" sai dali.
export async function pedirPermissaoNotificacao(): Promise<NotificationPermission> {
  if (!notificacaoSuportada()) return "denied";
  try {
    if (NO_APP) return doPlugin((await (await plugin()).requestPermissions()).display);
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

// Notificação do sistema faz sentido quando a pessoa NÃO está olhando o
// sistema. "Aba escondida" não basta: com o navegador atrás do Excel ou do
// WhatsApp, a aba continua "visible" para o Chrome — falta o foco. No app,
// ir para outro aplicativo ou apagar a tela deixa a página "hidden".
export const foraDeVista = () =>
  typeof document !== "undefined" && (document.visibilityState !== "visible" || !document.hasFocus());

// Tocar na notificação traz o sistema para a frente e abre o Pix do dia da
// empresa do aviso. Quem decide o que fazer é o ouvinte da raiz.
let aoTocar: ((empresaId: string) => void) | null = null;
let ouvindoPlugin = false;

export function ouvirToqueNotificacao(fn: (empresaId: string) => void) {
  aoTocar = fn;
  if (!NO_APP || ouvindoPlugin) return;
  ouvindoPlugin = true;
  void plugin()
    .then((p) =>
      p.addListener("localNotificationActionPerformed", (acao) => {
        const empresaId = String((acao.notification.extra as { empresaId?: string } | undefined)?.empresaId ?? "");
        aoTocar?.(empresaId);
      })
    )
    .catch(() => { ouvindoPlugin = false; });
}

// Id numérico estável por empresa: no Android, notificação com o mesmo id
// substitui a anterior — é o equivalente da `tag` da web.
const idDaEmpresa = (empresaId: string) => {
  let h = 7;
  for (const c of empresaId) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h) % 2_000_000_000 || 1;
};

export function notificarSistema(titulo: string, corpo: string, empresaId = "") {
  if (!notificacaoSuportada()) return;
  if (NO_APP) {
    void plugin()
      .then((p) => p.schedule({ notifications: [{ id: idDaEmpresa(empresaId || "pix"), title: titulo, body: corpo, extra: { empresaId } }] }))
      .catch(() => { /* sem permissão no Android: fica só o aviso na tela */ });
    return;
  }
  if (Notification.permission !== "granted") return;
  try {
    // `tag` por empresa: um aviso substitui o anterior da MESMA empresa em vez
    // de empilhar 12 notificações quando alguém lança a lista inteira de uma
    // vez — e o de uma empresa não apaga o da outra.
    const n = new Notification(titulo, { body: corpo, tag: `zaytan-pix-${empresaId || "do-dia"}`, icon: "/favicon.svg" });
    n.onclick = () => {
      window.focus();
      n.close();
      aoTocar?.(empresaId);
    };
  } catch {
    /* alguns navegadores só deixam notificar pelo service worker */
  }
}

// ─── Contador do menu ──────────────────────────────────────────────────────
// Estado de módulo (e não React Context) porque quem escreve é o ouvinte da
// raiz e quem lê é o menu lateral, em ramos diferentes da árvore: um store
// simples evita passar provider por toda a aplicação.
let naoVistos = 0;
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

function assinar(fn: () => void) {
  ouvintes.add(fn);
  return () => void ouvintes.delete(fn);
}

export function somarPixNaoVisto(n = 1) {
  if (n <= 0) return;
  naoVistos += n;
  avisar();
}

export function zerarPixNaoVistos() {
  if (naoVistos === 0) return;
  naoVistos = 0;
  avisar();
}

// O SSR renderiza sempre 0: o contador é da sessão aberta no navegador.
export function usePixNaoVistos(): number {
  return useSyncExternalStore(assinar, () => naoVistos, () => 0);
}
