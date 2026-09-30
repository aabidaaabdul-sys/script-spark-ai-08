/** Local (browser) persistence: IndexedDB for project JSON + image blobs. */

const DB = "scriptforge-storyboard";
const VER = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects");
      if (!db.objectStoreNames.contains("assets")) db.createObjectStore("assets");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  return new Promise<T>((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export type Asset = {
  id: string;
  projectId: string;
  type: "image" | "storyboard" | "export";
  mimeType: string;
  size: number;
  dataUrl: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export const putProject = (id: string, v: unknown) => tx("projects", "readwrite", (s) => s.put(v, id));
export const getProject = <T,>(id: string) => tx<T | undefined>("projects", "readonly", (s) => s.get(id) as IDBRequest<T | undefined>);
export const putAsset = (a: Asset) => tx("assets", "readwrite", (s) => s.put(a, a.id));
export const getAsset = (id: string) => tx<Asset | undefined>("assets", "readonly", (s) => s.get(id) as IDBRequest<Asset | undefined>);
export const deleteAsset = (id: string) => tx("assets", "readwrite", (s) => s.delete(id));
