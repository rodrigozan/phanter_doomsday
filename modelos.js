export const MODELOS_ANTIGRAVITY_PADRAO = {
  flash: "",
  flash_alto: "",
  pro: ""
};

export function normalizarModelosAntigravity(modelos = {}) {
  return Object.fromEntries(Object.keys(MODELOS_ANTIGRAVITY_PADRAO).map((chave) => [chave, typeof modelos[chave] === "string" ? modelos[chave].trim() : ""]));
}

export function modeloAntigravity(modelos, complexidade) {
  const chave = Math.round(Number(complexidade)) >= 2 ? "pro" : Math.round(Number(complexidade)) === 1 ? "flash_alto" : "flash";
  return normalizarModelosAntigravity(modelos)[chave];
}
