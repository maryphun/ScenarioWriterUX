const DB_NAME = "scenario-editor-v1";
let connection;
function db() {
  if (!connection)
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("drafts");
        request.result.createObjectStore("assets", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  return connection;
}
async function transaction(store, mode, operation) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store, mode),
      request = operation(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export const clearDrafts = () =>
  transaction("drafts", "readwrite", (store) => store.clear());
export const putAsset = (asset) =>
  transaction("assets", "readwrite", (store) => store.put(asset));
export const readAssets = () =>
  transaction("assets", "readonly", (store) => store.getAll());
export const removeAsset = (id) =>
  transaction("assets", "readwrite", (store) => store.delete(id));
export function download(name, text, mime = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type: mime })),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
