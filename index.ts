import { listCheckouts, filterCheckouts, acquireCheckout, releaseCheckout } from "./api";

// List all checkouts and their lock status from the database
async function cmdList() {
  const rows = await listCheckouts();
  if (rows.length === 0) {
    console.log("No checkouts found in the pool. Use 'acquire' to create one.");
    return;
  }
  for (const row of rows) {
    if (row.status === "locked") {
      console.log(`${row.checkout}: LOCKED PID=${row.pid} REPO=${row.repo} at ${row.timestamp}`);
    } else {
      console.log(`${row.checkout}: free`);
    }
  }
}

// Filter checkouts by name
async function cmdFilter(pattern: string) {
  const checkouts = await filterCheckouts(pattern);
  for (const checkout of checkouts) {
    console.log(checkout);
  }
}

// Acquire (lock) a checkout for a repo
async function cmdAcquire(repoArg?: string) {
  const path = await acquireCheckout(repoArg);
  console.log(path);
}

// Release (unlock) a checkout
async function cmdRelease(checkout: string) {
  await releaseCheckout(checkout);
  console.log(`Released ${checkout}`);
}

function usage() {
  console.log(`\nUsage: gitproc <command> [args]\n
Commands:
  list, ls                List all slots and their lock status
  filter, -F, grep <pat>  Filter slots by name matching pattern
  acquire, a <slot>       Manually acquire lock on a slot
  release, r <slot>       Release lock on slot (rm .lock)
  help, -h, --help        Show this help message
`);
}

export async function main() {
  const [cmd, ...args] = Bun.argv.slice(2);
  if (["help", "--help", "-h", "-H", undefined].includes(cmd)) {
    usage();
    process.exit(0);
  }
  try {
    switch (cmd) {
      case "list":
      case "ls":
        await cmdList();
        break;
      case "filter":
      case "-F":
      case "grep":
        if (!args[0]) throw new Error("Pattern required for filter");
        await cmdFilter(args[0]);
        break;
      case "acquire":
      case "a":
        await cmdAcquire(args[0]);
        break;
      case "release":
      case "r":
        if (!args[0]) throw new Error("Checkout required for release");
        await cmdRelease(args[0]);
        break;
      default:
        console.log(`Unknown command: ${cmd}`);
        usage();
        process.exit(1);
    }
  } catch (err) {
    console.error((err as Error).message);
    usage();
    process.exit(1);
  }
}