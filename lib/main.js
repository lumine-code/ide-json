const { CompositeDisposable } = require("lumine");
const { resolveServer, managedServer } = require("./server");

const setting = (key) => lumine.config.get(`ide-json.${key}`);

const jsonSettings = () => ({
  validate: { enable: setting("features.diagnostics") },
  format: { enable: setting("features.format") },
  keepLines: { enable: setting("json.keepLines") },
  schemas: setting("json.schemas") || [],
  resultLimit: setting("json.resultLimit"),
});

const httpSettings = () => ({
  proxy: setting("http.proxy"),
  proxyStrictSSL: setting("http.proxyStrictSSL"),
});

module.exports = {
  consumeIdeClient(service) {
    const adapter = {
      id: "ide-json",
      displayName: "JSON Language Server",
      grammarScopes: ["source.json", "source.json.jsonc"],
      languageIdForScope(scope) {
        return scope === "source.json.jsonc" ? "jsonc" : "json";
      },
      sessionScope: "project-root",
      settingsKeyPaths: ["ide-json"],
      managedServer,
      async resolveServer(context) {
        const launch = await resolveServer(setting("serverPath"), context.managedServer);
        return { ...launch, cwd: context.rootPath, transport: "stdio" };
      },
      getInitializationOptions() {
        return {
          provideFormatter: setting("features.format"),
          handledSchemaProtocols: ["file", "http", "https"],
        };
      },
      getSettings() {
        return { json: jsonSettings(), http: httpSettings() };
      },
      getWorkspaceConfiguration(section) {
        if (!section) return { json: jsonSettings(), http: httpSettings() };
        if (section === "json") return jsonSettings();
        if (section === "http") return httpSettings();
        return undefined;
      },
    };

    const subscriptions = new CompositeDisposable(service.registerAdapter(adapter));
    const restart = () => {
      for (const session of service.getSessions()) {
        if (session.adapter !== adapter || ["stopping", "stopped"].includes(session.state))
          continue;
        service.restart(session).catch((error) => {
          lumine.notifications.addError("Unable to restart JSON Language Server", {
            detail: error.message,
            dismissable: true,
          });
        });
      }
    };
    for (const key of ["serverPath", "features.format"]) {
      subscriptions.add(lumine.config.onDidChange(`ide-json.${key}`, restart));
    }
    return subscriptions;
  },
};
