import { describe, it, expect, beforeEach } from "vitest";
import {
  contaComoNovo, gravarPrefsAvisos, lerPrefsAvisos, resumirEventos, textoDoAviso, type EventoPix,
} from "@/lib/avisos-pix";

const ev = (p: Partial<EventoPix> = {}): EventoPix => ({
  acao: "criado", titular: "João Silva", valor: 1200, autorEmail: "ana.paula@zaytan.com", ...p,
});

describe("aviso de um evento", () => {
  it("diz quem, o quê, quanto e para quem", () => {
    const a = textoDoAviso(ev());
    expect(a.titulo).toBe("Novo Pix no dia");
    expect(a.detalhe).toContain("Ana Paula");
    expect(a.detalhe).toContain("1.200,00");
    expect(a.detalhe).toContain("João Silva");
    expect(a.urgente).toBe(false);
  });

  it("marca como urgente o que muda a linha debaixo do outro pagador", () => {
    expect(textoDoAviso(ev({ acao: "alterado" })).urgente).toBe(true);
    expect(textoDoAviso(ev({ acao: "estornado" })).urgente).toBe(true);
    expect(textoDoAviso(ev({ acao: "excluido" })).urgente).toBe(true);
    expect(textoDoAviso(ev({ acao: "pago" })).urgente).toBe(false);
  });

  it("aguenta titular vazio, valor negativo e autor sem e-mail", () => {
    const a = textoDoAviso({ acao: "pago", titular: "", valor: -50, autorEmail: "" });
    expect(a.detalhe).toContain("Outro usuário");
    expect(a.detalhe).toContain("50,00");
    expect(a.detalhe).not.toContain("-");
    expect(a.detalhe).not.toContain("para ");
  });

  // Só o que entra na fila de pagar conta no menu: estorno e exclusão TIRAM
  // trabalho, não adicionam.
  it("conta como novidade só o que foi lançado", () => {
    expect(contaComoNovo("criado")).toBe(true);
    expect(contaComoNovo("pago")).toBe(false);
    expect(contaComoNovo("excluido")).toBe(false);
  });
});

describe("rajada de eventos", () => {
  it("com um só, é o aviso normal", () => {
    expect(resumirEventos([ev()])).toEqual(textoDoAviso(ev()));
  });

  it("junta a mesma ação da mesma pessoa e soma os valores", () => {
    const a = resumirEventos([ev({ valor: 1000 }), ev({ valor: 500, titular: "Maria" })]);
    expect(a.titulo).toBe("Novos Pix no dia");
    expect(a.detalhe).toContain("Ana Paula");
    expect(a.detalhe).toContain("2 pagamentos");
    expect(a.detalhe).toContain("1.500,00");
  });

  it("conta as pessoas quando os autores são diferentes", () => {
    const a = resumirEventos([ev(), ev({ autorEmail: "carlos@zaytan.com" })]);
    expect(a.detalhe).toContain("2 pessoas");
  });

  it("com ações misturadas, avisa que a lista mudou e herda a urgência", () => {
    const a = resumirEventos([ev(), ev({ acao: "excluido" })]);
    expect(a.titulo).toBe("Pix do dia mudou");
    expect(a.detalhe).toContain("2 alterações");
    expect(a.urgente).toBe(true);
  });
});

// O vitest deste projeto roda em Node puro (sem DOM), então o armazenamento
// do navegador entra aqui como dublê — é o que as preferências usam.
describe("preferências deste aparelho", () => {
  beforeEach(() => {
    const guardado = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => guardado.get(k) ?? null,
      setItem: (k: string, v: string) => void guardado.set(k, v),
      removeItem: (k: string) => void guardado.delete(k),
      clear: () => guardado.clear(),
    };
  });

  it("começa com aviso na tela e som ligados, e notificação do sistema desligada", () => {
    expect(lerPrefsAvisos()).toEqual({ toast: true, som: true, sistema: false });
  });

  it("guarda e relê a escolha", () => {
    gravarPrefsAvisos({ toast: true, som: false, sistema: true });
    expect(lerPrefsAvisos()).toEqual({ toast: true, som: false, sistema: true });
  });

  it("ignora conteúdo corrompido e volta ao padrão", () => {
    localStorage.setItem("zaytan.avisosPix", "{quebrado");
    expect(lerPrefsAvisos()).toEqual({ toast: true, som: true, sistema: false });
  });

  it("completa as chaves que faltam numa preferência antiga", () => {
    localStorage.setItem("zaytan.avisosPix", JSON.stringify({ som: false }));
    expect(lerPrefsAvisos()).toEqual({ toast: true, som: false, sistema: false });
  });
});
