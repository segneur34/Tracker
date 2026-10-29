/**
 * Égalité stricte de données simples, pour les tests qui comparent beaucoup de
 * fois de longs résultats : feuilles comparées par `Object.is` (NaN égal à
 * NaN, 0 différent de −0), mêmes clés propres (une clé valant `undefined`
 * compte), tableaux et tableaux typés de même longueur, même prototype. Tout
 * autre objet (date, Map, Set…) rend `false`.
 *
 * Elle est au moins aussi stricte que `toEqual` : là où elle dit égal,
 * `toEqual` passe. Emploi : `if (!sameData(a, b)) expect(a).toEqual(b);`,
 * même verdict et même message que `toEqual`, sans payer sa comparaison,
 * lente sur de longues traces, quand tout est égal.
 */
export const sameData = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const proto = Object.getPrototypeOf(a);
  if (proto !== Object.getPrototypeOf(b)) return false;
  if (ArrayBuffer.isView(a)) {
    if (a instanceof DataView) return false;
    const x = a as unknown as ArrayLike<unknown>;
    const y = b as unknown as ArrayLike<unknown>;
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return false;
    return true;
  }
  if (Array.isArray(a)) {
    const y = b as unknown[];
    if (a.length !== y.length) return false;
    for (let i = 0; i < a.length; i++) {
      // Un trou n'est pas un `undefined` : `toEqual` les distingue aussi, on la laisse décider.
      if (!(i in a) || !(i in y)) return false;
      if (!sameData(a[i], y[i])) return false;
    }
    // Pas d'autre clé qu'un indice.
    return Object.keys(a).length === a.length && Object.keys(y).length === y.length;
  }
  if (proto !== Object.prototype && proto !== null) return false;
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  // Prototype nu ou `Object.prototype` : `for…in` ne voit que les clés propres, sans allouer leur liste.
  let count = 0;
  for (const key in x) {
    if (!Object.prototype.hasOwnProperty.call(y, key) || !sameData(x[key], y[key])) return false;
    count++;
  }
  for (const key in y) if (Object.prototype.hasOwnProperty.call(y, key)) count--;
  return count === 0 && Object.getOwnPropertySymbols(a).length === 0 && Object.getOwnPropertySymbols(b).length === 0;
};
