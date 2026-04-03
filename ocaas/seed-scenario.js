// OCAAS SCENARIO SEED SCRIPT (Translator Example)
// Pegar en: backend/scripts/seed-scenario.js

import { getServices } from '../src/services/index.js';
import { getTaskRouter } from '../src/core/taskRouter.js';

async function run() {
  const { agentService, skillService, toolService, taskService } = getServices();
  const taskRouter = getTaskRouter();

  console.log("== OCAAS Scenario Seed ==");

  // --- Avoid duplicates ---
  const existingAgents = await agentService.getAll();
  const exists = existingAgents.find(a => a.name === "TranslatorAgent");
  if (exists) {
    console.log("Scenario already exists. Skipping.");
    return;
  }

  // --- Create Tool ---
  const tool = await toolService.create({
    name: "TextTransformer",
    description: "Transforms text (mock translation)",
    type: "function",
    config: {
      fn: "(input) => input.toUpperCase()"
    }
  });

  console.log("Tool created:", tool.id);

  // --- Create Skill ---
  const skill = await skillService.create({
    name: "TranslateText",
    description: "Translate text using TextTransformer",
    toolIds: [tool.id],
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" }
      },
      required: ["text"]
    }
  });

  console.log("Skill created:", skill.id);

  // --- Create Agent ---
  const agent = await agentService.create({
    name: "TranslatorAgent",
    description: "Agent that translates text",
    skillIds: [skill.id],
    autonomy: "autonomous",
    isActive: true
  });

  console.log("Agent created:", agent.id);

  // --- Create Task ---
  const task = await taskService.create({
    title: "Translate example text",
    description: "Translate 'hello world'",
    type: "general",
    priority: 2,
    input: {
      text: "hello world"
    }
  });

  console.log("Task created:", task.id);

  // --- Submit to pipeline ---
  await taskRouter.submit(task);

  console.log("Task submitted to pipeline");

  console.log("== DONE ==");
}

run().catch(err => {
  console.error("Error:", err);
});