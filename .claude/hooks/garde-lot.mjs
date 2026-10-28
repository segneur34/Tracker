// Garde de l'agent `lot` : refuse git commit, git push et la modification de package.json.
let brut = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (brut += d));
process.stdin.on("end", () => {
  let e = {};
  try { e = JSON.parse(brut); } catch { process.exit(0); }
  const entree = e.tool_input ?? {};
  const cmd = typeof entree.command === "string" ? entree.command : "";
  const fichier = typeof entree.file_path === "string" ? entree.file_path : "";
  const git = e.tool_name === "Bash" && /\bgit\b[^;&|\n]*\b(commit|push)\b/.test(cmd);
  const pkg = (e.tool_name === "Edit" || e.tool_name === "Write") && /(^|[\\/])package\.json$/.test(fichier);
  if (git || pkg) {
    process.stderr.write("L'agent lot ne committe pas, ne pousse pas et ne touche pas à package.json : c'est l'orchestrateur.\n");
    process.exit(2);
  }
  process.exit(0);
});
