// Crochet de résolution pour relire le TypeScript de l'application sous Node,
// sans Vite ni Vitest : Node 22.18 ou plus lit les `.ts` tels quels, mais pas
// les imports relatifs sans extension que l'application écrit partout
// (`from '../core/units'`). Ce crochet leur ajoute `.ts`, `.tsx` ou
// `/index.ts`, le premier qui existe.
//
// À importer avant tout module de l'application, qui se charge ensuite par
// `await import(...)` : les imports statiques sont tous résolus avant que ce
// fichier ne s'exécute.
//
//   import './charge-ts.mjs';
//   const { parseGpx } = await import('../../src/core/gpxParser.ts');

import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    if (relative && !/\.[a-z]+$/i.test(specifier) && context.parentURL?.startsWith('file:')) {
      const base = fileURLToPath(new URL(specifier, context.parentURL));
      for (const ext of ['.ts', '.tsx', '/index.ts']) {
        if (existsSync(base + ext)) return nextResolve(pathToFileURL(base + ext).href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
