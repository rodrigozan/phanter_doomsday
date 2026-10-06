# Adendo URS — Executor Antigravity CLI (`agy`)

Este adendo estende o arquivo `URS-orquestrador-claude-code.md`. Todas as restrições e requisitos daquele documento continuam valendo, exceto onde este adendo disser o contrário. Leia os dois antes de implementar.

---

## 1. Objetivo

Passar a existir dois executores:

- `claude_code`: já implementado (binário `claude`).
- `antigravity`: novo, usando o Antigravity CLI (binário `agy`) em modo headless, com modelos Gemini.

O Jev decide qual executor atende cada tarefa e qual modelo dentro dele. O Jev continua apenas classificando.

## 2. Premissas e restrições

- O app NÃO controla a IDE Antigravity (interface gráfica). Apenas o binário `agy`.
- Sem API key do Google. O `agy` usa o login que o usuário já fez nele.
- O modo headless do `agy` tem comportamento instável, conforme relatos nos issues do repositório oficial `google-antigravity/antigravity-cli` (#76, #318, #548). Por isso, os cuidados da seção 5 são obrigatórios.
- Não usar o `gemini` CLI legado.
- Mantém: `yarn`, um comando por linha, sem `&&`, sem comentários no código, JavaScript ESM.

## 3. Roteamento (Jev)

A chamada ao Jev continua única e paralela. Acrescentar três perguntas Noul às duas existentes (`tipo` e `complexidade`):

- `interface_visual` (Noul): a tarefa envolve interface, layout, CSS, componente visual ou design de tela.
- `multimodal` (Noul): a tarefa depende de imagem, captura de tela, vídeo ou navegação em navegador.
- `contexto_grande` (Noul): a tarefa exige ler e relacionar uma grande parte do código do projeto.

Decisão do executor, avaliada nesta ordem:

1. Modo manual do usuário (`claude_code` ou `antigravity`) vence sempre.
2. Confiança baixa em `tipo` ou `complexidade` (abaixo do limiar configurado): `claude_code`.
3. Qualquer uma das três perguntas Noul acima de 0.7: `antigravity`.
4. Qualquer outro caso: `claude_code`.

Decisão do modelo dentro do executor:

- `claude_code`: regra já existente (haiku, sonnet, opus).
- `antigravity`, pela complexidade: score 0 usa o modelo Flash configurado; score 1 usa o Flash de nível alto; score 2 usa o modelo Pro configurado.

Requisitos:

- Os limiares (0.5 e 0.7) são configuráveis e valem apenas como ponto de partida. Os critérios acima são hipóteses e devem ser validados com tarefas reais.
- A decisão continua em função pura testável com `node --test`, recebendo as respostas do Jev e a configuração, e devolvendo `{ executor, modelo }`.
- Gravar o resultado bruto do Jev junto da execução, incluindo as três novas probabilidades.
- Se o Jev falhar: `claude_code` com `sonnet`, com aviso na interface.

## 4. Mapa de modelos do Antigravity

- Criar `modelos.js` com um objeto que liga `flash`, `flash_alto` e `pro` ao rótulo exato do modelo no `agy`.
- Os rótulos devem ser copiados da saída de `agy models` executado em um terminal interativo. Não inventar rótulos.
- Os rótulos devem ser editáveis na tela de configurações.

## 5. Execução do `agy` (`agy.js`)

Contrato obrigatório, derivado dos problemas conhecidos do modo headless:

- Localizar o binário por `%LOCALAPPDATA%\agy\bin\agy.exe` e, se não existir, por `agy` no PATH.
- Antes de implementar, rodar `agy --help` e confirmar as flags disponíveis na versão instalada, principalmente `--print`, `--print-timeout`, `--model` e `--dangerously-skip-permissions`. Registrar no README qualquer divergência.
- Usar `spawn` com array de argumentos e sem `shell`, para o prompt não sofrer problemas de aspas.
- O `stdin` do processo deve ser ignorado (`stdio: ["ignore", "pipe", "pipe"]`). Um stdin aberto trava o `agy` indefinidamente.
- `--print` consome o próximo argumento como prompt. Portanto, `--print "<prompt>"` deve ser o último par de argumentos, depois de qualquer outra flag.
- Passar o modelo escolhido com `--model` somente se `agy --help` confirmar a flag. Caso contrário, registrar a limitação e usar o modelo definido em `~/.gemini/antigravity-cli/settings.json`, avisando o usuário.
- Timeout externo no Node, obrigatório (padrão 30 minutos), encerrando a árvore de processos com `taskkill /pid <pid> /T /F`. O `--print-timeout` do `agy` não é confiável e não substitui este timeout.
- Antes de cada execução, verificar e encerrar processos `agy.exe` órfãos, pois um processo zumbi mantém o lock e trava as execuções seguintes.
- Código de saída diferente de zero: erro, exibindo o `stderr`.
- Saída vazia com código zero NÃO é sucesso. Executar a recuperação abaixo.

Recuperação de resposta quando o `stdout` vier vazio:

1. Antes de rodar, guardar a contagem de linhas do `transcript.jsonl` da conversa atual do projeto, se existir.
2. Depois de rodar, ler `~/.gemini/antigravity-cli/cache/last_conversations.json` e obter o id da conversa pela chave do `cwd` do projeto.
3. Ler `~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl`, considerar apenas linhas novas e pegar a última com `source` igual a `MODEL` e `type` igual a `PLANNER_RESPONSE`. O texto está em `content`.
4. Sem linha nova, tratar como erro: "Antigravity não retornou resposta. Possível cota esgotada ou falha de autenticação. Veja o cli.log em ~/.gemini/antigravity-cli".

Permissões:

- O modo headless do `agy` ignora `permissions.allow` e fica parado em qualquer ação que peça confirmação.
- Criar a opção por usuário "Permitir ações sem confirmação no Antigravity", desligada por padrão. Ligada, acrescenta `--dangerously-skip-permissions`.
- Com a opção desligada, a interface deve avisar que tarefas que editam arquivos ou rodam comandos podem travar até o timeout.

Sessão:

- O `agy` em modo print pode continuar a conversa anterior da pasta, e o app não controla isso. Não guardar `session_id` para o executor `antigravity`.
- A ação "Nova conversa" afeta apenas o `claude_code`. A interface deve informar isso quando o executor for `antigravity`.

Ambiente:

- Na inicialização, rodar `agy --version`. Se a versão for menor que 1.0.15, avisar o usuário para atualizar.
- Se o `agy` não existir ou não estiver logado, exibir orientação para abrir o `agy` interativamente e concluir o login. O executor `antigravity` fica indisponível e o roteamento usa apenas `claude_code`.

## 6. Fallback entre executores

- Se o executor escolhido falhar por erro (não por cancelamento), o app tenta o outro executor uma única vez, com o modelo padrão dele.
- A execução registra o executor final em `executor` e o inicial em `fallback_de`.
- A interface informa claramente quando houve fallback.
- Se o executor `antigravity` estiver indisponível (seção 5, Ambiente), não há fallback para ele.

## 7. Mudanças no banco

```sql
alter table execucoes add column executor text not null default 'claude_code';
alter table execucoes add column fallback_de text;

alter table configuracoes add column modo_executor text not null default 'automatico';
alter table configuracoes add column limiar_noul numeric not null default 0.7;
alter table configuracoes add column agy_sem_confirmacao boolean not null default false;
alter table configuracoes add column agy_modelos jsonb not null default '{}'::jsonb;
```

Valores válidos de `modo_executor`: `automatico`, `claude_code`, `antigravity`.

## 8. Interface

- Seletor de executor na tela de execução: Automático, Claude Code, Antigravity.
- Após a execução, exibir executor e modelo usados.
- Histórico mostra o executor de cada execução e se houve fallback.
- Tela de configurações ganha: limiar do Noul, opção de ações sem confirmação do Antigravity e os rótulos de modelos do Antigravity.

## 9. Critérios de aceite

1. `agy models` rodado pelo app, ou os rótulos configurados, correspondem aos nomes exibidos no `agy` interativo.
2. Tarefa visual ("ajuste o layout da tela de login para ficar responsivo") é roteada para `antigravity`; tarefa de lógica de backend é roteada para `claude_code`.
3. O processo `agy` é iniciado com stdin ignorado e `--print "<prompt>"` como último par de argumentos (verificável em teste).
4. Com `stdout` vazio e transcript atualizado, o app exibe a resposta recuperada do `transcript.jsonl`, sem usar resposta de execução anterior.
5. Com `stdout` vazio e sem transcript novo, o app exibe a mensagem de erro da seção 5 e não declara sucesso.
6. Cancelar e estourar o timeout encerram o `agy` e não deixam `agy.exe` órfão.
7. Falha no executor escolhido dispara fallback único para o outro, com registro de `fallback_de`.
8. Sem `agy` instalado ou logado, o app funciona normalmente só com `claude_code` e informa o motivo.
9. Testes da função de decisão `{ executor, modelo }` passam com `node --test`.
10. Nenhuma referência a API key do Google ou do Anthropic no código.

## 10. Ordem de implementação

1. Rodar `agy --help`, `agy --version` e `agy models` e registrar os resultados no README.
2. Alterações de banco (seção 7).
3. `modelos.js` e `agy.js`, com teste manual em um projeto de exemplo.
4. Recuperação via `transcript.jsonl` e tratamento de erros.
5. Novas perguntas no Jev e função pura de decisão com testes.
6. Integração no `orquestrador.js`, incluindo fallback.
7. Interface: seletor, histórico e configurações.
8. Verificações de ambiente.

## 11. Fora do escopo

- Controlar a IDE Antigravity.
- Streaming da saída do `agy`.
- Usar modelos Claude via Antigravity.
- Continuidade de sessão controlada no `agy`.