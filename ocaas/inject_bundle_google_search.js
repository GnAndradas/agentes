import { getSystemicGenerator } from './backend/src/generator/index.js';

const systemicGen = getSystemicGenerator();

const run = async () => {
  const result = await systemicGen.generateBundle({
    name: "google-first-result-search",
    description: "Search Google and return first result",
    objective: "Given a query, return the first organic result from Google search",
    capabilities: ["web-search", "scraping"],
  });

  if (!result.success) {
    console.error("❌ Failed:", result.error);
    return;
  }

  console.log("✅ Bundle creado:");
  console.log("Tool:", result.toolId);
  console.log("Skill:", result.skillId);
  console.log("Agent:", result.agentId);
};

run();