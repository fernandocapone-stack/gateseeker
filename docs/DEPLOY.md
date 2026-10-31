# Deploy da página hospedada (Vercel + Supabase)

Roteiro para o PO, todo pelos painéis. Nenhuma chave entra no repositório nem em conversa; elas vão direto do painel do Supabase para as variáveis de ambiente do Vercel.

Estado: projeto Vercel `gateseeker` criado em 2026-10-28 (conta pessoal, plano Hobby, Root Directory `web`), publicado em `https://gateseeker.vercel.app`, com Vercel Authentication ligada até a área autenticada existir.

## 1. Supabase: projeto

1. `supabase.com` → New project. Nome `gateseeker`, região mais próxima dos usuários (East US serve para o Brasil e para os EUA). O painel pede uma senha do banco: guarde no gerenciador de senhas; a engenharia nunca precisa dela.
2. Espere o projeto ficar pronto (um a dois minutos).

## 2. Supabase: esquema

1. Menu SQL Editor → New query.
2. Cole o conteúdo de `supabase/migrations/20261028000000_init.sql` (abra o arquivo no GitHub e use o botão de copiar) e clique em Run. Deve terminar sem erro ("Success. No rows returned").
3. Conferência: menu Table Editor deve mostrar `reports`, `scan_quota` e `waitlist`, cada uma com o cadeado de RLS ligado.
4. Repita os passos 1 e 2 com `supabase/migrations/20261029000000_events.sql` (contadores do funil de login, 2026-10-29). Conferência: a tabela `events` aparece com o cadeado de RLS. **Até esta migração ser aplicada, a página continua funcionando, mas os contadores não são gravados** (o envio falha em silêncio).
5. Repita os passos 1 e 2 com `supabase/migrations/20261031000000_scans.sql` (histórico de análises no servidor, Sprint 6). Conferência: a tabela `scans` aparece com o cadeado de RLS. **Até esta migração ser aplicada, as análises continuam funcionando e o Dashboard mostra a cópia do navegador**, com um aviso de que o histórico da conta não pôde ser carregado.

Como ler o funil: Table Editor → `events`. Cada linha é um dia (UTC) e um tipo: `login_view` (página de login aberta por quem não está logado), `login_start` (clique em "Continue with GitHub") e `signin_complete` (voltou do GitHub logado). Abandono no login = 1 − `signin_complete` ÷ `login_view`, somando os dias. A regra da decisão 1 do `docs/ROADMAP.md`: acima de 40% em 2 semanas ou 100 visitas, reabrir análises anônimas com limite.

## 3. Supabase: login com GitHub

1. Menu Authentication → Sign In / Providers → GitHub. Ligue e copie a **Callback URL** mostrada (termina em `/auth/v1/callback`).
2. No GitHub: organização `gateseeker-dev` → Settings → Developer settings → OAuth Apps → New OAuth App.
   - Application name: `Gateseeker`
   - Homepage URL: `https://gateseeker.vercel.app`
   - Authorization callback URL: a URL copiada no passo 1
   - Enable Device Flow: desligado
3. Clique em Register, depois em Generate a new client secret. Copie o Client ID e o Client Secret para os dois campos da tela do Supabase e salve. O segredo não aparece de novo no GitHub; se perder, gere outro.
4. Ainda em Authentication → URL Configuration: Site URL `https://gateseeker.vercel.app`; em Redirect URLs adicione `https://gateseeker.vercel.app/**` e, para os previews, `https://*-fernando-capone.vercel.app/**` (o sufixo é o que o Vercel mostra nas URLs de preview; ajuste se for outro).

## 4. Supabase: chaves

Menu Project Settings → API Keys (as chaves novas, `sb_publishable_…` e `sb_secret_…`; não crie chaves extras, use as "default"). A URL do projeto é montada a partir do Project ID mostrado em Project Settings → General: `https://<Project ID>.supabase.co`. Três valores, cada um vai para uma variável no Vercel:

| No Supabase | Variável no Vercel | Pública? |
|---|---|---|
| Project URL | `SUPABASE_URL` | sim |
| Publishable key `sb_publishable_…` (antiga `anon`) | `SUPABASE_ANON_KEY` | sim (vai para o navegador) |
| Secret key `sb_secret_…` (antiga `service_role`; botão do olho para revelar, depois copiar) | `SUPABASE_SERVICE_ROLE_KEY` | **não**: só a função no Vercel a usa |

As chaves antigas em formato JWT (aba Legacy) também funcionam, mas as novas podem ser trocadas sem derrubar o projeto.

## 5. Vercel: variáveis de ambiente

Projeto `gateseeker` → Settings → Environment Variables → Add. Para cada linha abaixo, marque os três ambientes (Production, Preview, Development), salvo nota em contrário.

| Nome | Valor | Observação |
|---|---|---|
| `SUPABASE_URL` | Project URL | |
| `SUPABASE_ANON_KEY` | anon key | |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key | marque "Sensitive" |
| `CRON_SECRET` | 32+ caracteres aleatórios (o botão "Generate" do próprio Vercel serve) | marque "Sensitive"; o cron diário de limpeza se autentica com ele |
| `GATESEEKER_EXAMPLE_REPO` | opcional: URL de um repositório público do GitHub | o botão "Try an example" da tela de análise usa este repositório; sem a variável, usa `https://github.com/gateseeker-dev/gateseeker`. Um repositório de demonstração com achados reais mostra melhor o produto |
| `GATESEEKER_SCAN_LIMIT` | `10` | análises por usuário por hora; opcional |
| `GITHUB_TOKEN` | vazio por enquanto | decisão à parte: um token de leitura mínimo sobe o limite da API do GitHub de 60 para 5000 chamadas por hora |

Depois de salvar, Deployments → o deploy mais recente → menu ⋯ → Redeploy, para a função ler as variáveis novas.

## 6. Vercel: proteção

Enquanto a área autenticada não existir, Settings → Deployment Protection → Vercel Authentication ligada para All Deployments. Quando a página tiver login próprio, desligar para Production e manter para Preview.

## 7. Conferência depois do deploy

- `https://gateseeker.vercel.app/api/config` responde `{"ok":true,"auth":{"mode":"supabase",...}}` (sem a service_role).
- Entrar com GitHub em `/login`, analisar um repositório público em `/app`, abrir o relatório salvo pelo link `/r/<id>`.
- No relatório, a linha de fontes mostra `gateseeker-advisories: bundled (N approved, digest …)`. Se aparecer `none` ou a limitação "No curated advisory set was available", o `dist/advisories.json` não entrou no pacote da função: a página está consultando só o OSV.
- Supabase → Table Editor → `reports` mostra a linha; `scan_quota` mostra o contador.
- Vercel → Settings → Cron Jobs lista `/api/cron/cleanup` às 03:00 UTC.

## Custos e limites que importam

- Vercel Hobby: uso não comercial; funções de até 300 s; 100 GB de tráfego. Ao cobrar, Pro (US$ 20 por usuário por mês).
- Supabase Free: 500 MB, 50.000 usuários ativos por mês, pausa após 7 dias sem atividade (o cron diário evita). Pro US$ 25 por mês.
- GitHub API anônima: 60 chamadas por hora por IP de saída, compartilhado entre funções do Vercel; cada análise nova usa 2 chamadas, repetições do mesmo commit em 24 h usam 2 e nenhum download. `GITHUB_TOKEN` resolve quando apertar.
