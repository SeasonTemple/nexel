// Locale-aware catalog facade.
//
// English remains the deterministic boot default. Callers that need a
// different human-facing locale resolve it explicitly through locale.mjs.
// JSON envelope keys, error codes, manifest fields, and public API symbols are
// never localized.

import { strings as en } from "./strings.en.mjs";
import { strings as zh } from "./strings.zh.mjs";

export const CATALOGS = Object.freeze({
  en,
  zh,
});

let currentLocale = "en";
let stringsRef = en;

export function normalizeLocale(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "en";
  if (raw === "zh" || raw.startsWith("zh-") || raw.startsWith("zh_")) return "zh";
  if (raw === "en" || raw.startsWith("en-") || raw.startsWith("en_")) return "en";
  return "en";
}

export function setLocale(locale) {
  currentLocale = normalizeLocale(locale);
  stringsRef = CATALOGS[currentLocale] ?? en;
  return currentLocale;
}

export function getLocale() {
  return currentLocale;
}

export const strings = new Proxy({}, {
  get(_target, prop) {
    return stringsRef[prop];
  },
  set() {
    throw new TypeError("strings catalog is read-only");
  },
  ownKeys() {
    return Reflect.ownKeys(stringsRef);
  },
  getOwnPropertyDescriptor(_target, prop) {
    const descriptor = Object.getOwnPropertyDescriptor(stringsRef, prop);
    if (!descriptor) return undefined;
    return { ...descriptor, configurable: true };
  },
});
