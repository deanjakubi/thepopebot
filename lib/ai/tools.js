import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createJob } from '../tools/create-job.js';
import { getJobStatus } from '../tools/github.js';
import { getCurrentCodeModeType } from './agent.js';
import { getConfig } from '../config.js';

const createJobTool = tool(
  async ({ job_description }) => {
    const result = await createJob(job_description);
    return JSON.stringify({
      success: true,
      job_id: result.job_id,
      branch: result.branch,
      title: result.title,
    });
  },
  {
    name: 'create_job',
    description:
      'Use when asked to create a job Create an autonomous job that runs a Docker agent in a container. The Docker agent has full filesystem access, web search, browser automation, and other abilities. The job description you provide becomes the Docker agent\'s task prompt. Returns the job ID and branch name.',
    schema: z.object({
      job_description: z
        .string()
        .describe(
          'Detailed job description including context and requirements. Be specific about what needs to be done.'
        ),
    }),
  }
);

const getJobStatusTool = tool(
  async ({ job_id }) => {
    const result = await getJobStatus(job_id);
    return JSON.stringify(result);
  },
  {
    name: 'get_job_status',
    description:
      'Use when youy want to get the status from a job create with create_job ONLY that returned a Job ID. IMPORTANT never use this unless except to get status on a job you recent ran with create_job.',
    schema: z.object({
      job_id: z
        .string()
        .optional()
        .describe(
          'Optional: specific Job ID to check. If omitted, returns all running jobs.'
        ),
    }),
  }
);

const planPopebotUpdatesTool = tool(
  async ({ plan_prompt }) => {
    try {
      const { randomUUID } = await import('crypto');
      const codingAgent = getConfig('CODING_AGENT') || 'claude-code';
      const containerName = `${codingAgent}-headless-${randomUUID().slice(0, 8)}`;

      const ghOwner = getConfig('GH_OWNER');
      const ghRepo = getConfig('GH_REPO');
      if (!ghOwner || !ghRepo) {
        return JSON.stringify({ success: false, error: 'GH_OWNER or GH_REPO not configured' });
      }
      const repo = `${ghOwner}/${ghRepo}`;

      const { runHeadlessContainer } = await import('../tools/docker.js');
      const { backendApi } = await runHeadlessContainer({
        containerName,
        repo,
        branch: 'main',
        taskPrompt: plan_prompt,
        mode: 'plan',
        codingAgent,
      });

      return JSON.stringify({
        success: true,
        status: 'started',
        containerName,
        codingAgent,
        backendApi,
      });
    } catch (err) {
      console.error('[plan_popebot_updates] Failed:', err);
      return JSON.stringify({
        success: false,
        error: err.message || 'Failed to launch investigation container',
      });
    }
  },
  {
    name: 'plan_popebot_updates',
    description:
      'Use when developing a plan to a prompt, cron, trigger, skill or ANY code update to an installed ThePopeBot repository instance. Or when PopeBot debugging issues.',
    schema: z.object({
      plan_prompt: z.string().describe(
        'A direct copy of the coding task including all relevant context from the conversation.'
      ),
    }),
    returnDirect: true,
  }
);


/**
 * Create a get_repository_details tool bound to a specific repo/branch.
 * Fetches CLAUDE.md and README.md from the repo via GitHub API.
 * @param {object} context
 * @param {string} context.repo - GitHub repo (e.g. "owner/repo")
 * @param {string} context.branch - Git branch
 * @returns {import('@langchain/core/tools').StructuredTool}
 */
function createGetRepositoryDetailsTool({ repo, branch }) {
  return tool(
    async () => {
      const { githubApi } = await import('../tools/github.js');
      const files = ['CLAUDE.md', 'README.md'];
      const results = {};

      for (const file of files) {
        try {
          const data = await githubApi(`/repos/${repo}/contents/${file}?ref=${branch}`);
          results[file] = Buffer.from(data.content, 'base64').toString('utf8');
        } catch {
          results[file] = 'Not found';
        }
      }

      return JSON.stringify(results);
    },
    {
      name: 'get_repository_details',
      description:
        'Use when you need details about the code repository like the CLAUDE.md and README.md',
      schema: z.object({}),
    }
  );
}

/**
 * Create a start_headless_coding tool bound to a specific workspace context.
 * Launches an ephemeral headless container that runs a task, commits, and merges back.
 * @param {object} context
 * @param {string} context.repo - GitHub repo
 * @param {string} context.branch - Base branch
 * @param {string} context.workspaceId - Pre-created workspace row ID
 * @returns {import('@langchain/core/tools').StructuredTool}
 */
function createStartHeadlessCodingTool({ repo, branch, workspaceId }) {
  return tool(
    async ({ task_description }) => {
      try {
        const { randomUUID } = await import('crypto');

        const { getCodeWorkspaceById } = await import('../db/code-workspaces.js');
        const workspace = getCodeWorkspaceById(workspaceId);
        const featureBranch = workspace?.featureBranch || `thepopebot/new-chat-${workspaceId.replace(/-/g, '').slice(0, 8)}`;

        const mode = getCurrentCodeModeType() === 'plan' ? 'plan' : 'dangerous';

        const { runHeadlessContainer } = await import('../tools/docker.js');

        // Read workspace's codingAgent setting
        const codingAgent = workspace?.codingAgent || getConfig('CODING_AGENT') || 'claude-code';
        const containerName = `${codingAgent}-headless-${randomUUID().slice(0, 8)}`;

        const { backendApi } = await runHeadlessContainer({
          containerName, repo, branch, featureBranch, workspaceId,
          taskPrompt: task_description,
          mode,
          codingAgent,
        });

        return JSON.stringify({
          success: true,
          status: 'started',
          containerName,
          featureBranch,
          codingAgent,
          backendApi,
        });
      } catch (err) {
        console.error('[start_headless_coding_agent] Failed:', err);
        return JSON.stringify({
          success: false,
          error: err.message || 'Failed to launch headless coding task',
        });
      }
    },
    {
      name: 'start_headless_coding_agent',
      description:
        'Use when you need to plan or execute a coding task.',
      schema: z.object({
        task_description: z.string().describe(
          'A direct copy of the coding task including all relevant context from the conversation.'
        ),
      }),
      returnDirect: true,
    }
  );
}

export { createJobTool, getJobStatusTool, planPopebotUpdatesTool, createStartHeadlessCodingTool, createGetRepositoryDetailsTool };
