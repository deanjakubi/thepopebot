import { randomUUID } from 'crypto';
import { eq, desc } from 'drizzle-orm';
import { getDb } from './index.js';
import { codeWorkspaces } from './schema.js';

/**
 * Create a new code workspace.
 * @param {string} userId
 * @param {object} options
 * @param {string} [options.containerName] - Docker container DNS name (null until launched)
 * @param {string} [options.repo] - GitHub repo full name (e.g. "owner/repo")
 * @param {string} [options.branch] - Git branch name
 * @param {string} [options.title='Code Workspace']
 * @param {string} [options.id] - Optional ID (UUID). Generated if not provided.
 * @returns {object} The created workspace
 */
export function createCodeWorkspace(userId, { containerName = null, repo = null, branch = null, title = 'Code Workspace', id = null } = {}) {
  const db = getDb();
  const now = Date.now();
  const workspace = {
    id: id || randomUUID(),
    userId,
    containerName,
    repo,
    branch,
    title,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(codeWorkspaces).values(workspace).run();
  return workspace;
}

/**
 * Update the container name on an existing workspace (when Docker launches).
 * Also stores the coding agent used so recovery can recreate with the same agent.
 * @param {string} id - Workspace ID
 * @param {string} containerName - Docker container name
 * @param {string} [codingAgent] - Coding agent identifier (e.g. 'claude-code', 'codex-cli')
 */
export function updateContainerName(id, containerName, codingAgent) {
  const db = getDb();
  const set = { containerName, updatedAt: Date.now() };
  if (codingAgent !== undefined) set.codingAgent = codingAgent;
  db.update(codeWorkspaces)
    .set(set)
    .where(eq(codeWorkspaces.id, id))
    .run();
}

/**
 * Get a single code workspace by ID.
 * @param {string} id
 * @returns {object|undefined}
 */
export function getCodeWorkspaceById(id) {
  const db = getDb();
  return db.select().from(codeWorkspaces).where(eq(codeWorkspaces.id, id)).get();
}

/**
 * Get all code workspaces for a user, ordered by most recently updated.
 * @param {string} userId
 * @returns {object[]}
 */
export function getCodeWorkspacesByUser(userId) {
  const db = getDb();
  return db
    .select()
    .from(codeWorkspaces)
    .where(eq(codeWorkspaces.userId, userId))
    .orderBy(desc(codeWorkspaces.updatedAt))
    .all();
}

/**
 * Update a code workspace's title.
 * @param {string} id
 * @param {string} title
 */
export function updateCodeWorkspaceTitle(id, title) {
  const db = getDb();
  db.update(codeWorkspaces)
    .set({ title, updatedAt: Date.now() })
    .where(eq(codeWorkspaces.id, id))
    .run();
}

/**
 * Toggle a code workspace's starred status.
 * @param {string} id
 * @returns {number} The new starred value (0 or 1)
 */
export function toggleCodeWorkspaceStarred(id) {
  const db = getDb();
  const workspace = db.select({ starred: codeWorkspaces.starred }).from(codeWorkspaces).where(eq(codeWorkspaces.id, id)).get();
  const newValue = workspace?.starred ? 0 : 1;
  db.update(codeWorkspaces)
    .set({ starred: newValue })
    .where(eq(codeWorkspaces.id, id))
    .run();
  return newValue;
}

/**
 * Update the base branch on an existing workspace.
 * @param {string} id - Workspace ID
 * @param {string} branch - Base branch name
 */
export function updateBranch(id, branch) {
  const db = getDb();
  db.update(codeWorkspaces)
    .set({ branch, updatedAt: Date.now() })
    .where(eq(codeWorkspaces.id, id))
    .run();
}

/**
 * Update the feature branch on an existing workspace (e.g. after creating a feature branch).
 * The base branch (branch column) is not modified — only the feature_branch column is set.
 * @param {string} id - Workspace ID
 * @param {string} featureBranch - Feature branch name
 */
export function updateFeatureBranch(id, featureBranch) {
  const db = getDb();
  db.update(codeWorkspaces)
    .set({ featureBranch, updatedAt: Date.now() })
    .where(eq(codeWorkspaces.id, id))
    .run();
}

/**
 * Update the last interactive commit hash on a workspace.
 * Used to scope session context injection to only new commits.
 * @param {string} id - Workspace ID
 * @param {string} commitHash - Git commit hash (HEAD at time of injection)
 */
export function updateLastInjectedCommit(id, commitHash) {
  const db = getDb();
  db.update(codeWorkspaces)
    .set({ lastInteractiveCommit: commitHash, updatedAt: Date.now() })
    .where(eq(codeWorkspaces.id, id))
    .run();
}

/**
 * Update the hasChanges flag on a workspace.
 * @param {string} id - Workspace ID
 * @param {boolean} hasChanges - Whether the workspace has uncommitted changes
 */
export function updateHasChanges(id, hasChanges) {
  const db = getDb();
  db.update(codeWorkspaces)
    .set({ hasChanges: hasChanges ? 1 : 0, updatedAt: Date.now() })
    .where(eq(codeWorkspaces.id, id))
    .run();
}

/**
 * Delete a code workspace.
 * @param {string} id
 */
export function deleteCodeWorkspace(id) {
  const db = getDb();
  db.delete(codeWorkspaces).where(eq(codeWorkspaces.id, id)).run();
}
