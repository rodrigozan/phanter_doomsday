# Doomsday

Doomsday é um aplicativo desktop (Electron) que controla o Claude Code instalado na sua máquina. Para cada tarefa, o Jev escolhe o modelo (haiku, sonnet ou opus), o `claude` roda em modo headless na pasta do projeto e o resultado aparece na tela. Projetos, sessões e histórico ficam no Supabase.

## Requisitos

- Windows 10 ou 11
- Node.js 20 ou superior
- Yarn
- Claude Code instalado e autenticado
- Projeto Supabase
- Chave TypeSafe (opcional; sem ela o app usa sonnet)

## Instalação

```
yarn install
```

## Claude Code

Instale o Claude Code, abra um terminal e execute:

```
claude
```

Dentro dele, faça o login:

```
/login
```

O app usa esse login. Nenhuma chave de API é usada nem repassada ao processo `claude`.

## Supabase

1. Crie um projeto no Supabase.
2. Execute o conteúdo de `supabase/schema.sql` no SQL Editor.
3. Em Authentication, habilite o provedor de e-mail e senha.
4. Copie a URL e a chave anon do projeto.

## Configuração

Crie o arquivo `.env` a partir do exemplo:

```
copy .env.example .env
```

Preencha:

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
TYPESAFE_API_KEY=
```

## Execução

```
yarn start
```

## Testes

```
yarn test
```

## Empacotamento

```
yarn dist
```

O instalador é gerado na pasta `dist`. O arquivo `.env` é incluído no pacote.

## Flags do Claude Code

As flags usadas foram conferidas com `claude --help` na versão 2.1.291: `-p`, `--model`, `--output-format json`, `--permission-mode`, `--resume` e `--allowedTools`. Nenhuma divergência em relação à especificação.

A lista de ferramentas permitidas é enviada em um único argumento separado por vírgulas. Todos os argumentos são citados antes de chegar ao `cmd.exe`, pois o `spawn` no Windows usa `shell: true`.

## Roteamento

- Confiança abaixo do limiar configurado: sonnet.
- Complexidade 2 ou refatoração: opus.
- Ajuste simples com complexidade 0: haiku.
- Demais casos: sonnet.

A complexidade devolvida pelo Jev é uma pontuação esperada, que pode ser fracionária. Ela é arredondada para o nível inteiro mais próximo antes da decisão. Os limiares iniciais devem ser validados com tarefas reais.
