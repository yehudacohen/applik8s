import { register } from "node:module";

register(new URL("./node-typescript-loader.mjs", import.meta.url), import.meta.url);
