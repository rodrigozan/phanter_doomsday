# URS — Orquestrador Claude Code

Documento de requisitos para implementação pelo Claude Code. Leia o documento inteiro antes de escrever qualquer código. Implemente na ordem da seção 12 e valide os critérios de aceite da seção 11 ao final de cada fase.

---

## 1. Objetivo

Aplicativo desktop que controla o Claude Code instalado na máquina do usuário. Para cada tarefa digitada, o app usa o Jev (TypeSafe) para escolher o modelo Claude mais adequado (haiku, sonnet ou opus), executa o Claude Code em modo headless na pasta do projeto selecionado e exibe o resultado. Projetos, sessões e histórico ficam no Supabase.

## 2. Premissas e restrições obrigatórias

- O app NÃO usa `ANTHROPIC_API_KEY`. A execução é feita pelo binário `claude` com o login já existente do usuário (assinatura).
- O app NÃO usa o `@anthropic-ai/claude-agent-sdk` nem o `@anthropic-ai/sdk`.
- Ao iniciar o processo `claude`, a variável `ANTHROPIC_API_KEY` deve ser removida do ambiente do processo filho.
- O Jev apenas classifica. Quem gera código e texto é sempre o Claude Code.
- Chaves e acesso ao sistema de arquivos ficam exclusivamente no processo principal do Electron. A interface nunca recebe chaves.
- Gerenciador de pacotes: `yarn`. Nunca `npm`.
- Dependências normais em uma única linha `yarn add`; dependências de desenvolvimento em uma linha `yarn add -D` separada.
- Nunca encadear comandos com `&&`. Um comando por linha, em qualquer script ou documentação gerada.
- Sem comentários explicativos no código.
- JavaScript puro com ESM (`"type": "module"`). O preload deve ser `preload.cjs`.
- Não citar nenhum nome de empresa no código, README ou interface além de "Phanter AI", quando necessário.

## 3. Stack

| Camada | Tecnologia |
| --- | --- |
| Desktop | Electron |
| Interface | HTML, CSS e JavaScript puro (renderer) |
| Execução do agente | Binário `claude` via `child_process.spawn` |
| Roteamento de modelo | `@typesafe-ai/sdk` (Jev) |
| Backend de dados e autenticação | Supabase (`@supabase/supabase-js`) |
| Empacotamento | `electron-builder` |

Dependências:

```
yarn add @supabase/supabase-js @typesafe-ai/sdk dotenv
```

```
yarn add -D electron electron-builder
```

## 4. Estrutura de arquivos esperada

```
orquestrador-claude-code/
├── package.json
├── .env
├── .env.example
├── main.js
├── preload.cjs
├── orquestrador.js
├── roteador.js
├── claude.js
├── supabase.js
├── renderer/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── supabase/
    └── schema.sql
```

Responsabilidades:

- `main.js`: janela, handlers IPC, ciclo de vida.
- `preload.cjs`: expõe `window.api` via `contextBridge`.
- `roteador.js`: chama o Jev e devolve `haiku`, `sonnet` ou `opus`.
- `claude.js`: spawn do `claude`, parsing da saída, cancelamento.
- `supabase.js`: cliente Supabase e funções de acesso a dados.
- `orquestrador.js`: une roteador, claude e persistência.

## 5. Variáveis de ambiente

`.env.example`:

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
TYPESAFE_API_KEY=
```

Não existe `ANTHROPIC_API_KEY` neste projeto.

## 6. Requisitos funcionais

### 6.1 Autenticação

- RF-01: O usuário deve fazer login com e-mail e senha via Supabase Auth.
- RF-02: O app deve permitir criar conta (e-mail e senha) via Supabase Auth.
- RF-03: A sessão deve persistir entre aberturas do app. O refresh token deve ser guardado criptografado com `safeStorage` do Electron e restaurado no início.
- RF-04: O usuário deve poder sair (logout), apagando a sessão local.
- RF-05: Nenhuma tela além de login pode ser acessada sem sessão válida.

### 6.2 Projetos

- RF-06: O usuário deve adicionar um projeto escolhendo uma pasta pelo seletor nativo de diretório.
- RF-07: Cada projeto tem nome (padrão: nome da pasta) e caminho absoluto.
- RF-08: O usuário deve listar, renomear e remover projetos.
- RF-09: Ao remover um projeto, o histórico dele é removido em cascata. Nenhum arquivo em disco é tocado.
- RF-10: Antes de executar, o app deve validar que a pasta do projeto ainda existe.

### 6.3 Execução de tarefas

- RF-11: O usuário seleciona um projeto, digita a tarefa e clica em executar.
- RF-12: O app deve chamar o Jev com a tarefa e obter o modelo conforme a seção 7.
- RF-13: O app deve executar `claude` em modo headless na pasta do projeto, com o modelo escolhido, conforme a seção 8.
- RF-14: Se o projeto já tiver `session_id`, a execução deve usar `--resume` para continuar a conversa.
- RF-15: Ao terminar, o app deve salvar o novo `session_id` no projeto.
- RF-16: O app deve exibir o modelo escolhido, o resultado, a duração e o custo/uso retornados pelo `claude`, quando disponíveis.
- RF-17: Enquanto executa, a interface exibe estado "Executando" e o botão muda para "Cancelar".
- RF-18: Cancelar deve encerrar o processo `claude` e registrar a execução como cancelada.
- RF-19: Não pode haver duas execuções simultâneas no mesmo projeto. Uma segunda tentativa deve ser bloqueada com mensagem clara.
- RF-20: O usuário deve poder forçar manualmente o modelo (automático, haiku, sonnet ou opus). No modo automático, o Jev decide.
- RF-21: Em "Nova conversa", o app descarta o `session_id` do projeto e começa uma sessão limpa.

### 6.4 Histórico

- RF-22: Cada execução deve ser gravada com tarefa, modelo, resultado, status, duração e data.
- RF-23: A tela do projeto lista as execuções em ordem decrescente de data, com abertura do detalhe.
- RF-24: A gravação do histórico no Supabase não pode impedir a exibição do resultado ao usuário caso a gravação falhe. Nesse caso, avisar o erro de gravação.

### 6.5 Verificações do ambiente

- RF-25: Na inicialização, verificar se o comando `claude` existe no PATH. Se não existir, exibir tela de orientação para instalar o Claude Code.
- RF-26: Se o `claude` retornar erro de autenticação, exibir mensagem orientando o usuário a rodar `claude` no terminal e fazer `/login`.
- RF-27: Se `TYPESAFE_API_KEY` estiver ausente ou o Jev falhar, o app deve usar `sonnet` como fallback e avisar o usuário na interface.

### 6.6 Configurações

- RF-28: Tela de configurações com:
  - limiar de confiança do Jev (padrão 0.5);
  - lista de ferramentas permitidas (`allowedTools`) do Claude Code;
  - modo de permissão (`acceptEdits` por padrão; opções `default`, `acceptEdits`, `plan`).
- RF-29: As configurações ficam por usuário no Supabase.

## 7. Regras de roteamento (Jev)

Uma única chamada `client.systemOne` com as duas perguntas em paralelo.

State:

```json
{ "tarefa": "<texto digitado>" }
```

Perguntas:

- `tipo` (Choice): "Qual é o tipo principal desta tarefa de desenvolvimento?"
  - `ajuste_simples`: renomear, formatar, mudança pequena e localizada
  - `feature`: implementar funcionalidade ou corrigir bug em poucos arquivos
  - `refatoracao`: refatoração ampla, arquitetura ou mudança em muitos arquivos
  - `investigacao`: entender código, depurar problema difícil ou analisar causa raiz
- `complexidade` (Score, níveis 0 a 2):
  - 0: trivial, poucos minutos de trabalho
  - 1: moderada, exige entender vários trechos de código
  - 2: alta, exige planejamento e raciocínio profundo

Decisão, avaliada nesta ordem:

1. `tipo.confidence` ou `complexidade.confidence` abaixo do limiar configurado: `sonnet`.
2. `complexidade.score >= 2` ou `tipo.choice === "refatoracao"`: `opus`.
3. `tipo.choice === "ajuste_simples"` e `complexidade.score === 0`: `haiku`.
4. Qualquer outro caso: `sonnet`.

Requisitos:

- Os valores de modelo passados ao `claude` são os aliases `haiku`, `sonnet` e `opus`.
- A regra de decisão fica isolada e testável em uma função pura que recebe as respostas do Jev e o limiar.
- O resultado bruto do Jev (tipo, complexidade e confianças) deve ser gravado junto da execução para auditoria.
- Os limiares e regras devem ser validados com tarefas reais depois de prontos. Não tratar os valores iniciais como definitivos.

## 8. Execução do Claude Code

Comando base, executado com `spawn` na pasta do projeto (`cwd`):

```
claude -p --model <alias> --output-format json --permission-mode <modo>
```

- Com sessão existente, acrescentar `--resume <session_id>`.
- Com `allowedTools` configuradas, acrescentar `--allowedTools` com a lista.
- O prompt deve ser enviado pelo `stdin` e o `stdin` fechado em seguida.
- No ambiente do processo filho, remover `ANTHROPIC_API_KEY`.
- Capturar `stdout` e `stderr` separadamente.
- Código de saída diferente de zero: tratar como erro e exibir o `stderr`.
- Fazer `JSON.parse` do `stdout`. Ler `result` e `session_id`. Se o parse falhar, tratar como erro com a saída bruta no detalhe.
- No Windows, usar `shell: true` no `spawn` e encerrar a árvore de processos ao cancelar (`taskkill /pid <pid> /T /F`).
- Timeout configurável por execução (padrão 30 minutos), com encerramento do processo ao estourar.
- Antes de implementar, rodar `claude --help` na máquina e confirmar que as flags acima existem na versão instalada. Se alguma divergir, ajustar e registrar a diferença no README.

## 9. Modelo de dados (Supabase)

`supabase/schema.sql`:

```sql
create table projetos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  nome text not null,
  caminho text not null,
  session_id text,
  created_at timestamptz default now()
);

create table execucoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  projeto_id uuid not null references projetos(id) on delete cascade,
  tarefa text not null,
  modelo text not null,
  modo_modelo text not null default 'automatico',
  jev jsonb,
  status text not null default 'concluida',
  resultado text,
  duracao_ms integer,
  created_at timestamptz default now()
);

create table configuracoes (
  user_id uuid primary key default auth.uid() references auth.users(id),
  limiar_confianca numeric not null default 0.5,
  permission_mode text not null default 'acceptEdits',
  allowed_tools text[] not null default '{}',
  updated_at timestamptz default now()
);

alter table projetos enable row level security;
alter table execucoes enable row level security;
alter table configuracoes enable row level security;

create policy "projetos do dono" on projetos for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "execucoes do dono" on execucoes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "configuracoes do dono" on configuracoes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

Valores válidos de `execucoes.status`: `concluida`, `erro`, `cancelada`.

## 10. Requisitos não funcionais

- RNF-01 Segurança: `contextIsolation: true`, `nodeIntegration: false`, Content-Security-Policy restritiva no `index.html`, sem `eval`, sem scripts remotos.
- RNF-02 Segurança: o renderer só acessa o que o `preload.cjs` expõe. Nenhum canal IPC aceita caminho de arquivo arbitrário vindo da interface; caminhos de projeto vêm sempre do banco.
- RNF-03 Segurança: conteúdo vindo do resultado do `claude` deve ser inserido na interface como texto, nunca como HTML.
- RNF-04 Desempenho: a chamada ao Jev deve adicionar menos de 1 segundo ao início da execução em condições normais.
- RNF-05 Robustez: todo handler IPC trata erros e devolve mensagem legível. Nenhuma exceção não tratada pode derrubar o processo principal.
- RNF-06 Portabilidade: funcionar em Windows 10/11 como alvo principal. Código sem dependência de caminho específico de SO.
- RNF-07 Usabilidade: interface em português do Brasil.
- RNF-08 Manutenibilidade: funções puras separadas de efeitos colaterais; regra de roteamento coberta por testes simples executáveis com `node --test`.

## 11. Critérios de aceite

1. Login, logout e persistência de sessão funcionam; reabrir o app não pede login novamente.
2. Com `ANTHROPIC_API_KEY` ausente do ambiente, uma tarefa executa com sucesso usando o login do Claude Code.
3. Com `ANTHROPIC_API_KEY` definida no ambiente do sistema, o processo `claude` filho não a recebe (verificável imprimindo o ambiente do filho em teste).
4. Tarefa trivial ("renomeie a variável x para contador em app.js") resulta em `haiku` ou `sonnet`; tarefa ampla ("refatore o módulo de autenticação para usar o novo padrão em todo o projeto") resulta em `opus`.
5. Sem `TYPESAFE_API_KEY`, a execução ocorre com `sonnet` e a interface avisa o fallback.
6. Duas tarefas seguidas no mesmo projeto reutilizam o `session_id` (a segunda enxerga o contexto da primeira).
7. "Nova conversa" zera o `session_id`.
8. Cancelar encerra o processo `claude` e nenhum processo órfão permanece.
9. Segunda execução simultânea no mesmo projeto é bloqueada.
10. Histórico lista cada execução com modelo, status e resultado; remover o projeto remove o histórico.
11. Sem `claude` no PATH, o app mostra a tela de orientação em vez de falhar.
12. Usuário A não enxerga projetos nem execuções do usuário B (RLS validada com duas contas).
13. Testes da função de decisão de modelo passam com `node --test`.

## 12. Ordem de implementação

1. Scaffold Electron com `package.json`, estrutura de pastas, `.env.example` e janela vazia com `preload.cjs`.
2. `supabase/schema.sql` e `supabase.js`; autenticação (RF-01 a RF-05).
3. Projetos (RF-06 a RF-10).
4. `claude.js` com spawn, parsing, cancelamento e timeout; teste manual em um projeto de exemplo.
5. `roteador.js` com a função pura de decisão e testes `node --test`; integração com o Jev e fallback.
6. `orquestrador.js` e tela de execução (RF-11 a RF-21).
7. Histórico (RF-22 a RF-24).
8. Verificações de ambiente (RF-25 a RF-27).
9. Configurações (RF-28 e RF-29).
10. Empacotamento com `electron-builder` e README com instruções de instalação, login no Claude Code e execução.

## 13. Fora do escopo desta versão

- Streaming da saída em tempo real (`--output-format stream-json`).
- Execução de várias tarefas em paralelo em projetos diferentes com fila.
- Chamada ao Jev via Edge Function do Supabase para não distribuir a chave TypeSafe.
- Versões para macOS e Linux.
- Atualização automática do app.

## 14. Definição de pronto

Todos os critérios da seção 11 atendidos, nenhum comentário explicativo no código, nenhuma referência a `ANTHROPIC_API_KEY` ou aos SDKs da Anthropic, e README com os passos de instalação usando apenas `yarn`, com um comando por linha.
