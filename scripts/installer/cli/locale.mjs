import { normalizeLocale, setLocale } from "./strings.mjs";

export const GENERIC_LANG_ENV = "NEXEL_LANG";

export function resolveLocale({ args = {}, env = process.env, productConfig = null } = {}) {
  const productEnvName = productConfig?.envLocale;
  const candidates = [
    args.lang,
    productEnvName ? env[productEnvName] : undefined,
    env[GENERIC_LANG_ENV],
    env.LC_ALL,
    env.LC_MESSAGES,
    env.LANG,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return normalizeLocale(candidate);
    }
  }
  return "en";
}

export function applyLocale(options = {}) {
  return setLocale(resolveLocale(options));
}
