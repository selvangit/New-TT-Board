import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  activePersona: text('active_persona').notNull().default('Selvan'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const boardNodes = pgTable('board_nodes', {
  id: serial('id').primaryKey(),
  nodeKey: text('node_key').notNull().unique(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  category: text('category').notNull().default('requirement'),
  status: text('status').notNull().default('open'),
  authorName: text('author_name').notNull(),
  authorRole: text('author_role').notNull().default('human'),
  assignedTo: text('assigned_to').notNull().default('Unassigned'),
  posX: integer('pos_x').notNull().default(120),
  posY: integer('pos_y').notNull().default(120),
  width: integer('width').notNull().default(320),
  linkedNodeKey: text('linked_node_key'),
  priority: text('priority').notNull().default('medium'),
  gitBranch: text('git_branch').default('main'),
  gitFilePath: text('git_file_path'),
  supabaseSyncState: text('supabase_sync_state').default('synced'),
  updatedAt: timestamp('updated_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const boardMessages = pgTable('board_messages', {
  id: serial('id').primaryKey(),
  senderName: text('sender_name').notNull(),
  senderRole: text('sender_role').notNull().default('human'),
  targetNodeKey: text('target_node_key'),
  message: text('message').notNull(),
  actionTaken: text('action_taken'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const boardStrokes = pgTable('board_strokes', {
  id: serial('id').primaryKey(),
  strokeKey: text('stroke_key').notNull().unique(),
  authorName: text('author_name').notNull(),
  color: text('color').notNull().default('#2563EB'),
  pointsJson: text('points_json').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const repoSyncEvents = pgTable('repo_sync_events', {
  id: serial('id').primaryKey(),
  eventKey: text('event_key').notNull().unique(),
  targetSystem: text('target_system').notNull(), // 'supabase' | 'github'
  nodeKey: text('node_key'),
  actorName: text('actor_name').notNull(),
  branchOrTable: text('branch_or_table').notNull(),
  commitOrRecordRef: text('commit_or_record_ref').notNull(),
  summary: text('summary').notNull(),
  status: text('status').notNull().default('completed'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  nodes: many(boardNodes),
}));
