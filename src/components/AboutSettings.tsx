import { useEffect, useState } from 'react';
import { licenseGroup, mergeLicenseLists, parseLicenseList, type LicenseEntry } from '../core/licenses';
import { fetchWithin } from '../planning/fetchJson';
import Button from './ui/Button';
import SettingsPart from './SettingsPart';

/** Nombre de composants montrés dans le groupe « MIT, ISC, BSD » avant « Voir les N autres ». */
const LICENSES_PREVIEW = 3;
/** Fichiers servis avec l'application : le délai ne couvre qu'un serveur qui ne répondrait pas. */
const LOAD_TIMEOUT_MS = 10_000;
const UNAVAILABLE = 'Liste des licences indisponible.';

/** Liste rendue par `file`, à côté de l'application ; `null` si elle n'existe pas ou ne se lit pas. */
const loadList = (file: string, signal: AbortSignal): Promise<LicenseEntry[] | null> =>
  fetchWithin(
    `${import.meta.env.BASE_URL}${file}`,
    { signal },
    { noNetwork: UNAVAILABLE, timeout: UNAVAILABLE, timeoutMs: LOAD_TIMEOUT_MS },
    async (response) => (response.ok ? parseLicenseList(await response.text()) : null)
  ).catch(() => null);

/** Une ligne du composant, qui se déplie sur le texte de sa licence, dans une zone qui défile. */
function LicenseRow({ entry, open, onToggle }: { entry: LicenseEntry; open: boolean; onToggle: () => void }) {
  return (
    <li className="about-license">
      <button type="button" className="about-license__row" aria-expanded={open} onClick={onToggle}>
        <span className="about-license__name">
          {entry.name} <span className="about-license__version">{entry.version}</span>
        </span>
        <span className="about-license__id">{entry.identifier || 'Licence non indiquée'}</span>
      </button>
      {open && (
        <div className="about-license__text" tabIndex={0}>
          {entry.notice && <p>{entry.notice}</p>}
          {entry.url && <p><a href={entry.url} target="_blank" rel="noreferrer">{entry.url}</a></p>}
          {entry.components && <p>{entry.components.join(', ')}</p>}
          <pre>{entry.text || 'Le paquet ne fournit pas le texte de sa licence.'}</pre>
        </div>
      )}
    </li>
  );
}

/** Un groupe de licences ; `limit` n'en montre que les premières, le reste derrière « Voir les N autres ». */
function LicenseGroupList({ title, entries, limit, openKey, onToggle }: {
  title: string;
  entries: LicenseEntry[];
  limit?: number;
  openKey: string | null;
  onToggle: (key: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (entries.length === 0) return null;
  const shown = showAll || limit === undefined ? entries : entries.slice(0, limit);
  const hiddenCount = entries.length - shown.length;
  return (
    <>
      <p className="ui-eyebrow about-licenses__group">{title}</p>
      <ul className="about-licenses__list">
        {shown.map((entry) => {
          const key = `${entry.name}@${entry.version}`;
          return <LicenseRow key={key} entry={entry} open={openKey === key} onToggle={() => onToggle(key)} />;
        })}
      </ul>
      {hiddenCount > 0 && (
        <Button size="s" className="about-licenses__more" onClick={() => setShowAll(true)}>
          {hiddenCount === 1 ? "Voir l'autre" : `Voir les ${hiddenCount} autres`}
        </Button>
      )}
    </>
  );
}

/** Liste des licences, chargée au dépliage seulement : rien au démarrage de l'application. */
function LicensesList() {
  const [lists, setLists] = useState<{ built: LicenseEntry[] | null; extra: LicenseEntry[] | null } | null>(null);
  // Un composant ouvert à la fois : la page ne s'allonge que d'une zone de texte.
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([loadList('licences.json', controller.signal), loadList('licences-hors-js.json', controller.signal)]).then(([built, extra]) => {
      if (!controller.signal.aborted) setLists({ built, extra });
    });
    return () => controller.abort();
  }, []);

  if (!lists) return <p className="about-licenses__intro">Chargement…</p>;
  const entries = mergeLicenseLists(lists.built, lists.extra);
  if (entries.length === 0) return <p className="about-licenses__intro">{UNAVAILABLE}</p>;
  const toggle = (key: string) => setOpenKey((current) => (current === key ? null : key));
  return (
    <>
      <p className="about-licenses__intro">Tracker s'appuie sur ces composants. Touchez-en un pour lire sa licence.</p>
      {/* Sous `npm run dev` : Vite n'écrit la liste du JS qu'à la construction. */}
      {!lists.built && <p className="about-licenses__intro">Liste complète dans la version construite.</p>}
      <LicenseGroupList title="MIT, ISC, BSD" entries={entries.filter((e) => licenseGroup(e.identifier) === 'permissive')} limit={LICENSES_PREVIEW} openKey={openKey} onToggle={toggle} />
      <LicenseGroupList title="Autres licences" entries={entries.filter((e) => licenseGroup(e.identifier) === 'other')} openKey={openKey} onToggle={toggle} />
    </>
  );
}

/** Bloc « À propos » de Réglages : logo, version, où vont les données, et les licences des composants. */
function AboutSettings() {
  const [licensesOpen, setLicensesOpen] = useState(false);
  return (
    <div className="about">
      <div className="about__logo">Tracker</div>
      <p className="about__version">Version {__APP_VERSION__}</p>
      <p className="about__text">
        Vos sessions restent sur cet appareil et dans votre dossier mémoire, sans compte. Les fonds de carte, la recherche de lieux, les itinéraires, ainsi que l'altitude et le revêtement des parcours à pied et à vélo, passent par des services en ligne.
      </p>
      <SettingsPart label="Licences des composants utilisés" open={licensesOpen} onToggle={() => setLicensesOpen((o) => !o)}>
        <LicensesList />
      </SettingsPart>
    </div>
  );
}

export default AboutSettings;
