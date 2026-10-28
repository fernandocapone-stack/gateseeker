# Validação da Sprint 4: o serviço web em repositórios reais

> Rodada 1 em 2026-10-28, **local**: o mesmo código do serviço que vai para o Vercel (`src/web/service.ts`, chamado como a função o chama), na máquina da engenharia, contra GitHub e OSV reais. A rodada 2, depois do deploy, repete os mesmos repositórios pela página publicada e preenche a última coluna. Lista aprovada pelo PO em 2026-10-28.

## Repositórios

Cinco projetos públicos gerados com Lovable ou Bolt, escolhidos entre candidatos com lockfile e Supabase, sem repetir os da Sprint 1, e cinco repositórios grandes para a recusa por tamanho.

| # | Repositório | Gerador | Commit | Por quê |
|---|---|---|---|---|
| 1 | gsm-fullweb/careconnect | Lovable | `e515b3d` | 18 arquivos Supabase, 6 edge functions, 54 MB no GitHub: testa os limites |
| 2 | 0xaje/LastBatch | Lovable | `5c251e6` | Supabase, pequeno, atualizado em 2026-10 |
| 3 | mugisha-gordon/semkat-hub | Lovable | `49c972a` | Supabase, `.env` commitado, Firebase |
| 4 | Ramadan82/bluvill-connect-hub | Lovable | `a3aa757` | Supabase, `.env` commitado, dependências de 2025 |
| 5 | hi0001234d/nexpath | Bolt | `ce927d4` | Outro gerador, 358 estrelas, 35 MB, 1200 arquivos |
| G | vercel/next.js, laravel/framework, microsoft/vscode, facebook/react, nodejs/node | — | — | Devem ser recusados por tamanho, rápido e com mensagem clara |

## Método

1. Serviço: `scanGitHubRepository({ url })` com os limites padrão, sem baseline, exatamente como `web/api/scan.ts` chama. Registrados tempo total e por etapa (download, extração, análise), arquivos extraídos, veredito, contagens e a lista de ids de achados.
2. CLI: clone do mesmo repositório no mesmo commit em pasta isolada, `gateseeker scan <pasta> --format json`, lista de ids de achados.
3. Critério: os conjuntos de ids têm que ser **idênticos**. O id de um achado inclui a regra ou a vulnerabilidade e o assunto (pacote@versão ou arquivo:linha), então igualdade de conjuntos significa os mesmos achados nos mesmos lugares.

Nenhum código dos projetos foi executado em nenhuma das duas vias. Nenhum segredo encontrado é reproduzido aqui; os achados de segredo citam só a regra.

## Resultado, rodada 1 (local)

| Repositório | Serviço | CLI | Idênticos | Tempo do serviço | Observação |
|---|---|---|---|---|---|
| careconnect | **recusado**: arquivo comprimido acima de 50 MB | fail, 87 achados (3 P1, 16 P2) | n/a | 3,3 s até a recusa | Ver "Limites" abaixo |
| LastBatch | pass, 42 achados (0 P1, 0 P2, 21 P3, 21 P4) | pass, 42 | **sim** | 17,3 s (download 0,3 s, extração 0,05 s, análise 16,3 s) | 272 versões consultadas no OSV |
| semkat-hub | fail, 152 achados (9 P1, 73 P2), `GSK-SECRET-002` e `GSK-FIREBASE-001` | fail, 152 | **sim** | 43,4 s (0,7 s, 0,2 s, 41,4 s) | 753 versões consultadas; 4 avisos de pacotes de workspace não consultados, declarados no relatório |
| bluvill-connect-hub | fail, 76 achados (1 P1, 3 P2) | fail, 76 | **sim** | 22,8 s (0,8 s, 0,1 s, 21,2 s) | |
| nexpath | fail, 76 achados (6 P1, 14 P2) | fail, 76 | **sim** | 26,0 s (1,2 s, 0,7 s, 23,5 s) | 1 arquivo binário de 8 MB pulado na extração (um GIF) |
| 5 grandes | recusados em 0,3 a 0,6 s cada | — | — | | "vercel/next.js is about 2548 MB; the hosted analysis accepts repositories up to 100 MB. Run the CLI locally for larger projects." |

Quatro de quatro repositórios analisados com achados idênticos aos da CLI. Nenhuma consulta ao OSV falhou. O tempo é dominado pela análise de dependências (consultas ao OSV, 5 em paralelo), não pelo download nem pela extração.

## Limites: o que a rodada ensinou e o que mudou

1. **Arquivo grande dentro do repositório não derruba a análise.** Na primeira execução, `nexpath` foi recusado inteiro por causa de um GIF de 8 MB. O scanner ignora binários de qualquer forma, então o leitor de tar passou a **pular** arquivos acima do limite por arquivo (8 MB) em vez de recusar o arquivo todo, e o relatório da página informa quantos foram pulados. O limite total descomprimido (200 MB) e o de quantidade de arquivos continuam fatais.
2. **O tamanho que o GitHub informa não é o tamanho do download.** `careconnect` aparece com 54 MB no GitHub, abaixo do limite de 100 MB, mas seu arquivo comprimido passa de 50 MB (o limite de download subiu de 25 para 50 MB nesta rodada e ainda não bastou). O número do GitHub é o tamanho do histórico `.git`, um indicador frouxo; o limite real é o do download, e a mensagem de recusa diz isso e aponta a CLI. Decisão registrada: 50 MB comprimidos é o teto da página nesta sprint; subir mais pressiona memória e tempo da função sem beneficiar o público-alvo, cujos projetos ficam entre 0,4 e 17 MB nesta amostra. O PO pode rever com dados de uso.
3. **Tempo.** O pior caso da amostra, 43 s, cabe no limite de 120 s do serviço e nos 300 s da função. Se a validação pós-deploy mostrar tempos maiores a partir do Vercel (latência até o OSV), a primeira alavanca é a concorrência das consultas (5 hoje), não o limite de tempo.

## Rodada 2 (pela página publicada)

Pendente do deploy. Repetir os dez repositórios pela página, anotar o tempo visto pelo usuário e confirmar que o link `/r/<id>` abre o mesmo relatório em outro navegador.
