// Ménage des copies « avant » du banc (worktrees git `avant-<commit>` du dossier de brouillon).
// Fonctions pures : la décision ne touche pas au disque ; passe.mjs fait les retraits.

// Nombre de copies « avant » gardées (la plus récemment utilisée d'abord, celle du passage en cours comprise).
export const COPIES_AVANT_GARDEES = 3;

const normal = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

// Lit la sortie de `git worktree list --porcelain` : une entrée par worktree, `{ chemin }`.
export function worktreesDe(porcelain) {
  return porcelain.split(/\r?\n/).filter((l) => l.startsWith('worktree ')).map((l) => ({ chemin: l.slice('worktree '.length).trim() }));
}

// `worktrees` : ceux du dépôt courant, `{ chemin, utilise }` (utilise : dernier usage en ms).
// Ne retient que les dossiers `avant-*` posés directement dans `brouillon` ; jamais `courante` ; en garde `garder` au total.
export function copiesARetirer({ worktrees, brouillon, courante = null, garder = COPIES_AVANT_GARDEES }) {
  const base = normal(brouillon);
  const nôtres = worktrees.filter((w) => {
    const c = normal(w.chemin);
    const i = c.lastIndexOf('/');
    return i > 0 && c.slice(0, i) === base && /^avant-[0-9a-f]+$/.test(c.slice(i + 1));
  });
  const cour = courante ? normal(courante) : null;
  const autres = nôtres.filter((w) => normal(w.chemin) !== cour).sort((a, b) => b.utilise - a.utilise);
  const place = Math.max(0, garder - (nôtres.length - autres.length));
  return autres.slice(place).map((w) => w.chemin);
}
