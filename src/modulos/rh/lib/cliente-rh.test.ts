import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bucketRH, clienteRH, tabelaRH } from "@/modulos/rh/lib/cliente-rh";

describe("cliente do RH no banco do Financeiro", () => {
  it("põe o prefixo rh_ nas tabelas (uma vez só)", () => {
    expect(tabelaRH("funcionarios")).toBe("rh_funcionarios");
    expect(tabelaRH("pagamentos_diarios")).toBe("rh_pagamentos_diarios");
    expect(tabelaRH("rh_config")).toBe("rh_config");
  });

  it("troca os buckets do CRM RH pelos rh-*", () => {
    expect(bucketRH("documentos")).toBe("rh-documentos");
    expect(bucketRH("extratos")).toBe("rh-extratos");
  });

  it("usa o mesmo cliente (e o mesmo login) do Financeiro", () => {
    const from = vi.fn(() => "consulta");
    const storageFrom = vi.fn(() => "bucket");
    const auth = { getSession: vi.fn() };
    const base = { from, storage: { from: storageFrom }, auth } as unknown as SupabaseClient;
    const rh = clienteRH(base);
    expect(rh.from("funcionarios")).toBe("consulta");
    expect(from).toHaveBeenCalledWith("rh_funcionarios");
    expect(rh.storage.from("documentos")).toBe("bucket");
    expect(storageFrom).toHaveBeenCalledWith("rh-documentos");
    expect(rh.auth).toBe(auth);
  });
});
