import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { z } from "zod";

const HOME = Bun.env.HOME || process.env.HOME || "";
const POOL_DIR = `${HOME}/.gitproc_pool`;
const DB_PATH = `${POOL_DIR}/gitproc.db`;

// Ensure pool directory and database exist, and initialize DB schema if needed
async function ensurePoolDirAndDb() {
  await mkdir(POOL_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.run(`CREATE TABLE IF NOT EXISTS checkout_metadata (
    checkout TEXT PRIMARY KEY,
    repo TEXT,
    pid INTEGER,
    timestamp TEXT,
    status TEXT
  )`);
  return db;
}

// --- Interfaces ---
export interface CheckoutMetadata {
  checkout: string;
  repo: string;
  pid: number | null;
  timestamp: string | null;
  status: string;
}

export interface AcquireResult {
  id: string; // The checkout name/id, to be used with releaseCheckout
  directory: string; // The full path to the checkout directory
}

// --- Zod Schemas ---
const patternSchema = z.string().min(1, "Pattern is required");
const repoArgSchema = z.string().min(1, "Repository URL or name is required").optional();
const checkoutSchema = z.string().min(1, "Checkout name is required");

export async function listCheckouts(): Promise<CheckoutMetadata[]> {
  const db = await ensurePoolDirAndDb();
  const rows = db.query("SELECT checkout, repo, pid, timestamp, status FROM checkout_metadata").all() as CheckoutMetadata[];
  return rows.map(row => ({
    checkout: row.checkout,
    repo: row.repo,
    pid: row.pid ?? null,
    timestamp: row.timestamp ?? null,
    status: row.status
  }));
}

export async function filterCheckouts(pattern: string): Promise<string[]> {
  patternSchema.parse(pattern);
  const db = await ensurePoolDirAndDb();
  const regex = new RegExp(pattern);
  const rows = db.query("SELECT checkout FROM checkout_metadata").all() as {checkout: string}[];
  return rows.filter(row => regex.test(row.checkout)).map(row => row.checkout);
}

export async function acquireCheckout(repoArg?: string): Promise<AcquireResult> {
  if (repoArg !== undefined) repoArgSchema.parse(repoArg);
  const db = await ensurePoolDirAndDb();
  let repo = repoArg;
  if (!repo) {
    const proc = await Bun.$`git remote get-url origin`;
    repo = proc.stdout.toString().trim();
    if (!repo) throw new Error("Could not infer repository from current directory. Please specify a repo URL or name.");
  }

  let checkout: string;
  let isNew = false;
  let directory: string;

  db.run("BEGIN TRANSACTION");
  try {
    let row = db.query("SELECT checkout FROM checkout_metadata WHERE repo = ? AND status = 'free' LIMIT 1").get(repo) as {checkout?: string} | undefined;
    if (row && row.checkout) {
      checkout = row.checkout;
      // Lock it immediately
      db.run("UPDATE checkout_metadata SET pid = ?, timestamp = ?, status = 'locked' WHERE checkout = ?", [process.pid, new Date().toISOString(), checkout]);
      directory = `${POOL_DIR}/${checkout}`;
    } else {
      const allRows = db.query("SELECT checkout FROM checkout_metadata").all() as {checkout: string}[];
      const nums = allRows.map(r => parseInt((r.checkout || '').replace('checkout-', ''))).filter(n => !isNaN(n));
      const nextNum = nums.length ? Math.max(...nums) + 1 : 1;
      checkout = `checkout-${nextNum}`;
      directory = `${POOL_DIR}/${checkout}`;
      // Insert as locked so no one else can take it
      db.run(
        "INSERT INTO checkout_metadata (checkout, repo, pid, timestamp, status) VALUES (?, ?, ?, ?, 'locked')",
        [checkout, repo, process.pid, new Date().toISOString()]
      );
      isNew = true;
    }
    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }

  if (isNew) {
    try {
      await Bun.$`git clone ${repo} ${directory}`;
    } catch (cloneErr) {
      // Clean up the row if clone fails
      const db2 = await ensurePoolDirAndDb();
      db2.run("DELETE FROM checkout_metadata WHERE checkout = ?", [checkout]);
      throw new Error(`git clone failed: ${cloneErr}`);
    }
  }

  return { id: checkout, directory };
}

/**
 * Release (unlock) a checkout by id (not directory)
 */
export async function releaseCheckout(checkout: string): Promise<void> {
  checkoutSchema.parse(checkout);
  const db = await ensurePoolDirAndDb();
  const row = db.query("SELECT status FROM checkout_metadata WHERE checkout = ?").get(checkout) as {status?: string} | undefined;
  if (!row) throw new Error(`${checkout} does not exist in the pool`);
  if (row.status !== "locked") throw new Error(`${checkout} is not locked`);
  db.run("UPDATE checkout_metadata SET pid = NULL, timestamp = NULL, status = 'free' WHERE checkout = ?", [checkout]);
} 