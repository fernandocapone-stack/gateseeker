# Publicação: passo a passo para o PO

Este é o roteiro para a primeira publicação pública (`gateseeker@1.0.0-beta.1`) e para as seguintes. Os passos marcados **[PO]** só você pode fazer, porque envolvem a sua conta no npm e a visibilidade do repositório. Os demais a engenharia executa.

## Uma vez só

1. **[PO] Conta no npm.** Crie (ou use) uma conta em https://www.npmjs.com/signup com e-mail verificado e autenticação em dois fatores ligada (obrigatória para publicar com proveniência).
2. **[PO] Reservar o nome.** Depois de logado, abra https://www.npmjs.com/package/gateseeker e confirme que continua livre (estava livre em 2026-10-27). O nome fica reservado na primeira publicação, que o workflow faz; não é preciso publicar nada à mão.
3. **[PO] Publicação confiável (trusted publishing).** Em https://www.npmjs.com/settings/<sua-conta>/packages não há o pacote ainda; a configuração de trusted publishing é feita no pacote depois da primeira publicação. Para a primeira, o npm exige um token de publicação. Duas opções:
   - **Opção A, recomendada:** eu publico a primeira versão a partir da sua máquina, com você logado (`npm login`), em um terminal em que eu digito só `pnpm publish --access public --provenance`? Não: a proveniência exige CI. Então a opção A real é: você cria um **token de automação** em https://www.npmjs.com/settings/<sua-conta>/tokens (tipo "Granular", permissão de publicar, só para o pacote `gateseeker`, validade curta, 7 dias) e o guarda como segredo `NPM_TOKEN` em https://github.com/fernandocapone-stack/gateseeker/settings/secrets/actions. Eu altero o workflow para usar esse token na primeira publicação. Depois da primeira versão no ar, você configura o trusted publishing no pacote (Settings do pacote, "Publishing access", adicionar GitHub Actions com repositório `fernandocapone-stack/gateseeker` e workflow `release.yml`), apaga o token, e eu removo o segredo do workflow. A partir daí nenhuma credencial fica guardada.
   - **Opção B:** pular a proveniência na primeira versão e publicar manualmente da sua máquina. Não recomendo: a primeira versão de uma ferramenta de supply chain sem proveniência é uma contradição.
4. **[PO] Repositório público.** Em https://github.com/fernandocapone-stack/gateseeker/settings, seção "Danger Zone", "Change visibility". Antes disso:
   - Revise o histórico de commits uma última vez (eu confirmo a cada commit que não há segredo real; a revisão final é sua).
   - Confirme a descrição do repositório e, se quiser, os tópicos (`security`, `supply-chain`, `github-action`).
   - A tagline provisória "Security gate for AI-generated code" vai aparecer; está marcada como provisória no README.
5. **[PO] Permitir que a Action seja usada por outros.** Repositórios públicos já permitem. Nada a fazer.

## A cada versão

1. Engenharia: atualiza `version` em `package.json` e a entrada `version` padrão em `action.yml` (as duas devem ser iguais), atualiza o README se houver entradas novas, abre PR, CI verde, merge.
2. Engenharia: cria e envia a tag `vX.Y.Z` na main. O workflow `release.yml` roda `pnpm check` e os testes de navegador, confere que a tag bate com o `package.json`, confere a lista de arquivos do pacote, publica no npm com proveniência, cria a release no GitHub e move a tag flutuante (`v1`) para a versão nova.
3. PO: confere em https://www.npmjs.com/package/gateseeker que a versão apareceu com o selo "Provenance" e em https://github.com/fernandocapone-stack/gateseeker/releases que a release existe.

## Como alguém verifica a proveniência

```bash
npm audit signatures
```

num projeto que tenha o `gateseeker` instalado mostra que o pacote foi assinado e construído pelo workflow deste repositório a partir de um commit específico.

## Primeira versão: o que eu faço quando você disser que os passos [PO] 1, 3 (token) e 4 estão feitos

- Ajusto `release.yml` para usar `NPM_TOKEN` só nesta primeira publicação.
- Envio a tag `v1.0.0-beta.1`.
- Acompanho o workflow e confirmo o pacote e a release.
- Peço que você configure o trusted publishing e apague o token; removo o uso do segredo e deixo o workflow só com OIDC.
