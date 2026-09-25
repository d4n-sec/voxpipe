import pkg from "../package.json";

export const VERSION: string = typeof pkg.version === "string" ? pkg.version : "0.0.0";
