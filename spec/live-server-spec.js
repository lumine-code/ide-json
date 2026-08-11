const fs = require("fs");
const os = require("os");
const path = require("path");
const main = require("../lib/main");
const { LiveLspClient, fileUri, position, positionParams } = require("./helpers/live-lsp-client");

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

describe("ide-json bundled server", () => {
  let adapter, client, disposable, rootPath;
  let originalTimeout;

  beforeAll(() => {
    originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 20000;
  });

  afterAll(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
  });

  beforeEach(async () => {
    jasmine.useRealClock();
    await lumine.packages.activatePackage("ide-json");
    ({ adapter, disposable } = registerAdapter());
    rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "ide-json-live-"));
    client = new LiveLspClient(adapter, rootPath);
  });

  afterEach(async () => {
    await client.stop();
    disposable.dispose();
    fs.rmSync(rootPath, { recursive: true, force: true });
    await lumine.packages.deactivatePackage("ide-json");
  });

  it("exercises every advertised capability and the document lifecycle", async () => {
    const schemaPath = path.join(rootPath, "fixture.schema.json");
    fs.writeFileSync(
      schemaPath,
      JSON.stringify({
        type: "object",
        properties: {
          $ref: { type: "string" },
          theme: { enum: ["light", "dark"], description: "Selected theme." },
          accent: { type: "string", format: "color-hex", description: "Accent color." },
        },
        required: ["theme"],
        additionalProperties: false,
      }),
    );
    lumine.config.set("ide-json.json.schemas", [
      { fileMatch: ["fixture.json"], url: fileUri(schemaPath) },
    ]);

    const filePath = path.join(rootPath, "fixture.json");
    const source = [
      "{",
      '  "$ref": "#/theme",',
      '  "theme": "l",',
      '  "accent": "#ff0000",',
      '  "extra": true,',
      "}",
    ].join("\n");
    fs.writeFileSync(filePath, source);
    const uri = fileUri(filePath);
    const { capabilities } = await client.start();
    client.open(uri, "json", source);

    expect(capabilities.diagnosticProvider).toBeDefined();
    expect(capabilities.completionProvider).toBeDefined();
    expect(capabilities.hoverProvider).toBe(true);
    expect(capabilities.documentSymbolProvider).toBe(true);
    expect(capabilities.documentFormattingProvider).toBe(true);
    expect(capabilities.documentRangeFormattingProvider).toBe(true);
    expect(capabilities.colorProvider).toBeDefined();
    expect(capabilities.foldingRangeProvider).toBe(true);
    expect(capabilities.selectionRangeProvider).toBe(true);
    expect(capabilities.documentLinkProvider).toBeDefined();
    expect(capabilities.codeActionProvider).toBe(true);

    const completion = await client.request("textDocument/completion", positionParams(uri, 2, 13));
    expect(completion.items.map(({ label }) => label)).toContain('"light"');

    const hover = await client.request("textDocument/hover", positionParams(uri, 2, 4));
    expect(hover.contents.join(" ")).toContain("Selected theme");

    const symbols = await client.request("textDocument/documentSymbol", {
      textDocument: { uri },
    });
    expect(symbols.map(({ name }) => name)).toContain("theme");

    const edits = await client.request("textDocument/formatting", {
      textDocument: { uri },
      options: { tabSize: 4, insertSpaces: true },
    });
    expect(edits.some(({ newText }) => newText.includes("    "))).toBe(true);

    const rangeEdits = await client.request("textDocument/rangeFormatting", {
      textDocument: { uri },
      range: { start: position(0, 0), end: position(5, 1) },
      options: { tabSize: 4, insertSpaces: true },
    });
    expect(rangeEdits.length).toBeGreaterThan(0);

    const colors = await client.request("textDocument/documentColor", {
      textDocument: { uri },
    });
    expect(colors.length).toBe(1);
    expect(colors[0].color).toEqual({ red: 1, green: 0, blue: 0, alpha: 1 });
    const presentations = await client.request("textDocument/colorPresentation", {
      textDocument: { uri },
      color: colors[0].color,
      range: colors[0].range,
    });
    expect(presentations.map(({ label }) => label)).toContain("#ff0000");

    const folding = await client.request("textDocument/foldingRange", {
      textDocument: { uri },
    });
    expect(folding[0].kind).toBe("object");

    const selection = await client.request("textDocument/selectionRange", {
      textDocument: { uri },
      positions: [position(2, 12)],
    });
    expect(selection[0].parent.parent).toBeDefined();

    const links = await client.request("textDocument/documentLink", {
      textDocument: { uri },
    });
    expect(links[0].target).toContain("#3,12");

    const actions = await client.request("textDocument/codeAction", {
      textDocument: { uri },
      range: { start: position(0, 0), end: position(5, 1) },
      context: { diagnostics: [] },
    });
    expect(actions.map(({ title }) => title)).toContain("Sort JSON");

    const diagnostics = await client.request("textDocument/diagnostic", {
      textDocument: { uri },
    });
    expect(diagnostics.kind).toBe("full");
    expect(diagnostics.items.map(({ message }) => message).join("\n")).toContain(
      "Value is not accepted",
    );
    expect(diagnostics.items.map(({ message }) => message).join("\n")).toContain(
      "Property extra is not allowed",
    );
    expect(diagnostics.items.map(({ message }) => message)).toContain("Trailing comma");

    const fixed = source
      .replace('"l"', '"light"')
      .replace('  "extra": true,\n', "")
      .replace('"#ff0000",', '"#ff0000"');
    client.change(uri, fixed);
    const cleared = await client.request("textDocument/diagnostic", {
      textDocument: { uri },
    });
    expect(cleared.items).toEqual([]);

    client.closeDocument(uri);
    const closed = await client.request("textDocument/diagnostic", {
      textDocument: { uri },
    });
    expect(closed.items).toEqual([]);
  });

  it("accepts JSONC comments and reports its non-strict trailing-comma warning", async () => {
    const filePath = path.join(rootPath, "settings.jsonc");
    const source = ["{", "  // retained comment", '  "enabled": true,', "}"].join("\n");
    fs.writeFileSync(filePath, source);
    const uri = fileUri(filePath);
    await client.start();
    client.open(uri, "jsonc", source);

    const diagnostics = await client.request("textDocument/diagnostic", {
      textDocument: { uri },
    });
    expect(diagnostics.items).toHaveSize(1);
    expect(diagnostics.items[0].message).toBe("Trailing comma");
    expect(diagnostics.items[0].source).toBe("jsonc");
    expect(diagnostics.items[0].severity).toBe(2);
    const symbols = await client.request("textDocument/documentSymbol", {
      textDocument: { uri },
    });
    expect(symbols[0].name).toBe("enabled");
  });
});
