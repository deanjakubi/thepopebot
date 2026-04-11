import { getConfig } from '../config.js';

/**
 * GitHub REST API helper with authentication
 * @param {string} endpoint - API endpoint (e.g., '/repos/owner/repo/...')
 * @param {object} options - Fetch options (method, body, headers)
 * @returns {Promise<object>} - Parsed JSON response
 */
async function githubApi(endpoint, options = {}) {
  const GH_TOKEN = getConfig('GH_TOKEN');
  const res = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${GH_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`GitHub API error: ${res.status} ${error}`);
  }

  return res.json();
}

/**
 * Get workflow runs with optional status and workflow filter
 * @param {string} [status] - Filter by status (in_progress, queued, completed)
 * @param {string} [workflow] - Workflow filename to scope to
 * @returns {Promise<object>} - Workflow runs response
 */
async function getWorkflowRuns(status, { workflow, page = 1, perPage = 100 } = {}) {
  const { GH_OWNER, GH_REPO } = process.env;
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  params.set('per_page', String(perPage));
  params.set('page', String(page));

  const query = params.toString();
  const path = workflow
    ? `/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${workflow}/runs?${query}`
    : `/repos/${GH_OWNER}/${GH_REPO}/actions/runs?${query}`;
  return githubApi(path);
}

/**
 * Get jobs for a specific workflow run
 * @param {number} runId - Workflow run ID
 * @returns {Promise<object>} - Jobs response with steps
 */
async function getWorkflowRunJobs(runId) {
  const { GH_OWNER, GH_REPO } = process.env;
  return githubApi(`/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${runId}/jobs`);
}

/**
 * Get agent job status — checks for running containers via Docker API.
 * Note: agent jobs now run locally, not via GitHub Actions.
 * @param {string} [agentJobId] - Optional specific agent job ID to filter by
 * @returns {Promise<object>} - Status summary with agent_jobs array
 */
async function getAgentJobStatus(agentJobId) {
  // Agent jobs run locally as Docker containers, not as GitHub Actions workflows.
  // Check for running containers matching the agent-job pattern.
  try {
    const { listContainers, inspectContainer } = await import('./docker.js');
    const containers = await listContainers('thepopebot-agent-job-');

    const agentJobs = containers
      .filter(c => {
        if (agentJobId) {
          const shortId = agentJobId.replace(/-/g, '').slice(0, 8);
          return c.name.includes(shortId);
        }
        return true;
      })
      .map(c => ({
        agent_job_id: c.name.replace('thepopebot-agent-job-', ''),
        container_name: c.name,
        status: c.state,
      }));

    const runningCount = agentJobs.filter(j => j.status === 'running').length;

    return {
      agent_jobs: agentJobs,
      running: runningCount,
    };
  } catch (err) {
    console.error('[getAgentJobStatus] Failed:', err.message);
    return { agent_jobs: [], running: 0 };
  }
}

/**
 * Get full runners status: unified list of all workflow runs with counts
 * @param {number} [page=1] - Page number for pagination
 * @returns {Promise<object>} - { runs, hasMore, counts }
 */
async function getRunnersStatus(page = 1) {
  const data = await getWorkflowRuns(null, { page, perPage: 10 });

  const runs = (data.workflow_runs || []).map(run => ({
    run_id: run.id,
    branch: run.head_branch,
    status: run.status,
    conclusion: run.conclusion,
    workflow_name: run.name,
    started_at: run.created_at,
    updated_at: run.updated_at,
    duration_seconds: Math.round((Date.now() - new Date(run.created_at).getTime()) / 1000),
    html_url: run.html_url,
  }));

  return {
    runs,
    hasMore: page * 25 < (data.total_count || 0),
  };
}

/**
 * Trigger a workflow via workflow_dispatch
 * @param {string} workflowId - Workflow file name (e.g., 'upgrade-event-handler.yml')
 * @param {string} [ref='main'] - Git ref to run the workflow on
 * @param {object} [inputs={}] - Workflow inputs
 */
async function triggerWorkflowDispatch(workflowId, ref = 'main', inputs = {}) {
  const { GH_OWNER, GH_REPO } = process.env;
  const res = await fetch(
    `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${workflowId}/dispatches`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getConfig('GH_TOKEN')}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref, inputs }),
    }
  );
  if (!res.ok && res.status !== 204) {
    const error = await res.text();
    throw new Error(`GitHub API error: ${res.status} ${error}`);
  }
  return { success: true };
}

/**
 * Fetch the session log (.jsonl) for an agent job from the GitHub repo at a specific commit.
 * @param {string} agentJobId - The agent job ID (used to locate logs/{agentJobId}/)
 * @param {string} commitSha - Git commit SHA to read from
 * @returns {Promise<string>} - Log content or empty string if unavailable
 */
async function fetchAgentJobLog(agentJobId, commitSha) {
  if (!commitSha) return '';
  const { GH_OWNER, GH_REPO } = process.env;
  try {
    const files = await githubApi(
      `/repos/${GH_OWNER}/${GH_REPO}/contents/logs/${agentJobId}?ref=${encodeURIComponent(commitSha)}`
    );
    if (!Array.isArray(files)) return '';
    const logFile = files.find(f => f.name.endsWith('.jsonl'));
    if (!logFile || !logFile.download_url) return '';
    const res = await fetch(logFile.download_url, {
      headers: { 'Authorization': `Bearer ${getConfig('GH_TOKEN')}` },
    });
    if (!res.ok) return '';
    return await res.text();
  } catch (err) {
    console.error('Failed to fetch agent job log:', err.message);
    return '';
  }
}

/**
 * Fetch open pull requests for the repository.
 * @returns {Promise<object[]>} - Array of open PRs
 */
async function getOpenPullRequests() {
  const { GH_OWNER, GH_REPO } = process.env;
  const pulls = await githubApi(
    `/repos/${GH_OWNER}/${GH_REPO}/pulls?state=open&sort=created&direction=desc&per_page=100`
  );
  return pulls.map(pr => ({
    id: pr.id,
    number: pr.number,
    title: pr.title,
    html_url: pr.html_url,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    user: pr.user?.login || 'unknown',
    head_branch: pr.head?.ref || '',
    base_branch: pr.base?.ref || '',
  }));
}

/**
 * List repositories accessible to the authenticated user.
 * @returns {Promise<{full_name: string, default_branch: string}[]>}
 */
async function listRepositories() {
  const repos = await githubApi('/user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator,organization_member');

  // GitHub fine-grained PATs grant implicit metadata:read on all affiliated repos,
  // so /user/repos returns repos outside the token's scope. There is no API to query
  // which repos a PAT is scoped to. Workaround: probe write access with an invalid
  // ref creation (null SHA). 422 = has access, 403 = no access. Nothing is created.
  const probes = await Promise.allSettled(repos.map(async (r) => {
    const res = await fetch(`https://api.github.com/repos/${r.full_name}/git/refs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getConfig('GH_TOKEN')}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        ref: 'refs/heads/__access_probe__',
        sha: '0000000000000000000000000000000000000000',
      }),
    });
    return { repo: r, status: res.status };
  }));

  return probes
    .filter(p => p.status === 'fulfilled' && p.value.status !== 403)
    .map(p => ({
      full_name: p.value.repo.full_name,
      default_branch: p.value.repo.default_branch,
    }));
}

/**
 * List branches for a repository.
 * @param {string} repoFullName - e.g. "owner/repo"
 * @returns {Promise<{name: string, isDefault: boolean}[]>}
 */
async function listBranches(repoFullName) {
  const [owner, repo] = repoFullName.split('/');
  const [branches, repoInfo] = await Promise.all([
    githubApi(`/repos/${owner}/${repo}/branches?per_page=100`),
    githubApi(`/repos/${owner}/${repo}`),
  ]);
  const defaultBranch = repoInfo.default_branch;
  return branches.map(b => ({
    name: b.name,
    isDefault: b.name === defaultBranch,
  }));
}

/**
 * Create a new repository for the authenticated user.
 * Uses auto_init to create an initial README commit (which creates the default branch).
 * @param {string} name - Repository name
 * @returns {Promise<{full_name: string, default_branch: string}>}
 */
async function createRepository(name) {
  const data = await githubApi('/user/repos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, auto_init: true, private: true }),
  });
  return { full_name: data.full_name, default_branch: data.default_branch };
}

export {
  githubApi,
  getWorkflowRuns,
  getWorkflowRunJobs,
  getAgentJobStatus,
  getRunnersStatus,
  triggerWorkflowDispatch,
  fetchAgentJobLog,
  getOpenPullRequests,
  listRepositories,
  listBranches,
  createRepository,
};
