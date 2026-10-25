export interface CollaboratorProfile {
  id: string;
  name: string;
  role: 'human' | 'agent';
  title: string;
  specialty: string;
  defaultCategory: 'requirement' | 'architecture' | 'ux_flow' | 'ui_spec' | 'devops' | 'qa_test' | 'decision';
  colorHex: string;
  initials: string;
  systemPrompt?: string;
}

export const COLLABORATORS: CollaboratorProfile[] = [
  {
    id: 'human-jay',
    name: 'Jay',
    role: 'human',
    title: 'Principal Systems Architect',
    specialty: 'Distributed Systems & Infrastructure',
    defaultCategory: 'architecture',
    colorHex: '#2563EB',
    initials: 'JY',
  },
  {
    id: 'human-selvan',
    name: 'Selvan',
    role: 'human',
    title: 'Lead Product & Platform Director',
    specialty: 'Product Strategy & Multi-Agent Orchestration',
    defaultCategory: 'requirement',
    colorHex: '#0D9488',
    initials: 'SV',
  },
  {
    id: 'human-hari',
    name: 'Hari',
    role: 'human',
    title: 'Staff Experience Architect',
    specialty: 'Interaction Models & Spatial Workflows',
    defaultCategory: 'ux_flow',
    colorHex: '#4F46E5',
    initials: 'HR',
  },
  {
    id: 'human-harsham',
    name: 'Harsham',
    role: 'human',
    title: 'Quality & Release Lead',
    specialty: 'Verification, Security & Release Readiness',
    defaultCategory: 'qa_test',
    colorHex: '#D97706',
    initials: 'HS',
  },
  {
    id: 'agent-1-pm',
    name: 'Agent 1 - PM',
    role: 'agent',
    title: 'Autonomous Product Manager',
    specialty: 'PRD Synthesis, Scope Decomposition & Milestones',
    defaultCategory: 'requirement',
    colorHex: '#3B82F6',
    initials: 'A1',
    systemPrompt:
      'You are Agent 1 - PM (Autonomous Product Manager) collaborating on a shared engineering blackboard with humans (Jay, Selvan, Hari, Harsham) and Agents 2-6. Break down product initiatives into crisp acceptance criteria, measurable outcomes, and dependency links.',
  },
  {
    id: 'agent-2-dev',
    name: 'Agent 2 - Developer',
    role: 'agent',
    title: 'Autonomous Full-Stack Engineer',
    specialty: 'TypeScript, WebSockets, Drizzle ORM & APIs',
    defaultCategory: 'architecture',
    colorHex: '#10B981',
    initials: 'A2',
    systemPrompt:
      'You are Agent 2 - Developer (Autonomous Full-Stack Engineer) collaborating on a shared engineering blackboard with humans (Jay, Selvan, Hari, Harsham) and other agents. Produce concrete system architecture specs, database schemas, API contracts, and idempotent real-time state logic.',
  },
  {
    id: 'agent-3-ux',
    name: 'Agent 3 - UX',
    role: 'agent',
    title: 'Autonomous UX Researcher & Architect',
    specialty: 'User Journeys, Information Architecture & Ergonomics',
    defaultCategory: 'ux_flow',
    colorHex: '#8B5CF6',
    initials: 'A3',
    systemPrompt:
      'You are Agent 3 - UX (Autonomous UX Architect) collaborating on a shared engineering blackboard. Design low-friction user journeys, spatial canvas interactions, keyboard ergonomics, and clear state transitions.',
  },
  {
    id: 'agent-4-ui',
    name: 'Agent 4 - UI',
    role: 'agent',
    title: 'Autonomous Design Systems Engineer',
    specialty: 'Typography, Contrast Systems & Component Tokens',
    defaultCategory: 'ui_spec',
    colorHex: '#EC4899',
    initials: 'A4',
    systemPrompt:
      'You are Agent 4 - UI (Autonomous Design Systems Engineer) collaborating on a shared engineering blackboard. Define strict typographic scales, WCAG AA contrast tokens, tabular numerals, and Swiss grid layouts.',
  },
  {
    id: 'agent-5-devops',
    name: 'Agent 5 - DevOps',
    role: 'agent',
    title: 'Autonomous Infrastructure & SRE Agent',
    specialty: 'Cloud SQL Pooling, CI/CD & Container Resilience',
    defaultCategory: 'devops',
    colorHex: '#F59E0B',
    initials: 'A5',
    systemPrompt:
      'You are Agent 5 - DevOps (Autonomous Infrastructure & SRE Agent) collaborating on a shared engineering blackboard. Specify PostgreSQL connection pooling, WebSocket scaling, zero-downtime deployments, and observability.',
  },
  {
    id: 'agent-6-qa',
    name: 'Agent 6 - QA',
    role: 'agent',
    title: 'Autonomous Verification & QA Agent',
    specialty: 'Concurrency Testing, Edge Cases & Regression Suites',
    defaultCategory: 'qa_test',
    colorHex: '#EF4444',
    initials: 'A6',
    systemPrompt:
      'You are Agent 6 - QA (Autonomous Verification & QA Agent) collaborating on a shared engineering blackboard. Formulate rigorous test matrices, race-condition checks, WebSocket reconnection verification, and acceptance sign-offs.',
  },
];

export const HUMAN_USERS = COLLABORATORS.filter((c) => c.role === 'human');
export const AGENT_USERS = COLLABORATORS.filter((c) => c.role === 'agent');

export const CATEGORY_META: Record<
  string,
  { label: string; accent: string; border: string }
> = {
  requirement: {
    label: 'Product Requirement',
    accent: 'text-sky-400',
    border: 'border-sky-500/40',
  },
  architecture: {
    label: 'System Architecture',
    accent: 'text-emerald-400',
    border: 'border-emerald-500/40',
  },
  ux_flow: {
    label: 'UX Interaction Flow',
    accent: 'text-violet-400',
    border: 'border-violet-500/40',
  },
  ui_spec: {
    label: 'UI Design Spec',
    accent: 'text-pink-400',
    border: 'border-pink-500/40',
  },
  devops: {
    label: 'DevOps & Infra',
    accent: 'text-amber-400',
    border: 'border-amber-500/40',
  },
  qa_test: {
    label: 'QA Verification',
    accent: 'text-rose-400',
    border: 'border-rose-500/40',
  },
  decision: {
    label: 'Architecture Decision',
    accent: 'text-blue-400',
    border: 'border-blue-500/40',
  },
};
