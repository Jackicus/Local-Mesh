import { useMemo } from 'react';
import { MODELS } from '../../../core/models';
import { useModelStore } from '../../stores/modelStore';

/**
 * The models a job can actually be pointed at, in registry order.
 *
 * `install.ready` is main's answer, not a guess assembled here: a model with
 * no weights to fetch and no packages of its own (the test shape) is ready the
 * moment the app starts, and one that needs both is ready only when both have
 * landed. The Generate view never says which half is missing — that is the
 * Models view's subject — it just stops offering what cannot run.
 */
export function useInstalledModelIds(): Set<string> {
  const [models] = useModelStore();
  return useMemo(
    () => new Set(Object.values(models.installs).filter((i) => i.ready).map((i) => i.id)),
    [models.installs]
  );
}

/** Registry entries that are installed, in the order the registry lists them. */
export function useInstalledModels() {
  const installed = useInstalledModelIds();
  return useMemo(() => MODELS.filter((m) => installed.has(m.id)), [installed]);
}
