// Ce que la coquille répond à une adresse de l'application : un fichier de `dist/`, la page d'accueil (repli des
// adresses de l'application, `/voile/analyse` par exemple, que seul `index.html` sait rendre) ou un refus.
// Fonctions pures, sans Electron : la lecture du disque est passée en paramètre.

import path from 'node:path'

/**
 * Politique de sécurité du contenu, posée en en-tête sur `index.html` seulement (le fichier n'en porte pas : la
 * version navigateur et l'APK restent telles quelles).
 * - `style-src 'unsafe-inline'` : l'application a des styles en ligne.
 * - `img-src` et `connect-src` en `https:` entier : les adresses des tuiles sont réglables par l'utilisateur, la
 *   liste des serveurs ne peut pas être écrite d'avance. Une adresse de tuiles en `http:` est refusée.
 * - `worker-src` : l'application lance un travailleur pour lire les traces.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https:",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ')

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

/** Type d'un fichier d'après son extension ; inconnu : octets bruts. */
export function typeDuFichier(fichier: string): string {
  return TYPES[path.extname(fichier).toLowerCase()] ?? 'application/octet-stream'
}

export type Reponse =
  /** Un fichier de `dist/` à lire ; `csp` vrai pour la page d'accueil. */
  | { statut: 200; fichier: string; type: string; csp: boolean }
  /** Chemin qui sort de `dist/`, absolu, avec une lettre de lecteur ou un caractère interdit. */
  | { statut: 403 }
  /** Fichier absent (une adresse d'application, sans extension, reçoit la page d'accueil à la place). */
  | { statut: 404 }

/**
 * Chemin d'un fichier de `dist/` d'après le chemin d'une adresse (`URL.pathname`, encore encodé), ou `null` s'il est
 * refusé. Refusés : un chemin qui sortirait du dossier (`..`), un chemin absolu ou portant une lettre de lecteur, un
 * deux-points (flux de fichier de Windows), une barre oblique inverse, un caractère nul, un encodage illisible.
 */
export function cheminDansDist(dist: string, cheminAdresse: string): string | null {
  let clair: string
  try {
    clair = decodeURIComponent(cheminAdresse)
  } catch {
    return null
  }
  if (/[\\:\0]/.test(clair)) return null
  const segments = clair.split('/').filter((s) => s !== '')
  if (segments.some((s) => s === '..' || s === '.')) return null
  const fichier = path.join(dist, ...segments)
  const relatif = path.relative(dist, fichier)
  if (relatif.startsWith('..') || path.isAbsolute(relatif)) return null
  return fichier
}

/** Une adresse de l'application (et non un fichier) : son dernier segment n'a pas d'extension. */
function estAdresseDeLApplication(cheminAdresse: string): boolean {
  const dernier = cheminAdresse.split('/').pop() ?? ''
  return !dernier.includes('.')
}

/**
 * Réponse à une adresse de l'application. `estUnFichier` dit si un chemin du disque est un fichier ordinaire.
 * La racine et toute adresse sans extension qui n'est pas un fichier rendent `index.html`, avec la CSP.
 */
export function reponseA(dist: string, cheminAdresse: string, estUnFichier: (chemin: string) => boolean): Reponse {
  const fichier = cheminDansDist(dist, cheminAdresse)
  if (fichier === null) return { statut: 403 }
  const accueil = path.join(dist, 'index.html')
  if (fichier !== path.resolve(dist) && estUnFichier(fichier)) {
    // La CSP suit le type et non le nom : le disque de Windows ignore la casse, `/INDEX.HTML` est la même page.
    const type = typeDuFichier(fichier)
    return { statut: 200, fichier, type, csp: type.startsWith('text/html') }
  }
  if (!estAdresseDeLApplication(cheminAdresse)) return { statut: 404 }
  return { statut: 200, fichier: accueil, type: typeDuFichier(accueil), csp: true }
}
