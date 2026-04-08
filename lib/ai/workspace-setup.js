import { execFile } from 'child_process';
import { existsSync, mkdirSync, symlinkSync, unlinkSync, lstatSync } from 'fs';
import path from 'path';
import { getConfig } from '../config.js';

/**
 * Run a command and return stdout. Rejects on non-zero exit.
 */
function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        return reject(err);
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * Ensure workspace directory exists and contains the git repo
 * on the correct branch. Idempotent — safe to call on every message.
 *
 * Replaces Docker entrypoint scripts: setup-git.sh, clone.sh, feature-branch.sh.
 *
 * @param {object} opts
 * @param {string} opts.workspaceDir - Absolute path to workspace directory (the git repo root)
 * @param {string} opts.repo - GitHub owner/repo (e.g. "owner/repo")
 * @param {string} opts.branch - Base branch (e.g. "main")
 * @param {string} [opts.featureBranch] - Feature branch to create/checkout
 * @param {string} [opts.chatMode] - 'agent' or 'code'
 */
export async function ensureWorkspaceRepo({ workspaceDir, repo, branch, featureBranch, chatMode }) {
  const ghToken = getConfig('GH_TOKEN');
  const env = { ...process.env };
  if (ghToken) env.GH_TOKEN = ghToken;

  const execOpts = { cwd: workspaceDir, env };

  // 1. Create workspace directory
  mkdirSync(workspaceDir, { recursive: true });

  // 2. Clone if not already a git repo
  const hasGit = existsSync(path.join(workspaceDir, '.git'));
  if (!hasGit) {
    if (!repo) throw new Error('ensureWorkspaceRepo: repo is required for initial clone');
    await run('git', ['clone', '--branch', branch || 'main', `https://github.com/${repo}`, '.'], execOpts);
  }

  // 3. Git identity (only if not already configured)
  try {
    await run('git', ['config', 'user.name'], execOpts);
  } catch {
    // Not configured — derive from GitHub token
    if (ghToken) {
      try {
        const userJson = await run('gh', ['api', 'user', '-q', '{name: .name, login: .login, email: .email, id: .id}'], execOpts);
        const user = JSON.parse(userJson);
        const name = user.name || user.login;
        const email = user.email || `${user.id}+${user.login}@users.noreply.github.com`;
        await run('git', ['config', 'user.name', name], execOpts);
        await run('git', ['config', 'user.email', email], execOpts);
      } catch (err) {
        console.error('[workspace-setup] Failed to set git identity:', err.message);
      }
    }
  }

  // 4. Feature branch checkout
  if (!featureBranch) return;

  // Already on the right branch locally?
  try {
    await run('git', ['rev-parse', '--verify', featureBranch], execOpts);
    // Branch exists locally — make sure we're on it
    const current = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], execOpts);
    if (current !== featureBranch) {
      await run('git', ['checkout', featureBranch], execOpts);
    }
    return;
  } catch {
    // Branch doesn't exist locally — check remote
  }

  try {
    const remoteCheck = await run('git', ['ls-remote', '--heads', 'origin', featureBranch], execOpts);
    if (remoteCheck) {
      // Remote branch exists — checkout tracking it
      await run('git', ['checkout', '-B', featureBranch, `origin/${featureBranch}`], execOpts);
    } else {
      // Create new branch and push
      await run('git', ['checkout', '-b', featureBranch], execOpts);
      await run('git', ['push', '-u', 'origin', featureBranch], execOpts);
    }
  } catch (err) {
    console.error('[workspace-setup] Feature branch error:', err.message);
    throw err;
  }
}

/**
 * Activate agent-job-secrets skill in the workspace when in agent chatMode.
 * Mirrors Docker setup.sh: ln -sfn ../library/agent-job-secrets skills/active/agent-job-secrets
 * Idempotent — skips if library skill doesn't exist.
 *
 * @param {string} workspaceDir - Absolute path to workspace (git repo root)
 * @param {string} chatMode - 'agent' or 'code'
 */
export function ensureSkills(workspaceDir, chatMode) {
  if (chatMode !== 'agent') return;

  const librarySkill = path.join(workspaceDir, 'skills', 'library', 'agent-job-secrets');
  if (!existsSync(librarySkill)) return;

  const activeDir = path.join(workspaceDir, 'skills', 'active');
  mkdirSync(activeDir, { recursive: true });

  const link = path.join(activeDir, 'agent-job-secrets');

  // ln -sfn: remove existing symlink/file before creating (force + no-deref)
  try {
    const stat = lstatSync(link);
    if (stat) unlinkSync(link);
  } catch {
    // doesn't exist — fine
  }

  symlinkSync('../library/agent-job-secrets', link);
}
