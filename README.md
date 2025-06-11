# gitproc: Git repository multi-checkouts for parallel processing workloads

## Concept

gitproc is a CLI tool for managing a pool of working directories (checkouts), each containing a clone of a git repository. It is designed for workflows where you need to run multiple concurrent or isolated tasks (such as CI jobs, test runs, or ephemeral environments) that each require a separate, lockable working copy (checkout) of a repository.

The tool provides:
- **Checkout management**: Each checkout is a directory (e.g., `checkout-1`, `checkout-2`, ...) under a global pool directory (`~/.gitproc_pool`).
- **Locking**: Prevents multiple processes from using the same checkout simultaneously.
- **Metadata tracking**: Uses SQLite to track which process and which git repo is using each checkout, along with timestamps and other info.
- **Simple CLI**: Commands to list, filter, acquire, and release checkouts, with aliases for convenience.

## Checkout Structure

- Each checkout is a subdirectory under `~/.gitproc_pool` (e.g., `checkout-1`, `checkout-2`, ...).
- Each checkout contains a git clone of a repository.
- All lock state and metadata (process, repository, timestamp, etc.) are managed in the SQLite database (`~/.gitproc_pool/gitproc.db`).

## Commands

| Command(s)                | Description                                              |
|---------------------------|---------------------------------------------------------|
| `list`, `ls`              | List all checkouts and their lock status                |
| `filter`, `-F`, `grep`    | Filter checkouts by name matching a pattern             |
| `acquire`, `a` `[repo-url-or-name]` | Acquire (lock) a checkout for a repository (argument optional) |
| `release`, `r` `<checkout>` | Release (unlock) a checkout                         |
| `help`, `--help`, `-h`, `-H` | Show usage/help message                           |

### Command Details

- **list / ls**
  - Shows all checkouts, indicating which are free and which are locked (with PID and timestamp), as recorded in the database.
- **filter / -F / grep `<pattern>`**
  - Lists checkouts whose names match the given pattern.
- **acquire / a `[repo-url-or-name]`**
  - Acquires (locks) a checkout for the specified repository by recording process info and metadata in the database. If the argument is omitted, the repository is inferred from the current working directory's git remote (e.g., using `git remote get-url origin`).
  - The tool will:
    1. Search for a free checkout in the pool associated with the specified repository.
    2. If no free checkout exists for that repository, it may create a new checkout (see Checkout Creation Policy below).
    3. Lock the checkout, record metadata (repository, process ID, timestamp, etc.) in the database, and print the checkout path for use.
  - This allows for seamless, parallel, and isolated work on the same repository across multiple processes or jobs.
- **release / r `<checkout>`**
  - Unlocks the specified checkout by updating the database to mark it as free.
- **help / --help / -h / -H**
  - Prints a usage/help message.

#### Acquire Command: Options & Considerations
- **Checkout Creation Policy:**
  - If no free checkout exists for a repository, `gitproc` may create a new checkout automatically (default behavior, configurable in the future).
- **Repository Identification:**
  - The tool normalizes repository URLs/names to avoid duplicates (e.g., treats HTTPS and SSH URLs as the same repo where possible).
- **Metadata:**
  - Each checkout records which repository it is associated with, along with process and timestamp info, in the database.
- **User Feedback:**
  - On success, prints the path to the locked checkout.
  - On failure (no available checkout and cannot create), prints a clear error message.

## Future/Planned Features

- **Automatic checkout allocation**: Command to find and lock a free checkout automatically.
- **Integration with git**: Track which repo/branch/commit is checked out in each checkout.
- **Checkout initialization**: Command to create or reset checkouts with fresh git clones.
- **Checkout cleanup**: Remove or reset checkouts that are stale or unused.
- **More metadata**: Store additional info (e.g., user, job, environment) in the database.
