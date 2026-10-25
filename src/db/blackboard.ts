import { db } from './index.ts';
import { boardNodes, boardMessages, boardStrokes, repoSyncEvents } from './schema.ts';
import { asc, desc, eq } from 'drizzle-orm';

export interface CreateNodeInput {
  nodeKey: string;
  title: string;
  content: string;
  category: string;
  status: string;
  authorName: string;
  authorRole: string;
  assignedTo: string;
  posX: number;
  posY: number;
  width?: number;
  linkedNodeKey?: string | null;
  priority: string;
  gitBranch?: string | null;
  gitFilePath?: string | null;
  supabaseSyncState?: string | null;
}

export interface UpdateNodeInput {
  title?: string;
  content?: string;
  category?: string;
  status?: string;
  assignedTo?: string;
  posX?: number;
  posY?: number;
  linkedNodeKey?: string | null;
  priority?: string;
  gitBranch?: string | null;
  gitFilePath?: string | null;
  supabaseSyncState?: string | null;
}

export async function getFullBlackboardState() {
  try {
    const [nodes, messages, strokes, syncEvents] = await Promise.all([
      db.select().from(boardNodes).orderBy(asc(boardNodes.id)),
      db.select().from(boardMessages).orderBy(desc(boardMessages.id)).limit(80),
      db.select().from(boardStrokes).orderBy(asc(boardStrokes.id)),
      db.select().from(repoSyncEvents).orderBy(desc(repoSyncEvents.id)).limit(50),
    ]);

    return {
      nodes,
      messages: messages.reverse(),
      strokes,
      syncEvents,
    };
  } catch (error) {
    console.error('Database query failed in getFullBlackboardState:', error);
    throw new Error('Failed to load blackboard state from database.', { cause: error });
  }
}

export async function upsertBoardNode(input: CreateNodeInput) {
  try {
    const result = await db
      .insert(boardNodes)
      .values({
        nodeKey: input.nodeKey,
        title: input.title,
        content: input.content,
        category: input.category,
        status: input.status,
        authorName: input.authorName,
        authorRole: input.authorRole,
        assignedTo: input.assignedTo,
        posX: Math.round(input.posX),
        posY: Math.round(input.posY),
        width: input.width ?? 340,
        linkedNodeKey: input.linkedNodeKey ?? null,
        priority: input.priority,
        gitBranch: input.gitBranch ?? 'main',
        gitFilePath: input.gitFilePath ?? `specs/${input.nodeKey}.md`,
        supabaseSyncState: input.supabaseSyncState ?? 'synced',
      })
      .onConflictDoUpdate({
        target: boardNodes.nodeKey,
        set: {
          title: input.title,
          content: input.content,
          category: input.category,
          status: input.status,
          assignedTo: input.assignedTo,
          posX: Math.round(input.posX),
          posY: Math.round(input.posY),
          linkedNodeKey: input.linkedNodeKey ?? null,
          priority: input.priority,
          gitBranch: input.gitBranch ?? 'main',
          gitFilePath: input.gitFilePath ?? `specs/${input.nodeKey}.md`,
          supabaseSyncState: input.supabaseSyncState ?? 'synced',
          updatedAt: new Date(),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed in upsertBoardNode:', error);
    throw new Error('Failed to save blackboard node.', { cause: error });
  }
}

export async function updateBoardNodeByKey(nodeKey: string, patch: UpdateNodeInput) {
  try {
    const updatePayload: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (patch.title !== undefined) updatePayload.title = patch.title;
    if (patch.content !== undefined) updatePayload.content = patch.content;
    if (patch.category !== undefined) updatePayload.category = patch.category;
    if (patch.status !== undefined) updatePayload.status = patch.status;
    if (patch.assignedTo !== undefined) updatePayload.assignedTo = patch.assignedTo;
    if (patch.posX !== undefined) updatePayload.posX = Math.round(patch.posX);
    if (patch.posY !== undefined) updatePayload.posY = Math.round(patch.posY);
    if (patch.linkedNodeKey !== undefined) updatePayload.linkedNodeKey = patch.linkedNodeKey;
    if (patch.priority !== undefined) updatePayload.priority = patch.priority;
    if (patch.gitBranch !== undefined) updatePayload.gitBranch = patch.gitBranch;
    if (patch.gitFilePath !== undefined) updatePayload.gitFilePath = patch.gitFilePath;
    if (patch.supabaseSyncState !== undefined) updatePayload.supabaseSyncState = patch.supabaseSyncState;

    const result = await db
      .update(boardNodes)
      .set(updatePayload)
      .where(eq(boardNodes.nodeKey, nodeKey))
      .returning();

    return result[0] || null;
  } catch (error) {
    console.error('Database query failed in updateBoardNodeByKey:', error);
    throw new Error('Failed to update blackboard node.', { cause: error });
  }
}

export async function deleteBoardNodeByKey(nodeKey: string) {
  try {
    await db.delete(boardNodes).where(eq(boardNodes.nodeKey, nodeKey));
    return { deletedKey: nodeKey };
  } catch (error) {
    console.error('Database query failed in deleteBoardNodeByKey:', error);
    throw new Error('Failed to delete blackboard node.', { cause: error });
  }
}

export async function createBoardMessage(input: {
  senderName: string;
  senderRole: string;
  targetNodeKey?: string | null;
  message: string;
  actionTaken?: string | null;
}) {
  try {
    const result = await db
      .insert(boardMessages)
      .values({
        senderName: input.senderName,
        senderRole: input.senderRole,
        targetNodeKey: input.targetNodeKey ?? null,
        message: input.message,
        actionTaken: input.actionTaken ?? null,
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed in createBoardMessage:', error);
    throw new Error('Failed to persist collaboration message.', { cause: error });
  }
}

export async function createBoardStroke(input: {
  strokeKey: string;
  authorName: string;
  color: string;
  pointsJson: string;
}) {
  try {
    const result = await db
      .insert(boardStrokes)
      .values({
        strokeKey: input.strokeKey,
        authorName: input.authorName,
        color: input.color,
        pointsJson: input.pointsJson,
      })
      .onConflictDoNothing()
      .returning();

    return result[0] || null;
  } catch (error) {
    console.error('Database query failed in createBoardStroke:', error);
    throw new Error('Failed to save canvas annotation stroke.', { cause: error });
  }
}

export async function clearAllBoardStrokes() {
  try {
    await db.delete(boardStrokes);
    return { cleared: true };
  } catch (error) {
    console.error('Database query failed in clearAllBoardStrokes:', error);
    throw new Error('Failed to clear canvas annotations.', { cause: error });
  }
}

export async function createRepoSyncEvent(input: {
  eventKey?: string;
  targetSystem: 'supabase' | 'github';
  nodeKey?: string | null;
  actorName: string;
  branchOrTable: string;
  commitOrRecordRef: string;
  summary: string;
  status?: string;
}) {
  try {
    const key =
      input.eventKey ||
      `sync-${input.targetSystem.slice(0, 2)}-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
    const result = await db
      .insert(repoSyncEvents)
      .values({
        eventKey: key,
        targetSystem: input.targetSystem,
        nodeKey: input.nodeKey ?? null,
        actorName: input.actorName,
        branchOrTable: input.branchOrTable,
        commitOrRecordRef: input.commitOrRecordRef,
        summary: input.summary,
        status: input.status ?? 'completed',
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed in createRepoSyncEvent:', error);
    throw new Error('Failed to record synchronization event.', { cause: error });
  }
}
