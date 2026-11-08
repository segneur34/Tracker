import { describe, expect, it } from 'vitest';
import {
  ALLOWED_LICENSES, LICENSE_EXCEPTIONS, licenseGroup, licenseTerms, mergeLicenseLists, parseLicenseList, productionPackages, refusedLicenses, uselessExceptions,
  type LicenseEntry, type LockedPackage,
} from './licenses';

// Les types de Node ne sont pas ceux de l'app (voir `hooks/mediaQueries.test.ts`) : le peu qui sert est décrit à la main.
interface Fs {
  existsSync(file: URL): boolean;
  readFileSync(file: URL, encoding: 'utf8'): string;
}
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;
const repoFile = (path: string): string => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

interface NativeRow { name: string; version: string; identifier: string; text: string; url?: string; components: string[] }
const { familleDuGroupe, composantsNatifs, lignesNatives } = (await import(
  /* @vite-ignore */ new URL('../../outils/licences-hors-js.mjs', import.meta.url).href
)) as {
  familleDuGroupe: (groupe: string) => { nom: string; identifiant: string };
  composantsNatifs: (sortie: string) => string[];
  lignesNatives: (composants: string[], apache: string) => NativeRow[];
};

const LOCK = JSON.parse(repoFile('package-lock.json')) as Parameters<typeof productionPackages>[0];
const PACKAGES = productionPackages(LOCK);
const COMPLEMENT = parseLicenseList(repoFile('public/licences-hors-js.json'));

const pkg = (name: string, license?: string): LockedPackage => ({ name, version: '1.0.0', license });
const entry = (name: string, identifier: string, extra: Partial<LicenseEntry> = {}): LicenseEntry => ({ name, version: '1.0.0', identifier, text: 'texte', ...extra });

describe('dépendances de production du projet', () => {
  it('écarte les paquets de développement et la racine', () => {
    const lock = {
      packages: {
        '': { version: '0.4.86' },
        'node_modules/a': { version: '1.0.0', license: 'MIT' },
        'node_modules/b': { version: '1.0.0', license: 'MIT', dev: true },
        'node_modules/c': { version: '1.0.0', license: 'MIT', devOptional: true },
        'node_modules/a/node_modules/d': { version: '2.0.0', license: 'ISC' },
        'node_modules/@s/e': { version: '3.0.0' },
      },
    };
    expect(productionPackages(lock).map((p) => p.name)).toEqual(['a', 'd', '@s/e']);
  });

  it('toutes sous une licence admise, exceptions nommées mises à part', () => {
    expect(PACKAGES.length).toBeGreaterThan(40);
    expect(refusedLicenses(PACKAGES)).toEqual([]);
  });

  it('une exception devenue inutile fait échouer le test', () => {
    expect(uselessExceptions(PACKAGES)).toEqual([]);
  });
});

describe('refusedLicenses', () => {
  it('liste blanche', () => {
    expect([...ALLOWED_LICENSES].sort()).toEqual(['0BSD', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MIT', 'MPL-2.0', 'OFL-1.1']);
  });

  it('refuse une licence hors liste', () => {
    expect(refusedLicenses([pkg('a', 'GPL-3.0'), pkg('b', 'MIT')]).map((p) => p.name)).toEqual(['a']);
  });

  it('refuse une entrée sans licence', () => {
    expect(refusedLicenses([pkg('a')]).map((p) => p.name)).toEqual(['a']);
    expect(refusedLicenses([pkg('a', '')]).map((p) => p.name)).toEqual(['a']);
  });

  it('découpe une expression composée : tous ses termes doivent être admis', () => {
    expect(licenseTerms('MIT AND ISC AND BSD-3-Clause')).toEqual(['MIT', 'ISC', 'BSD-3-Clause']);
    expect(licenseTerms('(MIT OR Apache-2.0)')).toEqual(['MIT', 'Apache-2.0']);
    expect(refusedLicenses([pkg('victory-vendor', 'MIT AND ISC AND BSD-3-Clause')])).toEqual([]);
    expect(refusedLicenses([pkg('a', 'MIT AND GPL-3.0')]).map((p) => p.name)).toEqual(['a']);
    expect(refusedLicenses([pkg('b', 'MIT OR GPL-3.0')]).map((p) => p.name)).toEqual(['b']);
  });

  it('laisse passer les exceptions nommées, et elles seules', () => {
    expect(LICENSE_EXCEPTIONS).toEqual([]);
    const packages = [pkg('nomme', 'Hippocratic-2.1'), pkg('autre', 'Hippocratic-2.1')];
    expect(refusedLicenses(packages, ['nomme']).map((p) => p.name)).toEqual(['autre']);
    expect(refusedLicenses(packages).map((p) => p.name)).toEqual(['nomme', 'autre']);
  });
});

describe('uselessExceptions', () => {
  it('signale un paquet disparu, ou dont la licence est désormais admise', () => {
    expect(uselessExceptions([pkg('a', 'Hippocratic-2.1')], ['a'])).toEqual([]);
    expect(uselessExceptions([], ['a'])).toEqual(['a']);
    expect(uselessExceptions([pkg('a', 'MIT')], ['a'])).toEqual(['a']);
  });
});

describe('licenseGroup', () => {
  it('range MIT, ISC et BSD ensemble', () => {
    for (const id of ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'MIT AND ISC AND BSD-3-Clause']) expect(licenseGroup(id)).toBe('permissive');
  });

  it('range tout le reste dans les autres licences', () => {
    for (const id of ['MPL-2.0', 'OFL-1.1', 'Apache-2.0', 'Hippocratic-2.1', 'Licence du SDK Android', 'MIT AND Apache-2.0', '']) expect(licenseGroup(id)).toBe('other');
  });
});

describe('parseLicenseList', () => {
  it('lit la liste de Vite', () => {
    const body = JSON.stringify([{ name: 'a', version: '1.0.0', identifier: 'MIT', text: 'Texte' }]);
    expect(parseLicenseList(body)).toEqual([{ name: 'a', version: '1.0.0', identifier: 'MIT', text: 'Texte' }]);
  });

  it('rend null sur la page HTML que répond le serveur de développement', () => {
    expect(parseLicenseList('<!doctype html><html lang="fr"><body><div id="root"></div></body></html>')).toBeNull();
  });

  it('rend null sur un JSON qui n\'est pas une liste', () => {
    expect(parseLicenseList('{"name":"a"}')).toBeNull();
  });

  it('garde une entrée sans identifiant ni texte, écarte une entrée sans nom', () => {
    expect(parseLicenseList(JSON.stringify([{ name: 'a', version: '1.0.0' }, { version: '2.0.0' }, null, 3]))).toEqual([{ name: 'a', version: '1.0.0', identifier: '', text: '' }]);
  });

  it('garde notice, adresse et composants', () => {
    const row = { name: 'a', version: '1', identifier: 'MIT', text: 'T', notice: 'N', url: 'https://exemple.fr', components: ['g:n:1'] };
    expect(parseLicenseList(JSON.stringify([row]))).toEqual([row]);
  });
});

describe('mergeLicenseLists', () => {
  it('trie par nom, et la ligne du complément prime', () => {
    const built = [entry('z', 'MIT'), entry('b', 'MPL-2.0')];
    const extra = [entry('b', 'MPL-2.0', { notice: 'Utilisé sans modification.' }), entry('a', 'OFL-1.1')];
    const merged = mergeLicenseLists(built, extra);
    expect(merged.map((e) => e.name)).toEqual(['a', 'b', 'z']);
    expect(merged[1].notice).toBe('Utilisé sans modification.');
  });

  it('se contente d\'une seule liste', () => {
    expect(mergeLicenseLists(null, [entry('a', 'MIT')]).map((e) => e.name)).toEqual(['a']);
    expect(mergeLicenseLists([entry('a', 'MIT')], null).map((e) => e.name)).toEqual(['a']);
    expect(mergeLicenseLists(null, null)).toEqual([]);
  });
});

describe('complément hors JS (public/licences-hors-js.json)', () => {
  const rows = COMPLEMENT ?? [];
  const lockVersion = (name: string): string | undefined => PACKAGES.find((p) => p.name === name)?.version;
  const nativeVersions = new Map<string, string>(rows.flatMap((r) => r.components ?? []).map((c) => {
    const [group, name, version] = c.split(':');
    return [`${group}:${name}`, version];
  }));
  const gradleVariable = (name: string): string | undefined => repoFile('android/variables.gradle').match(new RegExp(`${name} = '([^']+)'`))?.[1];

  it('se lit, chaque ligne a sa licence et son texte', () => {
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) {
      expect(row.identifier, row.name).not.toBe('');
      expect(row.text, row.name).not.toBe('');
    }
  });

  it('paquets npm : versions du package-lock', () => {
    const npm = rows.filter((r) => r.name.startsWith('@'));
    expect(npm.map((r) => r.name)).toEqual(['@fontsource/montserrat', '@fontsource/shrikhand', '@capacitor/android', '@capgo/background-geolocation']);
    for (const row of npm) expect(row.version, row.name).toBe(lockVersion(row.name));
  });

  it('greffon GPS : la ligne MPL, « non modifié » et le lien vers ses sources', () => {
    const gps = rows.find((r) => r.name === '@capgo/background-geolocation');
    expect(gps?.identifier).toBe('MPL-2.0');
    expect(gps?.notice).toContain('sans modification');
    expect(gps?.url).toBe('https://github.com/Cap-go/capacitor-background-geolocation');
  });

  it.each([
    ['androidxActivityVersion', 'androidx.activity:activity'],
    ['androidxAppCompatVersion', 'androidx.appcompat:appcompat'],
    ['androidxCoordinatorLayoutVersion', 'androidx.coordinatorlayout:coordinatorlayout'],
    ['androidxCoreVersion', 'androidx.core:core'],
    ['androidxFragmentVersion', 'androidx.fragment:fragment'],
    ['coreSplashScreenVersion', 'androidx.core:core-splashscreen'],
    ['androidxWebkitVersion', 'androidx.webkit:webkit'],
    ['cordovaAndroidVersion', 'org.apache.cordova:framework'],
  ])('natif : %s de android/variables.gradle', (variable, component) => {
    expect(gradleVariable(variable), variable).toBeDefined();
    expect(nativeVersions.get(component), component).toBe(gradleVariable(variable));
  });

  it('services Google Play : conditions du SDK Android, avec leur lien', () => {
    const gms = rows.find((r) => r.name === 'Services Google Play');
    expect(gms?.identifier).toBe('Licence du SDK Android');
    expect(gms?.url).toBe('https://developer.android.com/studio/terms');
  });
});

describe('table des groupes natifs (outils/licences-hors-js.mjs)', () => {
  it('refuse un groupe hors table', () => {
    expect(() => familleDuGroupe('com.exemple.inconnu')).toThrow(/com\.exemple\.inconnu/);
    expect(() => lignesNatives(['com.exemple.inconnu:lib:1.0'], 'apache')).toThrow(/com\.exemple\.inconnu/);
    // Un voisin n'hérite pas de la table par son préfixe.
    expect(() => familleDuGroupe('org.apache.commons')).toThrow();
    expect(() => familleDuGroupe('com.google.firebase')).toThrow();
  });

  it('connaît les groupes de la liste', () => {
    expect(familleDuGroupe('androidx.core').identifiant).toBe('Apache-2.0');
    expect(familleDuGroupe('org.jetbrains.kotlinx').identifiant).toBe('Apache-2.0');
    expect(familleDuGroupe('org.jetbrains').identifiant).toBe('Apache-2.0');
    expect(familleDuGroupe('org.jspecify').identifiant).toBe('Apache-2.0');
    expect(familleDuGroupe('org.apache.cordova').identifiant).toBe('Apache-2.0');
    expect(familleDuGroupe('com.google.guava').identifiant).toBe('Apache-2.0');
    expect(familleDuGroupe('com.google.android.gms').identifiant).toBe('Licence du SDK Android');
    expect(familleDuGroupe('io.ionic.libs').identifiant).toBe('MIT');
  });

  it('lit la sortie de Gradle : version retenue, sans les modules du projet ni les doubles', () => {
    const sortie = [
      '> Task :app:dependencies',
      'releaseRuntimeClasspath - Resolved configuration',
      '+--- androidx.appcompat:appcompat:1.7.1',
      '|    +--- androidx.activity:activity:1.8.0 -> 1.11.0',
      '|    |    \\--- androidx.annotation:annotation:1.8.1 -> 1.9.1 (*)',
      '|    +--- androidx.lifecycle:lifecycle-common:{strictly 2.9.4} -> 2.9.4 (c)',
      '|    +--- androidx.core:core -> 1.17.0',
      '+--- project :capacitor-android',
      '|    \\--- org.apache.cordova:framework:14.0.1',
      '\\--- org.apache.cordova:framework:14.0.1 (*)',
      '(*) - Indicates repeated occurrences of a transitive dependency subtree.',
    ].join('\r\n');
    expect(composantsNatifs(sortie)).toEqual([
      'androidx.activity:activity:1.11.0',
      'androidx.annotation:annotation:1.9.1',
      'androidx.appcompat:appcompat:1.7.1',
      'androidx.core:core:1.17.0',
      'androidx.lifecycle:lifecycle-common:2.9.4',
      'org.apache.cordova:framework:14.0.1',
    ]);
  });

  it('une ligne par famille : le compte, ou la version pour un composant seul', () => {
    const rows = lignesNatives(['androidx.core:core:1.17.0', 'androidx.activity:activity:1.11.0', 'org.apache.cordova:framework:14.0.1'], 'texte apache');
    expect(rows.map((r) => [r.name, r.version, r.text])).toEqual([
      ['AndroidX', '2 composants', 'texte apache'],
      ['Apache Cordova', '14.0.1', 'texte apache'],
    ]);
  });
});
