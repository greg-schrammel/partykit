import * as esbuild from "esbuild";
import * as fs from "fs";

import { zodToJsonSchema } from "zod-to-json-schema";

import * as ConfigSchema from "../src/config-schema";

process.chdir(`${__dirname}/../`);

const minify = process.argv.includes("--minify");
const isProd = process.argv.includes("--production");

// generate facade/generated.js
esbuild.buildSync({
  entryPoints: ["facade/source.ts"],
  banner: {
    js: "// AUTOGENERATED, DO NOT EDIT!\n /* eslint-disable */",
  },
  format: "esm",
  outfile: "facade/generated.js",
  platform: "neutral",
});

// generate bin/index.js
esbuild.buildSync({
  entryPoints: ["src/bin.tsx"],
  bundle: true,
  format: "esm",
  outfile: "dist/bin.mjs",
  platform: "node",
  packages: "external",
  banner: isProd
    ? { js: "#!/usr/bin/env node" }
    : { js: "#!/usr/bin/env node --enable-source-maps" },
  sourcemap: true,
  minify,
  define: {
    PARTYKIT_API_BASE: `"${process.env.PARTYKIT_API_BASE}"`,
    "process.env.NODE_ENV": `"${isProd ? "production" : "development"}"`,
  },
});

fs.chmodSync("dist/bin.mjs", 0o755);

// generate dist/server.js
esbuild.buildSync({
  entryPoints: ["src/server.ts"],
  bundle: true,
  format: "esm",
  outfile: "dist/server.js",
  sourcemap: true,
  minify,
  // platform: "node", // ?neutral?
});

// generate json schema for the config

const jsonSchema = zodToJsonSchema(ConfigSchema.schema);
// write to file
fs.writeFileSync("schema.json", JSON.stringify(jsonSchema, null, 2) + "\n");
