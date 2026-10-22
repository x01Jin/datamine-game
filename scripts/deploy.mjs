import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const ghpages = require('gh-pages');

const BRANCH = 'gh-pages';
const repo = execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], {
  encoding: 'utf8',
}).trim();

function api(args, body) {
  return execFileSync('gh', ['api', ...args], {
    encoding: 'utf8',
    input: body ? JSON.stringify(body) : undefined,
  });
}

function readSite() {
  try {
    return JSON.parse(api([`repos/${repo}/pages`]));
  } catch (error) {
    if (String(error.stderr).includes('404')) return null;
    throw error;
  }
}

function enablePages() {
  const source = { branch: BRANCH, path: '/' };
  const site = readSite();
  if (!site) {
    return JSON.parse(
      api(['-X', 'POST', `repos/${repo}/pages`, '--input', '-'], { build_type: 'legacy', source }),
    );
  }
  if (site.source?.branch === BRANCH && site.source?.path === '/') return site;
  return JSON.parse(
    api(['-X', 'PUT', `repos/${repo}/pages`, '--input', '-'], { build_type: 'legacy', source }),
  );
}

console.log(`Deploying ${repo} to ${BRANCH}`);
execFileSync('npm run build', { stdio: 'inherit', shell: true });

await ghpages.publish('dist', {
  branch: BRANCH,
  nojekyll: true,
  message: `Deploy ${new Date().toISOString()}`,
});

let site = null;
for (let attempt = 0; attempt < 5 && !site; attempt++) {
  try {
    site = enablePages();
  } catch (error) {
    if (attempt === 4) throw error;
    await sleep(3000);
  }
}

console.log(`Pages source: ${BRANCH} -> ${site.html_url}`);
execFileSync('gh', ['repo', 'edit', repo, '--homepage', site.html_url], { stdio: 'ignore' });
console.log('The first build can take a minute to appear.');
