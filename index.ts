import { listCheckouts, filterCheckouts, acquireCheckout, releaseCheckout, removeCheckout } from "./api";

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
  const result = await acquireCheckout(repoArg);
  console.log(result.directory);
  console.log(`(id: ${result.id})`);
}

// Release (unlock) a checkout
async function cmdRelease(checkout: string) {
  await releaseCheckout(checkout);
  console.log(`Released ${checkout}`);
}

// Remove a checkout completely
async function cmdRemove(checkout: string) {
  await removeCheckout(checkout);
  console.log(`Removed ${checkout}`);
}

function usage() {
  console.log(`\nUsage: gitproc <command> [args]\n
Commands:
  list, ls                List all slots and their lock status
  filter, -F, grep <pat>  Filter slots by name matching pattern
  acquire, a <slot>       Manually acquire lock on a slot (prints directory and id)
  release, r <id>         Release lock on slot by id (not directory)
  remove, rm <id>         Remove a checkout completely (deletes worktree)
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
      case "remove":
      case "rm":
        if (!args[0]) throw new Error("Checkout required for remove");
        await cmdRemove(args[0]);
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