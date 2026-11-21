// Adresse sous laquelle la coquille sert l'application. Écrite ici une seule fois : le protocole, le verrou de
// navigation et le contrôle de l'expéditeur des messages la lisent tous.
//
// Ne jamais la changer : la mémoire du navigateur intégré (OPFS, cache des tuiles et des vignettes, réglages) est
// rangée par origine ; une autre adresse ouvrirait une mémoire vide.
//
// Pourquoi `https` et pas un protocole propre (`app://`) : le Cache API refuse toute requête qui n'est ni `http` ni
// `https`, et les tuiles comme les vignettes y sont rangées sous des adresses relatives à la page. Le domaine
// `.localhost` est réservé (RFC 6761) : il ne désigne jamais un vrai site d'Internet.

export const HOTE = 'tracker.localhost'

export const ORIGINE = `https://${HOTE}`

/** Adresse de la page d'ouverture de l'application. */
export const ADRESSE_ACCUEIL = `${ORIGINE}/`

/** Vrai si l'adresse appartient à l'application (même protocole, même hôte, port par défaut). */
export function estDeLApplication(adresse: string): boolean {
  try {
    return new URL(adresse).origin === ORIGINE
  } catch {
    return false
  }
}
