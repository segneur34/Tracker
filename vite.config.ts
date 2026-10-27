import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

// Version unique de l'application, lue dans package.json (Gradle lit la même).
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    // Une seule feuille de style, dans l'ordre d'aujourd'hui : aucune page chargée à la demande ne peut en manquer
    // une, et 21 kB compressés ne pèsent rien au démarrage.
    cssCodeSplit: false,
    // Le chunk des graphes approche les 500 kB : l'avertissement ne dirait rien de neuf.
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        // Pages en `React.lazy` (`App.tsx`) ; les bibliothèques lourdes à part, chargées une fois pour toutes les
        // pages qui s'en servent : Recharts et ses dépendances (analyses, Statistiques), Leaflet (cartes).
        codeSplitting: {
          // Les seuls modules qui correspondent, pas leurs dépendances : React resterait sinon dans `vendor-charts`.
          includeDependenciesRecursively: false,
          groups: [
            {
              name: 'vendor-charts',
              test: /node_modules[\\/](recharts|victory-vendor|d3-[a-z-]+|es-toolkit|decimal\.js-light|@reduxjs|immer|redux|reselect|react-redux|eventemitter3|internmap)[\\/]/,
              priority: 2,
            },
            {
              name: 'vendor-map',
              test: /node_modules[\\/](leaflet|react-leaflet|@react-leaflet)[\\/]/,
              priority: 2,
            },
          ],
        },
      },
    },
  },
})
