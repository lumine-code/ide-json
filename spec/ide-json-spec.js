const fs = require("fs");
const { resolveServer, managedServer } = require("../lib/server");
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

  it("prefers a managed install over the bundled server", async () => {
    const managed = { modulePath: "/managed/server.js", version: "9.9.9" };
    const launch = await resolveServer("", managed);
    expect(launch.args[0]).toBe(managed.modulePath);
    // Reported in the session details, so which copy is running is visible.
    expect(launch.version).toBe("9.9.9");
    expect((await resolveServer(process.execPath, managed)).command).toBe(process.execPath);
  });

  it("declares the bundled floor so uninstall falls back", () => {
    // The dependency is always present, so removing the managed copy returns to
    // a working server rather than to none.
    expect(managedServer.source).toBe("npm");
    expect(managedServer.bundled).toBe(true);
    expect(managedServer.module).toContain("node_modules/");
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
    lumine.config.set("ide-json.json.allowComments", false);
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

  it("announces .json files as JSONC while comments are allowed", () => {
    // The server has no setting for this: the comment policy follows the
    // language id, so the setting can only work by changing what we announce.
    expect(lumine.config.get("ide-json.json.allowComments")).toBe(true);
    expect(adapter.languageIdForScope("source.json")).toBe("jsonc");
    lumine.config.set("ide-json.json.allowComments", false);
    expect(adapter.languageIdForScope("source.json")).toBe("json");
    // JSONC never depends on the setting.
    expect(adapter.languageIdForScope("source.json.jsonc")).toBe("jsonc");
  });

  it("restarts sessions when the language id would change", () => {
    // A document's language id is fixed at didOpen, so the running session has
    // to reopen its documents for the new setting to reach the server.
    const restarted = [];
    const session = { adapter: null, state: "running" };
    const service = {
      registerAdapter(registered) {
        session.adapter = registered;
        return { dispose() {} };
      },
      getSessions: () => [session],
      restart: async (target) => restarted.push(target),
    };
    const subscription = main.consumeIdeClient(service);
    lumine.config.set("ide-json.json.allowComments", false);
    expect(restarted).toEqual([session]);
    subscription.dispose();
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

describe("ide-json feature contracts", () => {
  const features = [
    "diagnostics",
    "autocomplete",
    "hover",
    "symbols",
    "outline",
    "format",
    "codeActions",
  ];
  const definitions = require("../package.json").configSchema.features.properties;

  beforeEach(async () => {
    await lumine.packages.activatePackage("ide-json");
  });

  afterEach(async () => {
    for (const feature of features) lumine.config.unset(`ide-json.features.${feature}`);
    await lumine.packages.deactivatePackage("ide-json");
  });

  for (const feature of features) {
    it(`exposes ${feature} as an independent enabled-by-default switch`, () => {
      expect(definitions[feature].type).toBe("boolean");
      expect(definitions[feature].default).toBe(true);
      const keyPath = `ide-json.features.${feature}`;
      expect(lumine.config.get(keyPath)).toBe(true);
      lumine.config.set(keyPath, false);
      expect(lumine.config.get(keyPath)).toBe(false);
    });
  }
});
