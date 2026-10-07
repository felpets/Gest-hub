# Auto-categorização por histórico — o que mudou e como testar

Feature: quando você **aprova** a categoria de uma transação, o sistema **aprende**
(estabelecimento → categoria) e, nas próximas importações, **pré-sugere** a categoria.
A sugestão **nunca** vira categoria confirmada sozinha — você sempre aprova antes.

> As migrations vivem em `supabase/` (rodadas no **SQL Editor** do projeto financeiro
> `ieqkhecsyarszhhonaor`, na ordem). As **14→18 já foram aplicadas** neste projeto. Se for
> recriar do zero (outro ambiente), rode na ordem abaixo.

## 1) Banco — migrations (nesta ordem)

1. `supabase/14_categorizacao.sql` — tabela `regras_categorizacao` (regras aprendidas/manuais) + RLS + índice único idempotente + trigger de tenant.
2. `supabase/15_movimentacoes_revisao.sql` — colunas novas em `movimentacoes`:
   `categoria_sugerida_id` (palpite), `categoria_status` (`pendente`/`confirmada`, default `confirmada`), `lote_id`.
3. `supabase/16_funcoes_categorizacao.sql` — funções/RPCs: normalização, caminho da categoria,
   `fn_categorizar_pendentes` (sugere) e `fn_aprovar_lote` (confirma + aprende).
4. `supabase/17_fuzzy_match.sql` — normalização mais forte (tira `PAGO`/`PAGAMENTOS`/`SISPAG`,
   revelando o fornecedor real) + **match fuzzy** (`pg_trgm`/`word_similarity`): casa por "contém
   **OU** parecido". Limiar único e tunável em `fn_trgm_threshold()` (0.5).
5. `supabase/18_semear_regras_historico.sql` — **aprender do histórico** (cold-start):
   `fn_semear_regras_do_historico` varre as transações já confirmadas e cria regras com **filtro de
   qualidade** (chave ≥4 letras, ≥2 ocorrências, ≥70% numa categoria) — evita chaves tóxicas como
   `PAGO`. Inclui um bloco one-time que semeia todas as empresas.

Todos são **idempotentes** (pode rodar de novo sem estragar). São **aditivos**: as
transações que já existiam ficam `confirmada` por padrão e **continuam contando** em
dashboard/relatórios/saldo, sem nada sobrescrito.

> No app, o botão **"Aprender do histórico"** (tela **Revisão**) roda o mesmo seed sob demanda e
> re-sugere os pendentes. Validado no banco real: criou ~17 regras limpas do histórico e
> pré-categorizou 3 das 5 pendentes (ex.: `BARTE`→Receita, `AUTOM`→Receita) sem ensino manual.

### Por que é seguro
- **RLS respeitada**: as funções rodam como o usuário (`SECURITY INVOKER`); cada empresa só
  mexe nos próprios dados. Regras **globais** (`empresa_id IS NULL`) são legíveis por todos,
  mas só o **master** as cria.
- **Aprendizado por empresa**: como `categoria_id` referencia o `plano_contas` (que é por
  empresa), as regras aprendidas são gravadas **específicas da empresa**.
- **Idempotência**: regra tem índice único `(empresa_id, padrao, tipo_match)`; aprovar 2x não
  duplica regra nem reprocessa quem já está confirmada (a confirmação só vale se a linha ainda
  estiver `pendente`, então clique duplo / aprovação concorrente não conta acerto duas vezes).
- **Coerência de tenant**: ao aprovar, a categoria escolhida é validada como sendo do plano de
  contas **da própria empresa**; uma sugestão que (por uma regra global) aponte para categoria
  de outra empresa é **ignorada** em vez de gravar uma transação confirmada sem categoria. Há
  também um trigger que impede gravar regra com `categoria_id` de outra empresa.

## 2) App — fluxo novo

- **Importar** (`/importar`): envia OFX/CSV/Excel. As transações entram como **pendentes**
  (sem categoria confirmada) e o sistema já roda a **sugestão**. Você cai direto na revisão.
- **Revisão** (`/revisao`, novo item no menu com badge de pendentes): cada linha mostra a
  sugestão (badge “Sugerida”) num seletor Categoria → Subcategoria. Você pode **aceitar,
  corrigir ou escolher** as sem sugestão, e **aprovar uma a uma ou todas em lote**.
  Ao aprovar: a categoria vira **confirmada** e o sistema **aprende** a regra.
- Enquanto **pendente**, a transação **não aparece** no extrato nem conta em relatórios/saldo.

## 3) Como testar (passo a passo)

Pré-requisito: ter um **plano de contas** cadastrado (o seed `03_plano_contas.sql` já serve).

**Ensinar o sistema (1º import):**
1. Vá em **Importar** e envie `exemplos-teste/extrato-1-maio.ofx`.
2. Você cai em **Revisão**. Como ainda não há regras, nada vem sugerido.
3. Categorize: `UBER *TRIP...` → **Operacional** (ou crie/escolha “Transporte”);
   `VIVO FIBRA...` → **Operacional**; `META PLATFORMS...` → **Marketing / Meta Ads**;
   `AMAZON AWS...` → **Tecnologia / Infra**; `PIX ... LAPORTEC` → **Receita Operacional / Mensalidades**.
4. Clique **Aprovar todas com categoria**. Elas somem de Revisão e aparecem em **Movimentações**.

**Ver a mágica (2º import):**
5. Em **Importar**, envie `exemplos-teste/extrato-2-junho.ofx`.
6. Na **Revisão**, `PAG*Uber 062025`, `VIVO FIBRA 062025` e `META PLATFORMS ANUNCIOS` já
   vêm com a categoria **Sugerida** (aprendida do passo 3), mesmo com texto diferente do mês
   anterior. `PADARIA DOCE PAO` fica **sem sugestão** (nunca visto) — você escolhe.
7. Ajuste o que quiser e **Aprove**. Cada aprovação reforça a regra (sobe o `acertos`).

**Excel/CSV (categoria do arquivo vira sugestão):**
8. Envie `exemplos-teste/planilha-modelo.csv`. As linhas com a coluna **categoria**
   preenchida (ex.: `Tecnologia / SaaS`) entram **já sugeridas** com aquela categoria; as
   vazias usam as regras aprendidas (o `PAG*Uber` vem como o que você ensinou). Aprove.

### Conferir no banco (opcional)
```sql
-- regras que o sistema aprendeu
select padrao, tipo_match, origem, acertos,
       public.fn_caminho_categoria(categoria_id) as categoria
from public.regras_categorizacao
order by atualizado_em desc;

-- ver a normalização de uma descrição
select public.fn_normaliza_descricao('PAG*Uber 062025');  -- => UBER
```

## 4) Futuro (já com gancho no código)
- **Fuzzy match** (`pg_trgm`) quando “contém” não bastar — instruções no fim de
  `16_funcoes_categorizacao.sql`.
- **Regras globais** curadas pelo master (a coluna `empresa_id` nullable já suporta).
- `tipo_match` já aceita `exato`/`regex` no schema (só falta plugar no matcher).
