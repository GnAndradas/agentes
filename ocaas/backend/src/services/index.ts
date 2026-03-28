import { EventService } from './EventService.js';
import { AgentService } from './AgentService.js';
import { TaskService } from './TaskService.js';
import { SkillService } from './SkillService.js';
import { ToolService } from './ToolService.js';
import { PermissionService } from './PermissionService.js';
import { GenerationService } from './GenerationService.js';
import { ApprovalService } from '../approval/ApprovalService.js';
import { NotificationService } from '../notifications/NotificationService.js';

export interface Services {
  eventService: EventService;
  agentService: AgentService;
  taskService: TaskService;
  skillService: SkillService;
  toolService: ToolService;
  permissionService: PermissionService;
  generationService: GenerationService;
  approvalService: ApprovalService;
  notificationService: NotificationService;
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
  const approvalService = new ApprovalService(eventService);
  const notificationService = new NotificationService(
    eventService,
    process.env.TELEGRAM_BOT_TOKEN,
    process.env.TELEGRAM_CHAT_ID
  );

  instance = {
    eventService,
    agentService,
    taskService,
    skillService,
    toolService,
    permissionService,
    generationService,
    approvalService,
    notificationService,
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
  ApprovalService,
  NotificationService,
};
