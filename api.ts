import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const HOME = Bun.env.HOME || process.env.HOME || "";
const POOL_DIR = `${HOME}/.gitproc_pool`;
const DB_PATH = `${POOL_DIR}/gitproc.db`;
const SHARED_REPOS_DIR = `${POOL_DIR}/shared_repos`;

// Ensure pool directory and database exist, and initialize DB schema if needed
async function ensurePoolDirAndDb() {
  await mkdir(POOL_DIR, { recursive: true });
  await mkdir(SHARED_REPOS_DIR, { recursive: true });
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

// Generate a consistent directory name for a repo URL
function getSharedRepoDir(repoUrl: string): string {
  const hash = createHash('sha256').update(repoUrl).digest('hex').substring(0, 12);
  const repoName = repoUrl.split('/').pop()?.replace(/\.git$/, '') || 'repo';
  return join(SHARED_REPOS_DIR, `${repoName}-${hash}`);
}

// Ensure the shared repository exists for a given repo URL
async function ensureSharedRepo(repoUrl: string): Promise<string> {
  const sharedRepoDir = getSharedRepoDir(repoUrl);
  
  if (!existsSync(sharedRepoDir)) {
    await Bun.$`git clone --bare ${repoUrl} ${sharedRepoDir}`;
  } else {
    // Update the shared repo to get latest refs
    await Bun.$`git -C ${sharedRepoDir} fetch --all --prune`;
  }
  
  return sharedRepoDir;
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

export interface ParallelToolOptions {
  maxParallelism: number; // Maximum number of concurrent checkouts for this tool
  repo?: string; // Repository URL, will be inferred if not provided
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

export async function acquireCheckout(repoArg?: string, maxCheckouts?: number): Promise<AcquireResult> {
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

  // Check if max checkouts limit would be exceeded
  if (maxCheckouts && maxCheckouts > 0) {
    const currentCount = db.query("SELECT COUNT(*) as count FROM checkout_metadata WHERE repo = ?").get(repo) as {count: number};
    if (currentCount.count >= maxCheckouts) {
      throw new Error(`Maximum checkouts limit (${maxCheckouts}) reached for repository: ${repo}`);
    }
  }

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
      // Ensure shared repo exists and is up to date
      const sharedRepoDir = await ensureSharedRepo(repo);
      
      // Create worktree from shared repo
      await Bun.$`git -C ${sharedRepoDir} worktree add ${directory} HEAD`;
    } catch (cloneErr) {
      // Clean up the row if clone fails
      const db2 = await ensurePoolDirAndDb();
      db2.run("DELETE FROM checkout_metadata WHERE checkout = ?", [checkout]);
      throw new Error(`git worktree creation failed: ${cloneErr}`);
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

/**
 * Remove a checkout completely (for cleanup)
 */
export async function removeCheckout(checkout: string): Promise<void> {
  checkoutSchema.parse(checkout);
  const db = await ensurePoolDirAndDb();
  const row = db.query("SELECT repo FROM checkout_metadata WHERE checkout = ?").get(checkout) as {repo?: string} | undefined;
  if (!row) throw new Error(`${checkout} does not exist in the pool`);
  
  const directory = `${POOL_DIR}/${checkout}`;
  const sharedRepoDir = getSharedRepoDir(row.repo!);
  
  try {
    // Remove the worktree
    await Bun.$`git -C ${sharedRepoDir} worktree remove ${directory} --force`;
  } catch (err) {
    // If worktree removal fails, just remove the directory
    await Bun.$`rm -rf ${directory}`;
  }
  
  // Remove from database
  db.run("DELETE FROM checkout_metadata WHERE checkout = ?", [checkout]);
}

/**
 * Acquire a checkout with specified max parallelism constraint for tools
 * This is a convenience wrapper around acquireCheckout for tools that need to limit parallelism
 */
export async function acquireForTool(options: ParallelToolOptions): Promise<AcquireResult> {
  return acquireCheckout(options.repo, options.maxParallelism);
} 