const options = ["a", "b", "c"];
let index = 0;

function draw() {
  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write("Choose\n");
  options.forEach((option, i) => {
    process.stdout.write(`${i === index ? "❯" : " "} ${option}\n`);
  });
}

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (key) => {
  if (key === "\x1b[B") index = Math.min(options.length - 1, index + 1);
  else if (key === "\x1b[A") index = Math.max(0, index - 1);
  else if (key === "\r") {
    process.stdout.write(`\nchose ${options[index]}\n`);
    process.exit(0);
  }
  draw();
});
draw();
