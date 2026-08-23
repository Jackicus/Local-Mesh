// Mirrors .claude/skills/ (the canonical copy) into .agents/skills/ so tools
// that read either location see the same skills. Edit skills under
// .claude/skills/ only, then run: npm run sync-skills
import { cpSync, rmSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, '.claude', 'skills');
const target = path.join(root, '.agents', 'skills');

if (!existsSync(source)) {
  console.error(`Nothing to sync: ${source} does not exist.`);
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });

const skills = readdirSync(source, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

console.log(`Synced ${skills.length} skill(s) to .agents/skills: ${skills.join(', ')}`);
