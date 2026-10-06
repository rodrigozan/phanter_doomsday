import test from "node:test";
import assert from "node:assert/strict";
import { montarEnv, montarArgs, interpretarSaida, classificarErro, extrairNegacoes } from "./claude.js";

test("remove variáveis de chave da Anthropic do ambiente filho", () => {
  const base = { PATH: "x", ["ANTHROPIC_API" + "_KEY"]: "segredo", HOME: "h" };
  const env = montarEnv(base);
  assert.equal(env.PATH, "x");
  assert.equal(env.HOME, "h");
  assert.equal(Object.keys(env).some((k) => k.toUpperCase().startsWith("ANTHROPIC_API")), false);
});

test("monta argumentos base", () => {
  const args = montarArgs({ modelo: "haiku", modoPermissao: "acceptEdits" });
  assert.deepEqual(args, ["-p", "--model", "haiku", "--output-format", "json", "--permission-mode", "acceptEdits"]);
});

test("acrescenta resume e ferramentas", () => {
  const args = montarArgs({ modelo: "opus", modoPermissao: "plan", sessionId: "abc", ferramentas: ["Edit", "Bash(git *)"] });
  assert.deepEqual(args.slice(-4), ["--resume", "abc", "--allowedTools", "Edit,Bash(git *)"]);
});

test("interpreta saída json", () => {
  const saida = interpretarSaida(JSON.stringify({ result: "ok", session_id: "s1", total_cost_usd: 0.01, duration_ms: 5, is_error: false }));
  assert.equal(saida.resultado, "ok");
  assert.equal(saida.sessionId, "s1");
  assert.equal(saida.erro, false);
});

test("saída inválida lança erro com detalhe", () => {
  assert.throws(() => interpretarSaida("não é json"), (e) => e.detalhe === "não é json");
});

test("classifica erro de autenticação", () => {
  assert.equal(classificarErro("Invalid API key · Please run /login"), "autenticacao");
  assert.equal(classificarErro("outro problema"), "geral");
});

test("acrescenta diretórios adicionais", () => {
  const args = montarArgs({ modelo: "sonnet", modoPermissao: "acceptEdits", diretorios: ["/a", "/b c"] });
  assert.deepEqual(args.slice(-4), ["--add-dir", "/a", "--add-dir", "/b c"]);
});

test("extrai negações de permissão como regras únicas", () => {
  const negacoes = extrairNegacoes([
    { tool_name: "Bash", tool_input: { command: "npm install" } },
    { tool_name: "Bash", tool_input: { command: "npm test" } },
    { tool_name: "Write", tool_input: { file_path: "a.txt" } }
  ]);
  assert.deepEqual(negacoes.map((n) => n.regra), ["Bash(npm *)", "Write"]);
  assert.deepEqual(extrairNegacoes(undefined), []);
});
