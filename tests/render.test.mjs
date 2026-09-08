import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";

test("Vue editor and existing command forms render with their saved values", async (t) => {
  const stubs = {
    localStorage: { getItem: () => null, setItem() {} },
    sessionStorage: { getItem: () => null },
    document: { documentElement: { dataset: {} } },
  };
  for (const [name, value] of Object.entries(stubs)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() =>
      previous
        ? Object.defineProperty(globalThis, name, previous)
        : delete globalThis[name],
    );
  }
  const server = await createServer({
    configFile: false,
    plugins: [vue()],
    server: { middlewareMode: true },
    appType: "custom",
  });
  try {
    const { default: App } = await server.ssrLoadModule("/src/App.vue");
    const html = await renderToString(createSSRApp(App));
    assert.match(html, /プレビュー/);
    assert.match(html, /フェード時間|フェード色/);
    assert.match(html, /1行目を削除/);
    assert.doesNotMatch(html, /この行の演出を再生/);
    assert.match(
      html,
      /株式会社アノパーク・ピュアプリバッドエンド[\s\S]*聖香天使ピュアプリピーチエロ怪人化育成記録　脚本作成ツール/,
    );
    assert.doesNotMatch(html, />ライト</);
    assert.doesNotMatch(html, /Scenario Studio|話者一覧|>Master</);
    const { default: CommandEditor } = await server.ssrLoadModule(
      "/src/components/CommandEditor.vue",
    );
    const form = await renderToString(
      createSSRApp(CommandEditor, { initial: "[char:move:saved_id:0.73:1.4]" }),
    );
    assert.match(form, /value="saved_id"/);
    assert.match(form, /value="0.73"/);
    assert.match(form, /value="1.4"/);
    const suggestedForm = await renderToString(
      createSSRApp(CommandEditor, {
        preset: "char:show",
        characterIds: ["白崎桃香", "宮森楓"],
      }),
    );
    assert.match(suggestedForm, /value="白崎桃香"/);
    assert.match(suggestedForm, /value="宮森楓"/);
  } finally {
    await server.close();
  }
});
