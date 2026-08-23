# stores/

App-wide state, one small store per concern — plain module state + `useSyncExternalStore`, shaped like `dockStore.ts`. A store owned by one component can live beside it (`Toast/toastStore.ts`).
