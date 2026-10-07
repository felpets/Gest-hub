// ─── Busca paginada ─────────────────────────────────────────
// A API do Supabase corta TODA resposta num teto de linhas (1000) e não
// avisa: chega status 200 com a lista incompleta. Em cima de dinheiro isso
// vira número errado com cara de certo — foi assim que o saldo de uma conta
// com 1.056 lançamentos apareceu R$ 36 mil acima do banco: o app leu os
// 1.000 mais recentes e as 56 saídas mais antigas simplesmente não existiam
// para ele. Toda leitura que precisa da tabela INTEIRA passa por aqui.
//
// A ordenação de quem pagina tem que ser TOTAL — um desempate único (o id)
// além do critério visível. Sem isso, duas linhas com a mesma data podem
// trocar de posição entre uma página e outra, e aí uma volta duplicada
// enquanto a outra não volta nunca.
const PAGINA = 1000;

export async function paginarTudo<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const tudo: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await pagina(de, de + PAGINA - 1);
    if (error) throw error;
    const lote = data ?? [];
    tudo.push(...lote);
    // Página incompleta = acabou. Evita uma requisição extra no caso exato
    // do total ser múltiplo de PAGINA (aí a próxima volta vazia e para).
    if (lote.length < PAGINA) return tudo;
  }
}
