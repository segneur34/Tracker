import { useState } from 'react';
import { Link } from 'react-router-dom';
import { HelpText, HelpToggle } from './Help';
import Button from './ui/Button';
import Dialog from './ui/Dialog';
import SegmentedControl from './ui/SegmentedControl';
import { RUNNER_NAME_MAX, type RunnerProfile } from '../running/runnerProfile';
import { missingProfileFields, shouldPromptProfile } from '../library/profilePrompt';
import { readRunnerProfile, useRunnerProfile } from '../hooks/useRunnerProfile';
import { isNativeApp } from '../platform/runtime';
import './ProfilePrompt.css';

/**
 * Déjà ouvert, ou écarté, depuis le lancement de l'application : le pop-up ne
 * revient qu'au lancement suivant (un état du module, rien sur l'appareil).
 */
let askedThisLaunch = false;

type SexChoice = 'f' | 'm' | 'aucun';

/** Champs du pop-up, tels que tapés : un nombre vide ou hors plage n'est pas écrit. */
interface Draft {
  name: string;
  birthYear: string;
  weightKg: string;
  heightCm: string;
  sex: SexChoice;
}

const draftOf = (profile: RunnerProfile): Draft => ({
  name: profile.name ?? '',
  birthYear: profile.birthYear === null ? '' : String(profile.birthYear),
  weightKg: profile.weightKg === null ? '' : String(profile.weightKg),
  heightCm: profile.heightCm === null ? '' : String(profile.heightCm),
  sex: profile.sex ?? 'aucun',
});

/**
 * Pop-up de l'accueil, dans l'application : tant que le profil n'est pas rempli
 * (pseudo, année de naissance, sexe, poids, taille : `missingProfileFields`), il
 * s'ouvre une fois par lancement. Posé par l'accueil une fois la mémoire et la
 * carte des autorisations décidées, il tranche à son arrivée ; `otherCardShown` :
 * l'une d'elles est à l'écran, et il attend le lancement suivant.
 */
function ProfilePrompt({ otherCardShown }: { otherCardShown: boolean }) {
  const { setName, setNumber, setSex } = useRunnerProfile();
  // Le profil du hook est vide au premier rendu (il se relit dans un effet) : la décision lit le stockage.
  const [stored] = useState(readRunnerProfile);
  const [shown] = useState(() => {
    const open = shouldPromptProfile({
      native: isNativeApp(), missing: missingProfileFields(stored), askedThisLaunch, otherCardShown,
    });
    askedThisLaunch = true;
    return open;
  });
  const [closed, setClosed] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(stored));

  if (!shown || closed) return null;
  const close = () => setClosed(true);
  const save = () => {
    if (draft.name.trim() !== '') setName(draft.name.trim());
    const number = (text: string) => (text.trim() === '' ? null : parseFloat(text.replace(',', '.')));
    for (const field of ['birthYear', 'weightKg', 'heightCm'] as const) {
      const value = number(draft[field]);
      if (value !== null && !isNaN(value)) setNumber(field, field === 'weightKg' ? value : Math.round(value));
    }
    if (draft.sex !== 'aucun') setSex(draft.sex);
    close();
  };
  const field = (key: 'birthYear' | 'weightKg' | 'heightCm', label: string, unit: string, placeholder: string, help: string) => (
    <>
      <label className="profile-prompt__row">
        <span className="profile-prompt__label">{label}<HelpToggle helpKey={`accueil-profil:${key}`} label={label} /></span>
        <input type="number" inputMode="decimal" className="ui-field ui-field--s num profile-prompt__number" value={draft[key]}
          placeholder={placeholder} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
        <span className="profile-prompt__unit">{unit}</span>
      </label>
      <HelpText helpKey={`accueil-profil:${key}`}>{help}</HelpText>
    </>
  );

  return (
    <Dialog title="Votre profil" onClose={close} className="profile-prompt">
      <p className="profile-prompt__intro">
        Pour l'énergie, la dépense et la page Profil. Tout se change ensuite dans <Link to="/parametres" onClick={close}>Réglages</Link> › Pratiquant.
      </p>
      <label className="profile-prompt__row">
        <span className="profile-prompt__label">Nom ou pseudo<HelpToggle helpKey="accueil-profil:nom" label="Nom ou pseudo" /></span>
        <input type="text" className="ui-field ui-field--s profile-prompt__text" value={draft.name} maxLength={RUNNER_NAME_MAX}
          placeholder="ex. Tom" autoComplete="nickname" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </label>
      <HelpText helpKey="accueil-profil:nom">En titre de la page Profil et au pied des images partagées.</HelpText>
      {field('birthYear', 'Année de naissance', '', 'ex. 1985', 'Pour la dépense au repos, et la FC max estimée quand elle n\'est pas saisie.')}
      <div className="profile-prompt__row">
        <span className="profile-prompt__label">Sexe<HelpToggle helpKey="accueil-profil:sexe" label="Sexe" /></span>
        <SegmentedControl<SexChoice> label="Sexe" value={draft.sex} onChange={(sex) => setDraft({ ...draft, sex })}
          items={[{ key: 'f', label: 'Femme' }, { key: 'm', label: 'Homme' }]} />
      </div>
      <HelpText helpKey="accueil-profil:sexe">Pour la dépense au repos.</HelpText>
      {field('weightKg', 'Poids', 'kg', 'ex. 72', 'Pour l\'énergie, et la puissance à vélo.')}
      {field('heightCm', 'Taille', 'cm', 'ex. 178', 'Avec le poids, l\'âge et le sexe, pour la dépense au repos.')}
      <div className="profile-prompt__actions">
        <Button variant="ghost" onClick={close}>Plus tard</Button>
        <Button variant="primary" onClick={save}>Enregistrer</Button>
      </div>
    </Dialog>
  );
}

export default ProfilePrompt;
