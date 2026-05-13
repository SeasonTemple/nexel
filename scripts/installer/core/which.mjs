import fs from "node:fs";
import path from "node:path";

export function whichSync(binary, { env = process.env, platform = process.platform } = {}) {
  if (!binary || typeof binary !== "string") return null;
  const PATH = env.PATH || env.Path || env.path || "";
  if (!PATH) return null;
  const dirs = PATH.split(path.delimiter).filter(Boolean);
  const exts = platform === "win32"
    ? (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.toLowerCase())
    : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, binary + ext);
      try {
        const st = fs.statSync(candidate);
        if (st.isFile()) return candidate;
      } catch {}
    }
  }
  return null;
}
