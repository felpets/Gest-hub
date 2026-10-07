// Extrai uma mensagem legível de um erro qualquer para exibir num toast.
// Cobre Error, erro do Supabase ({ message }), string e o resto (fallback).
export function msgErro(err: unknown): string {
  const generico = "Algo deu errado. Tente de novo.";
  if (err == null) return generico;
  if (typeof err === "string") return err.trim() || generico;
  if (err instanceof Error) return err.message || generico;
  if (typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  return generico;
}
