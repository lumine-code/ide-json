const fs = require("fs");
const { resolveServer } = require("../lib/server");
const main = require("../lib/main");

const registerAdapter = () => {
  let adapter;
  const disposable = main.consumeIdeClient({
    registerAdapter(registered) {
      adapter = registered;
      return { dispose() {} };
    },
    getSessions: () => [],
    restart: async () => {},
  });
  return { adapter, disposable };
};

describe("ide-json server resolution", () => {
  it("prefers the configured path", async () => {
    const launch = await resolveServer(process.execPath);
    expect(launch.command).toBe(process.execPath);
    expect(launch.args).toEqual(["--stdio"]);
  });

  it("falls back to the bundled server module", async () => {
    const launch = await resolveServer("");
    expect(launch.command).toBe(process.execPath);
    expect(fs.existsSync(launch.args[0])).toBe(true);
    expect(launch.args[1]).toBe("--stdio");
    expect(launch.env.ELECTRON_RUN_AS_NODE).toBe("1");
  });
});

describe("ide-json adapter", () => {
  let adapter;
  let disposable;

  beforeEach(async () => {
    await lumine.packages.activatePackage("ide-json");
    ({ adapter, disposable } = registerAdapter());
  });

  afterEach(async () => {
    disposable.dispose();
    await lumine.packages.deactivatePackage("ide-json");
  });

  it("registers JSON and JSONC with their protocol language IDs", async () => {
    expect(adapter.id).toBe("ide-json");
    expect(adapter.grammarScopes).toEqual(["source.json", "source.json.jsonc"]);
    expect(adapter.languageIdForScope("source.json")).toBe("json");
    expect(adapter.languageIdForScope("source.json.jsonc")).toBe("jsonc");
    expect(adapter.settingsKeyPaths).toEqual(["ide-json"]);
    const launch = await adapter.resolveServer({ rootPath: __dirname });
    expect(launch.cwd).toBe(__dirname);
    expect(launch.transport).toBe("stdio");
  });

  it("declares the schema protocols and static formatter capability", () => {
    expect(adapter.getInitializationOptions()).toEqual({
      provideFormatter: true,
      handledSchemaProtocols: ["file", "http", "https"],
    });
    lumine.config.set("ide-json.features.format", false);
    expect(adapter.getInitializationOptions().provideFormatter).toBe(false);
    expect(adapter.getSettings().json.format.enable).toBe(false);
  });

  it("transcribes schemas, result limits and HTTP settings", () => {
    const schemas = [{ fileMatch: ["package.json"], url: "file:///schema.json" }];
    lumine.config.set("ide-json.json.schemas", schemas);
    lumine.config.set("ide-json.json.resultLimit", 123);
    lumine.config.set("ide-json.json.keepLines", true);
    lumine.config.set("ide-json.http.proxy", "http://proxy.test");
    lumine.config.set("ide-json.http.proxyStrictSSL", false);

    expect(adapter.getWorkspaceConfiguration("json")).toEqual({
      validate: { enable: true },
      format: { enable: true },
      keepLines: { enable: true },
      schemas,
      resultLimit: 123,
    });
    expect(adapter.getWorkspaceConfiguration("http")).toEqual({
      proxy: "http://proxy.test",
      proxyStrictSSL: false,
    });
    expect(adapter.getWorkspaceConfiguration()).toEqual(adapter.getSettings());
    expect(adapter.getWorkspaceConfiguration("unknown")).toBeUndefined();
  });

  it("turns schema validation off with the diagnostics feature", () => {
    expect(adapter.getSettings().json.validate.enable).toBe(true);
    lumine.config.set("ide-json.features.diagnostics", false);
    expect(adapter.getSettings().json.validate.enable).toBe(false);
  });

  it("offers switches for exactly the capabilities consumed by the editor", () => {
    const { configSchema } = require("../package.json");
    expect(Object.keys(configSchema.features.properties)).toEqual([
      "diagnostics",
      "autocomplete",
      "hover",
      "symbols",
      "outline",
      "format",
      "codeActions",
    ]);
  });
});
