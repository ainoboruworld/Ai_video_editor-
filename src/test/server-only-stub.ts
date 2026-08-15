/**
 * `server-only` throws when imported outside a server component, which is
 * exactly the guard we want in the app — and exactly what stops unit tests from
 * importing server modules. Vitest aliases the package to this no-op so pure
 * helpers (error mapping, ranking, schemas) can be tested directly.
 */
export {};
