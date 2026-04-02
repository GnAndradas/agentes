import { EventService } from './EventService.js';
import { AgentService } from './AgentService.js';
import { TaskService } from './TaskService.js';
import { SkillService } from './SkillService.js';
import { ToolService } from './ToolService.js';
import { PermissionService } from './PermissionService.js';
import { GenerationService } from './GenerationService.js';
import { ManualResourceService } from './ManualResourceService.js';
import { ChannelService } from './ChannelService.js';
import { ApprovalService } from '../approval/ApprovalService.js';
import { NotificationService } from '../notifications/NotificationService.js';
import {
  ActivationWorkflowService,
  initActivationWorkflow,
} from './ActivationWorkflowService.js';
import { getAgentGenerator } from '../generator/AgentGenerator.js';
import { getSkillGenerator } from '../generator/SkillGenerator.js';
import { getToolGenerator } from '../generator/ToolGenerator.js';
import type { GenerationType } from '../types/domain.js';
import { initResourceService, ResourceService } from '../resources/index.js';
import {
  initSkillExecutionService,
  SkillExecutionService,
} from '../skills/execution/index.js';

export interface Services {
  eventService: EventService;
  agentService: AgentService;
  taskService: TaskService;
  skillService: SkillService;
  toolService: ToolService;
  permissionService: PermissionService;
  generationService: GenerationService;
  manualResourceService: ManualResourceService;
  channelService: ChannelService;
  approvalService: ApprovalService;
  notificationService: NotificationService;
  activationWorkflow: ActivationWorkflowService;
  resourceService: ResourceService;
  skillExecutionService: SkillExecutionService;
}

let instance: Services | null = null;

export function initServices(): Services {
  if (instance) return instance;

  const eventService = new EventService();
  const agentService = new AgentService(eventService);
  const taskService = new TaskService(eventService);
  const skillService = new SkillService(eventService);
  const toolService = new ToolService(eventService);
  const permissionService = new PermissionService();
  const generationService = new GenerationService(eventService);
  const manualResourceService = new ManualResourceService(
    eventService,
    agentService,
    skillService,
    toolService
  );
  const channelService = new ChannelService(taskService, eventService);
  const approvalService = new ApprovalService(eventService);
  const notificationService = new NotificationService(
    eventService,
    process.env.TELEGRAM_BOT_TOKEN,
    process.env.TELEGRAM_CHAT_ID
  );

  // Central workflow service for approvals and activations
  const activationWorkflow = initActivationWorkflow(
    eventService,
    generationService,
    approvalService
  );

  // Configure the activation callback to dispatch to generators
  activationWorkflow.setActivateCallback(async (generationId: string, type: GenerationType) => {
    switch (type) {
      case 'agent':
        await getAgentGenerator().activate(generationId);
        break;
      case 'skill':
        await getSkillGenerator().activate(generationId);
        break;
      case 'tool':
        await getToolGenerator().activate(generationId);
        break;
      default:
        throw new Error(`Unknown generation type: ${type}`);
    }
  });

  // Initialize unified resource service
  const resourceService = initResourceService(skillService, toolService);

  // Initialize skill execution service
  const skillExecutionService = initSkillExecutionService(
    skillService,
    toolService,
    eventService
  );

  instance = {
    eventService,
    agentService,
    taskService,
    skillService,
    toolService,
    permissionService,
    generationService,
    manualResourceService,
    channelService,
    approvalService,
    notificationService,
    activationWorkflow,
    resourceService,
    skillExecutionService,
  };

  return instance;
}

export function getServices(): Services {
  if (!instance) throw new Error('Services not initialized');
  return instance;
}

export {
  EventService,
  AgentService,
  TaskService,
  SkillService,
  ToolService,
  PermissionService,
  GenerationService,
  ManualResourceService,
  ChannelService,
  ApprovalService,
  NotificationService,
  ActivationWorkflowService,
  ResourceService,
  SkillExecutionService,
};
