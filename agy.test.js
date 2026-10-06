import test from "node:test";
import assert from "node:assert/strict";
import { montarArgsAgy } from "./agy.js";

test("monta --print com o prompt como último par", () => {
  const args = montarArgsAgy({ prompt: "tarefa", modelo: "modelo", permitirSemConfirmacao: true });
  assert.deepEqual(args, ["--model", "modelo", "--dangerously-skip-permissions", "--print", "tarefa"]);
});

test("não envia o modelo quando a flag não é compatível", () => {
  assert.deepEqual(montarArgsAgy({ prompt: "tarefa", modelo: "modelo", suportaModelo: false }), ["--print", "tarefa"]);
});
