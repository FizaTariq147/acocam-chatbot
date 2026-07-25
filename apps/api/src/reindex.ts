import { createPlatform } from './platform.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

async function main() {
  const platform = createPlatform();
  const entries = await fs.readdir(platform.tenantsDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('_')) continue;
    const pack = await platform.config.load(e.name);
    const result = await platform.knowledge.reindexTenant(e.name, pack.knowledgeDir);
    console.log(`Reindexed ${e.name}: ${result.chunks} chunks`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
