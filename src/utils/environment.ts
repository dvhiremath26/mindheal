import { execSync } from 'child_process';
import { logger } from './logger';

export function isCI(): boolean {
  return !!(
    process.env.CI ||
    process.env.CONTINUOUS_INTEGRATION ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.BITBUCKET_PIPELINES ||
    process.env.JENKINS_URL ||
    process.env.CIRCLECI ||
    process.env.TRAVIS ||
    process.env.BUILD_NUMBER
  );
}

export type GitProvider = 'github' | 'gitlab' | 'bitbucket' | 'unknown';

export function detectGitProvider(): GitProvider {
  try {
    const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();

    if (remoteUrl.includes('github.com')) return 'github';
    if (remoteUrl.includes('gitlab.com') || remoteUrl.includes('gitlab')) return 'gitlab';
    if (remoteUrl.includes('bitbucket.org') || remoteUrl.includes('bitbucket')) return 'bitbucket';

    return 'unknown';
  } catch {
    logger.debug('Could not detect git provider from remote URL');
    return 'unknown';
  }
}

export function getRepoInfo(): { owner: string; name: string } | null {
  try {
    const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();

    // Handle SSH: git@github.com:owner/repo.git
    const sshMatch = remoteUrl.match(/[:\/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (sshMatch) {
      return { owner: sshMatch[1], name: sshMatch[2] };
    }

    // Handle HTTPS: https://github.com/owner/repo.git
    const httpsMatch = remoteUrl.match(/\/([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (httpsMatch) {
      return { owner: httpsMatch[1], name: httpsMatch[2] };
    }

    return null;
  } catch {
    logger.debug('Could not detect repo info from remote URL');
    return null;
  }
}

export function getGitRootDir(): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

export function getCurrentBranch(): string | null {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}
