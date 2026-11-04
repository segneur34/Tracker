import { errorMessage } from '../core/basics';

/**
 * Traducteur des erreurs de la plateforme (lot 158) : codes des greffons
 * (`NOT_AUTHORIZED`, `NOT_FOUND`, `PERMISSION`, `NO_SPACE`, `TOO_LARGE`),
 * `DOMException.name` (`QuotaExceededError`, `NotAllowedError`…) et messages
 * techniques en anglais d'Android ou du navigateur. Jamais de texte brut
 * d'exception à l'écran : une erreur inconnue donne une phrase en clair, le
 * détail va en console. Un message déjà écrit en français par l'application
 * passe tel quel.
 */

/** Ce que dit une erreur de fichier, sans la traduire : le code du greffon, ou celle du navigateur. */
export type FileErrorCode = 'NOT_FOUND' | 'PERMISSION' | 'NO_SPACE' | 'TOO_LARGE' | 'UNKNOWN';

const FILE_ERROR_CODES: readonly string[] = ['NOT_FOUND', 'PERMISSION', 'NO_SPACE', 'TOO_LARGE', 'UNKNOWN'];

/** Erreurs du navigateur (poignées de dossier), par leur nom. */
const BROWSER_ERROR_CODES: Readonly<Record<string, FileErrorCode>> = {
  NotFoundError: 'NOT_FOUND',
  TypeMismatchError: 'NOT_FOUND',
  NotAllowedError: 'PERMISSION',
  SecurityError: 'PERMISSION',
  QuotaExceededError: 'NO_SPACE',
};

/**
 * Code d'une erreur levée par un dossier mémoire : `code` posé par le greffon
 * (`rejectCoded`), sinon le nom de l'erreur du navigateur. Seul lecteur de code
 * (ré-exporté par `memoryFolder.ts`).
 */
export const fileErrorCode = (err: unknown): FileErrorCode => {
  if (typeof err !== 'object' || err === null) return 'UNKNOWN';
  const { code, name } = err as { code?: unknown; name?: unknown };
  if (typeof code === 'string' && FILE_ERROR_CODES.includes(code)) return code as FileErrorCode;
  return (typeof name === 'string' && Object.hasOwn(BROWSER_ERROR_CODES, name) ? BROWSER_ERROR_CODES[name] : undefined) ?? 'UNKNOWN';
};

export const DENIED_TEXT = 'Autorisation refusée : Réglages › Autorisations.';
export const LOCATION_DENIED_TEXT = 'Localisation refusée : Réglages › Autorisations.';
const NOT_FOUND_TEXT = 'Fichier ou dossier introuvable.';
const NO_SPACE_TEXT = 'Plus de place sur le téléphone ou dans le navigateur.';
const TOO_LARGE_TEXT = 'Fichier trop volumineux.';
const NETWORK_TEXT = 'Réseau indisponible.';
const TIMEOUT_TEXT = 'Délai dépassé.';
const ABORT_TEXT = 'Opération interrompue.';
export const UNKNOWN_ERROR_TEXT = "Une erreur est survenue. Réessayez ; si elle revient, redémarrez l'application.";

const BY_FILE_CODE: Partial<Record<FileErrorCode, string>> = {
  PERMISSION: DENIED_TEXT,
  NOT_FOUND: NOT_FOUND_TEXT,
  NO_SPACE: NO_SPACE_TEXT,
  TOO_LARGE: TOO_LARGE_TEXT,
};

/** Autres codes ou noms connus (position, réseau, annulation). */
const BY_OTHER_CODE: Record<string, string> = {
  NOT_AUTHORIZED: DENIED_TEXT,
  AbortError: ABORT_TEXT,
  TimeoutError: TIMEOUT_TEXT,
  NetworkError: NETWORK_TEXT,
};

/** Messages techniques reconnus (Android, navigateur), dans l'ordre d'essai. */
const BY_MESSAGE: readonly [RegExp, string][] = [
  [/missing file for|filenotfoundexception|enoent|no such file|not found/i, NOT_FOUND_TEXT],
  [/enospc|no space left|quota ?exceeded|disk full/i, NO_SPACE_TEXT],
  [/permission denied|denied|not authorized|eacces|securityexception/i, DENIED_TEXT],
  [/failed to fetch|networkerror|load failed|network request failed|unknownhost|unable to resolve host/i, NETWORK_TEXT],
  [/timed? ?out|timeout/i, TIMEOUT_TEXT],
];

/** Vrai quand le message est du texte technique (anglais, classe Java, chemin) et non une phrase de l'application. */
const TECHNICAL =
  /[A-Za-z]+(Exception|Error)\b|\bjava\.|\bandroid\.|\bat \/|\/storage\/|\bprimary:|\b(failed|denied|cannot|can't|unable|invalid|undefined|null|missing|not found|no such|unexpected|refused|illegal|permission|error|exception|file|read|write|open)\b|^[A-Z][A-Z_]{2,}$/i;

/**
 * Phrase en clair pour `err`. Ordre : code ou nom connu, message technique
 * reconnu, message de l'application (gardé tel quel), puis le préfixe français
 * d'un message du type « Lecture impossible : détail technique », sinon `fallback`.
 */
export const plainError = (err: unknown, fallback: string = UNKNOWN_ERROR_TEXT): string => {
  const fileCode = fileErrorCode(err);
  const other = typeof err === 'object' && err !== null ? (err as { code?: unknown; name?: unknown }) : {};
  const rawCode = typeof other.code === 'string' ? other.code : typeof other.name === 'string' ? other.name : null;
  const detail = errorMessage(err, '');
  // Un code explicite prime sur le texte.
  const byCode = BY_FILE_CODE[fileCode] ?? (rawCode !== null ? BY_OTHER_CODE[rawCode] : undefined);
  if (byCode) return byCode;
  for (const [pattern, text] of BY_MESSAGE) if (pattern.test(detail)) return text;
  if (!detail) return fallback;
  if (!TECHNICAL.test(detail)) return detail;
  console.warn(`Erreur technique : ${rawCode ? `${rawCode} ` : ''}${detail}`);
  const head = detail.split(' : ')[0]?.trim();
  return head && head !== detail && !TECHNICAL.test(head) ? `${head}.` : fallback;
};
