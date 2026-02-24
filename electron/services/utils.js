export function injectVariables(value, variables = {}) {
  if (typeof value !== "string") return value;
  return value.replace(/{{(.*?)}}/g, (_, key) => {
    const trimmed = key.trim();
    return variables[trimmed] ?? "";
  });
}