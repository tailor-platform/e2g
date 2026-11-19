// Waits for a go signal, then writes more than one pty read's worth of lines and exits,
// so a test can keep its event loop busy until the whole burst sits unread in the pty.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// about 10 KiB: more than one 4 KiB pty read, but within the Linux pty buffer
const [dir, count = "1000"] = process.argv.slice(2);
writeFileSync(join(dir, "pid"), String(process.pid));
while (!existsSync(join(dir, "go")));
let out = "";
for (let i = 1; i <= Number(count); i++) out += `line ${i}\n`;
process.stdout.write(`${out}END`);
