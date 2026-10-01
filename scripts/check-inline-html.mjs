import { readFileSync } from "node:fs";

const html = readFileSync("client/public/KIMIchord_trees_fixed.html", "utf8");
const match = html.match(/<script>([\s\S]*?)<\/script>/);
if (!match) throw new Error("inline script missing");
new Function(match[1]);
console.log("inline JavaScript syntax OK");
