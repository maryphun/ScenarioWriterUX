export const GRAPHIC_FOLDERS = [
  { name: "Characters", kind: "sprite", label: "立ち絵" },
  { name: "CG", kind: "cg", label: "CG" },
  { name: "Backgrounds", kind: "background", label: "背景" },
];

const imageExtension = /\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i;

// The browser supplies a relative path beginning with the selected directory.
// Only the three artwork folders under that directory enter the session cache.
export function scanGraphicFolder(files) {
  const records = [];
  const counts = Object.fromEntries(GRAPHIC_FOLDERS.map(({ name }) => [name, 0]));
  const keys = new Set();

  for (const file of files) {
    const path = file.webkitRelativePath;
    const [root, directory, ...segments] = (path || "").split("/");
    const folder = GRAPHIC_FOLDERS.find(({ name }) => name === directory);
    if (root !== "Graphic" || !folder || !segments.length || !imageExtension.test(file.name))
      continue;

    const name = file.name.replace(imageExtension, "");
    const key = name.toLowerCase();
    if (keys.has(key))
      throw new Error(`同じ素材名「${name}」が複数あります。ファイル名を確認してください。`);

    keys.add(key);
    counts[folder.name]++;
    records.push({ file, id: `graphic:${path}`, name, kind: folder.kind, projectFolder: folder.name });
  }

  const missing = GRAPHIC_FOLDERS.filter(({ name }) => !counts[name]);
  if (missing.length)
    throw new Error(`Assets/Graphic を選択してください。画像が見つからないフォルダー：${missing.map(({ name }) => name).join("、")}`);

  records.sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true }));
  return { counts, records };
}
