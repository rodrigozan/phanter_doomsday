import test from "node:test";
import assert from "node:assert/strict";
import { decidirModelo } from "./roteador.js";

const r = (tipo, tc, score, cc) => ({
  tipo: { choice: tipo, confidence: tc },
  complexidade: { score, confidence: cc }
});

test("confiança baixa no tipo cai para sonnet", () => {
  assert.equal(decidirModelo(r("ajuste_simples", 0.3, 0, 0.9), 0.5), "sonnet");
});

test("confiança baixa na complexidade cai para sonnet", () => {
  assert.equal(decidirModelo(r("refatoracao", 0.9, 2, 0.4), 0.5), "sonnet");
});

test("complexidade alta resulta em opus", () => {
  assert.equal(decidirModelo(r("feature", 0.9, 2, 0.9), 0.5), "opus");
});

test("refatoração resulta em opus", () => {
  assert.equal(decidirModelo(r("refatoracao", 0.9, 1, 0.9), 0.5), "opus");
});

test("ajuste simples trivial resulta em haiku", () => {
  assert.equal(decidirModelo(r("ajuste_simples", 0.9, 0, 0.9), 0.5), "haiku");
});

test("ajuste simples moderado resulta em sonnet", () => {
  assert.equal(decidirModelo(r("ajuste_simples", 0.9, 1, 0.9), 0.5), "sonnet");
});

test("feature moderada resulta em sonnet", () => {
  assert.equal(decidirModelo(r("feature", 0.9, 1, 0.9), 0.5), "sonnet");
});

test("investigação trivial resulta em sonnet", () => {
  assert.equal(decidirModelo(r("investigacao", 0.9, 0, 0.9), 0.5), "sonnet");
});

test("score fracionário é arredondado", () => {
  assert.equal(decidirModelo(r("ajuste_simples", 0.9, 0.2, 0.9), 0.5), "haiku");
  assert.equal(decidirModelo(r("feature", 0.9, 1.6, 0.9), 0.5), "opus");
});

test("limiar configurável é respeitado", () => {
  assert.equal(decidirModelo(r("ajuste_simples", 0.6, 0, 0.6), 0.5), "haiku");
  assert.equal(decidirModelo(r("ajuste_simples", 0.6, 0, 0.6), 0.7), "sonnet");
});
