export const LAST_ACTIVE_DRAFT_SETTING = 'last-active-draft-id'

export async function requestPersistentLocalStorage(storage = navigator.storage): Promise<boolean | null> {
  if (!storage?.persisted || !storage.persist) return null
  if (await storage.persisted()) return true
  return storage.persist()
}
