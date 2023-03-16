import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getConfig } from "../config";
import fs from "fs";

const currDir = process.cwd();

beforeEach(() => {
  // create a tmp dir
  const dirPath = fs.mkdtempSync("pk-test-config");
  // set the cwd to the tmp dir
  process.chdir(dirPath);
  fs.writeFileSync("script.js", 'console.log("hello world")');
});

afterEach(() => {
  // switch back to the original dir
  const tmpDir = process.cwd();
  process.chdir(currDir);
  // remove the tmp dir
  fs.rmdirSync(tmpDir, { recursive: true });
});

describe("config", () => {
  it("should return a default config", () => {
    const config = getConfig(undefined, { main: "script.js" });
    expect(config).toMatchInlineSnapshot(`
      {
        "main": "./script.js",
        "vars": {},
      }
    `);
  });

  it("should return a config with overrides", () => {
    const config = getConfig(undefined, {
      main: "script.js",
      vars: {
        test: "test",
      },
    });
    expect(config).toMatchInlineSnapshot(`
      {
        "main": "./script.js",
        "vars": {
          "test": "test",
        },
      }
    `);
  });

  it("should read values from a .env file", () => {
    fs.writeFileSync(".env", "test=test");
    const config = getConfig(undefined, { main: "script.js" });
    expect(config).toMatchInlineSnapshot(`
      {
        "main": "./script.js",
        "vars": {
          "test": "test",
        },
      }
    `);
  });

  it("should read values from a .env file and override with overrides", () => {
    fs.writeFileSync(".env", "test=test");
    const config = getConfig(undefined, {
      main: "script.js",
      vars: {
        test: "test2",
      },
    });
    expect(config).toMatchInlineSnapshot(`
      {
        "main": "./script.js",
        "vars": {
          "test": "test2",
        },
      }
    `);
  });

  it("should read values from a config file", () => {
    fs.writeFileSync(
      "partykit.json",
      JSON.stringify({
        main: "script.js",
        vars: {
          test: "test",
        },
      })
    );
    const config = getConfig(undefined, undefined);
    expect(config).toMatchInlineSnapshot(`
      {
        "define": {},
        "main": "./script.js",
        "vars": {
          "test": "test",
        },
      }
    `);
  });

  it("should read values from a config file and override with config from a .env file", () => {
    fs.writeFileSync(
      "partykit.json",
      JSON.stringify({
        main: "script.js",
        vars: {
          test: "test",
        },
      })
    );
    fs.writeFileSync(".env", "test=test2");
    const config = getConfig(undefined, undefined);
    expect(config).toMatchInlineSnapshot(`
      {
        "define": {},
        "main": "./script.js",
        "vars": {
          "test": "test2",
        },
      }
    `);
  });

  it("should throw an error if the config file is not valid JSON", () => {
    fs.writeFileSync("partykit.json", "test");
    expect(() =>
      getConfig(undefined, undefined)
    ).toThrowErrorMatchingInlineSnapshot(
      "\"JSON5: invalid character 'e' at 1:2\""
    );
  });

  it("should throw an error if the config file is not valid JSON5", () => {
    fs.writeFileSync("partykit.json5", "test");
    expect(() =>
      getConfig(undefined, undefined)
    ).toThrowErrorMatchingInlineSnapshot(
      "\"JSON5: invalid character 'e' at 1:2\""
    );
  });

  it("should throw an error if the config file is not valid JSONC", () => {
    fs.writeFileSync("partykit.jsonc", "test");
    expect(() =>
      getConfig(undefined, undefined)
    ).toThrowErrorMatchingInlineSnapshot(
      "\"JSON5: invalid character 'e' at 1:2\""
    );
  });

  // account
  describe("account", () => {
    it("should not error on a string account", () => {
      fs.writeFileSync(
        "partykit.json",
        JSON.stringify({
          main: "script.js",
          account: "test",
        })
      );
      const config = getConfig(undefined, undefined);
      expect(config).toMatchInlineSnapshot(`
          {
            "account": "test",
            "define": {},
            "main": "./script.js",
            "vars": {},
          }
        `);
    });

    it("should error on a non-string account", () => {
      fs.writeFileSync(
        "partykit.json",
        JSON.stringify({
          account: 1,
        })
      );
      expect(() =>
        getConfig(undefined, undefined)
      ).toThrowErrorMatchingInlineSnapshot(
        `
          "[
            {
              \\"code\\": \\"invalid_type\\",
              \\"expected\\": \\"string\\",
              \\"received\\": \\"number\\",
              \\"path\\": [
                \\"account\\"
              ],
              \\"message\\": \\"Expected string, received number\\"
            }
          ]"
        `
      );
    });
  });

  // name
  describe("name", () => {
    it("should not error on a string name", () => {
      fs.writeFileSync(
        "partykit.json",
        JSON.stringify({
          main: "script.js",
          name: "test",
        })
      );
      const config = getConfig(undefined, undefined);
      expect(config).toMatchInlineSnapshot(`
          {
            "define": {},
            "main": "./script.js",
            "name": "test",
            "vars": {},
          }
        `);
    });

    it("should error on a non-string name", () => {
      fs.writeFileSync(
        "partykit.json",
        JSON.stringify({
          main: "script.js",
          name: 1,
        })
      );
      expect(() => getConfig(undefined, undefined))
        .toThrowErrorMatchingInlineSnapshot(`
            "[
              {
                \\"code\\": \\"invalid_type\\",
                \\"expected\\": \\"string\\",
                \\"received\\": \\"number\\",
                \\"path\\": [
                  \\"name\\"
                ],
                \\"message\\": \\"Expected string, received number\\"
              }
            ]"
          `);
    });
  });

  // main
  describe("main", () => {
    it("should not error on a string main (1)", () => {
      fs.writeFileSync(
        "partykit.json",
        JSON.stringify({
          main: "test.js",
        })
      );
      fs.writeFileSync("test.js", "test");
      const config = getConfig(undefined, undefined);
      expect(config).toMatchInlineSnapshot(`
          {
            "define": {},
            "main": "./test.js",
            "vars": {},
          }
        `);
    });

    it("should not error on a string main (2)", () => {
      fs.writeFileSync(
        "partykit.json",
        JSON.stringify({
          // main: "test.js",
        })
      );
      fs.writeFileSync("test.js", "test");
      const config = getConfig(undefined, {
        main: "test.js",
      });
      expect(config).toMatchInlineSnapshot(`
          {
            "define": {},
            "main": "./test.js",
            "vars": {},
          }
        `);
    });

    it("should error on a non-string main", () => {
      fs.writeFileSync(
        "partykit.json",
        JSON.stringify({
          main: 1,
        })
      );
      expect(() => getConfig(undefined, undefined))
        .toThrowErrorMatchingInlineSnapshot(`
            "[
              {
                \\"code\\": \\"invalid_type\\",
                \\"expected\\": \\"string\\",
                \\"received\\": \\"number\\",
                \\"path\\": [
                  \\"main\\"
                ],
                \\"message\\": \\"Expected string, received number\\"
              }
            ]"
          `);
    });

    it("should error when main is not provided", () => {
      fs.writeFileSync("partykit.json", JSON.stringify({}));
      expect(() =>
        getConfig(undefined, undefined)
      ).toThrowErrorMatchingInlineSnapshot(
        '"Missing entry point, please specify \\"main\\" in your config"'
      );
    });

    it("should error on a path that doesn't exist", () => {
      fs.writeFileSync(
        "partykit.json",
        JSON.stringify({
          main: "test",
        })
      );
      expect(() =>
        getConfig(undefined, undefined)
      ).toThrowErrorMatchingInlineSnapshot('"Could not find main: test"');
    });

    it("should resolve config.main path relative to the config file", () => {
      fs.mkdirSync("some/path/src", { recursive: true });
      fs.writeFileSync(
        "some/path/partykit.json",
        JSON.stringify({
          main: "src/test.js",
        })
      );
      fs.writeFileSync("some/path/src/test.js", "test");
      const config = getConfig("some/path/partykit.json", undefined);
      expect(config).toMatchInlineSnapshot(`
          {
            "define": {},
            "main": "./some/path/src/test.js",
            "vars": {},
          }
        `);
    });
  });

  // port
  describe("port", () => {
    it("should not error on a number port", () => {
      fs.writeFileSync(
        "partykit.json",
        JSON.stringify({
          main: "script.js",
          port: 1,
        })
      );
      const config = getConfig(undefined, undefined);
      expect(config).toMatchInlineSnapshot(`
          {
            "define": {},
            "main": "./script.js",
            "port": 1,
            "vars": {},
          }
        `);
    });

    it("should error on a non-number port", () => {
      fs.writeFileSync(
        "partykit.json",
        JSON.stringify({
          main: "script.js",
          port: "1",
        })
      );
      expect(() => getConfig(undefined, undefined))
        .toThrowErrorMatchingInlineSnapshot(`
          "[
            {
              \\"code\\": \\"invalid_type\\",
              \\"expected\\": \\"number\\",
              \\"received\\": \\"string\\",
              \\"path\\": [
                \\"port\\"
              ],
              \\"message\\": \\"Expected number, received string\\"
            }
          ]"
        `);
    });
  });

  // vars
  describe("vars", () => {
    it("should not error on a object vars", () => {
      fs.writeFileSync(
        "partykit.json",
        JSON.stringify({
          main: "script.js",
          vars: {
            test: "test",
          },
        })
      );
      const config = getConfig(undefined, undefined);
      expect(config).toMatchInlineSnapshot(`
          {
            "define": {},
            "main": "./script.js",
            "vars": {
              "test": "test",
            },
          }
        `);
    });

    it("should error on a non-object vars (1)", () => {
      fs.writeFileSync(
        "partykit.json",
        JSON.stringify({
          main: "script.js",
          vars: "test",
        })
      );
      expect(() => getConfig(undefined, undefined))
        .toThrowErrorMatchingInlineSnapshot(`
          "[
            {
              \\"code\\": \\"invalid_type\\",
              \\"expected\\": \\"object\\",
              \\"received\\": \\"string\\",
              \\"path\\": [
                \\"vars\\"
              ],
              \\"message\\": \\"Expected object, received string\\"
            }
          ]"
        `);
    });

    it("should error on a non-object vars (2)", () => {
      fs.writeFileSync(
        "partykit.json",
        JSON.stringify({
          main: "script.js",
          vars: { x: 1 },
        })
      );
      expect(() =>
        getConfig(undefined, {
          // @ts-expect-error purposely wrong
          vars: "test",
        })
      ).toThrowErrorMatchingInlineSnapshot(`
          "[
            {
              \\"code\\": \\"invalid_type\\",
              \\"expected\\": \\"object\\",
              \\"received\\": \\"string\\",
              \\"path\\": [
                \\"vars\\"
              ],
              \\"message\\": \\"Expected object, received string\\"
            }
          ]"
        `);
    });
  });

  // define
  describe("define", () => {
    it("should not error on a object define", () => {
      fs.writeFileSync(
        "partykit.json",
        JSON.stringify({
          main: "script.js",
          define: {
            test: "test",
          },
        })
      );
      const config = getConfig(undefined, undefined);
      expect(config).toMatchInlineSnapshot(`
          {
            "define": {
              "test": "test",
            },
            "main": "./script.js",
            "vars": {},
          }
        `);
    });

    it("should error on a non-object define (1)", () => {
      fs.writeFileSync(
        "partykit.json",
        JSON.stringify({
          main: "script.js",
          define: "test",
        })
      );
      expect(() => getConfig(undefined, undefined))
        .toThrowErrorMatchingInlineSnapshot(`
          "[
            {
              \\"code\\": \\"invalid_type\\",
              \\"expected\\": \\"object\\",
              \\"received\\": \\"string\\",
              \\"path\\": [
                \\"define\\"
              ],
              \\"message\\": \\"Expected object, received string\\"
            }
          ]"
        `);
    });

    it("should error on a non-object define (2)", () => {
      fs.writeFileSync(
        "partykit.json",
        JSON.stringify({
          main: "script.js",
          define: { x: 1 },
        })
      );
      expect(() =>
        getConfig(undefined, {
          // @ts-expect-error purposely wrong
          define: "test",
        })
      ).toThrowErrorMatchingInlineSnapshot(`
          "[
            {
              \\"code\\": \\"invalid_type\\",
              \\"expected\\": \\"object\\",
              \\"received\\": \\"string\\",
              \\"path\\": [
                \\"define\\"
              ],
              \\"message\\": \\"Expected object, received string\\"
            }
          ]"
        `);
    });
  });
});
