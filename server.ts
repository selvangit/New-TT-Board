import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import * as dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { requireAuth, AuthRequest } from './src/middleware/auth.ts';
import { getOrCreateUser, updateUserPersona } from './src/db/users.ts';
import {
  getFullBlackboardState,
  upsertBoardNode,
  updateBoardNodeByKey,
  deleteBoardNodeByKey,
  createBoardMessage,
  createBoardStroke,
  clearAllBoardStrokes,
  createRepoSyncEvent,
} from './src/db/blackboard.ts';
import {
  SUPABASE_PROJECT_URL,
  SUPABASE_PROJECT_REF,
  GITHUB_SSH_URI,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_WEB_URL,
  replicateNodesToSupabase,
  pushSpecToGitHubRepo,
} from './src/lib/integrations.ts';
import { COLLABORATORS, AGENT_USERS } from './src/shared/collaborators.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

interface ConnectedClientMeta {
  clientId: string;
  personaName: string;
  email: string;
  cursorX: number;
  cursorY: number;
  updatedAt: number;
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  app.use(express.json({ limit: '2mb' }));

  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Map<WebSocket, ConnectedClientMeta>();

  function broadcastEvent(type: string, payload: unknown, excludeWs?: WebSocket) {
    const serialized = JSON.stringify({ type, payload });
    for (const [clientWs] of clients.entries()) {
      if (clientWs !== excludeWs && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(serialized);
      }
    }
  }

  function broadcastPresence() {
    const activeList = Array.from(clients.values());
    broadcastEvent('presence:update', activeList);
  }

  wss.on('connection', async (ws) => {
    const defaultMeta: ConnectedClientMeta = {
      clientId: `client-${Math.random().toString(36).slice(2, 9)}`,
      personaName: 'Selvan',
      email: '',
      cursorX: 240,
      cursorY: 180,
      updatedAt: Date.now(),
    };
    clients.set(ws, defaultMeta);

    try {
      const state = await getFullBlackboardState();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'init',
            payload: {
              ...state,
              presence: Array.from(clients.values()),
            },
          })
        );
      }
    } catch (err) {
      console.error('WebSocket initial state sync failed:', err);
    }

    broadcastPresence();

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const meta = clients.get(ws);
        if (!meta) return;

        if (msg.type === 'presence:join') {
          meta.personaName = msg.payload?.personaName || meta.personaName;
          meta.email = msg.payload?.email || meta.email;
          meta.updatedAt = Date.now();
          broadcastPresence();
        } else if (msg.type === 'cursor:moved') {
          meta.cursorX = Number(msg.payload?.x ?? meta.cursorX);
          meta.cursorY = Number(msg.payload?.y ?? meta.cursorY);
          meta.personaName = msg.payload?.personaName || meta.personaName;
          meta.updatedAt = Date.now();
          broadcastEvent(
            'cursor:moved',
            {
              clientId: meta.clientId,
              personaName: meta.personaName,
              x: meta.cursorX,
              y: meta.cursorY,
            },
            ws
          );
        } else if (msg.type === 'node:moved') {
          const { nodeKey, posX, posY } = msg.payload || {};
          if (nodeKey && typeof posX === 'number' && typeof posY === 'number') {
            broadcastEvent('node:moved', { nodeKey, posX, posY }, ws);
            await updateBoardNodeByKey(nodeKey, { posX, posY });
          }
        }
      } catch (err) {
        console.error('Error processing WebSocket message:', err);
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      broadcastPresence();
    });
  });

  // API: Sync authenticated user and load full blackboard state + integration endpoints
  app.get('/api/board', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const email = req.user!.email || 'architect@synapse.dev';
      const defaultPersona = email.toLowerCase().includes('selvan')
        ? 'Selvan'
        : email.toLowerCase().includes('jay')
        ? 'Jay'
        : email.toLowerCase().includes('hari')
        ? 'Hari'
        : 'Selvan';

      const userRecord = await getOrCreateUser(uid, email, defaultPersona);
      const boardState = await getFullBlackboardState();

      res.json({
        user: userRecord,
        integrations: {
          supabaseUrl: SUPABASE_PROJECT_URL,
          supabaseProjectRef: SUPABASE_PROJECT_REF,
          githubSshUri: GITHUB_SSH_URI,
          githubOwner: GITHUB_OWNER,
          githubRepo: GITHUB_REPO,
          githubWebUrl: GITHUB_WEB_URL,
        },
        ...boardState,
      });
    } catch (error: any) {
      console.error('Failed to load board state:', error);
      res.status(500).json({ error: error.message || 'Failed to load board state' });
    }
  });

  // API: Switch active human collaborator persona (Jay, Selvan, Hari, Harsham)
  app.post('/api/persona', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const { personaName } = req.body;
      const valid = COLLABORATORS.find((c) => c.name === personaName && c.role === 'human');
      if (!valid) {
        return res.status(400).json({ error: 'Invalid human persona selected.' });
      }
      const updated = await updateUserPersona(uid, personaName);
      res.json({ user: updated });
    } catch (error: any) {
      console.error('Failed to switch persona:', error);
      res.status(500).json({ error: error.message || 'Failed to switch persona' });
    }
  });

  // API: Create or upsert a blackboard node
  app.post('/api/nodes', requireAuth, async (req: AuthRequest, res) => {
    try {
      const {
        nodeKey,
        title,
        content,
        category,
        status,
        authorName,
        authorRole,
        assignedTo,
        posX,
        posY,
        linkedNodeKey,
        priority,
        gitBranch,
        gitFilePath,
      } = req.body;

      if (!title || !content) {
        return res.status(400).json({ error: 'Title and content are required.' });
      }

      const key = nodeKey || `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const savedNode = await upsertBoardNode({
        nodeKey: key,
        title,
        content,
        category: category || 'requirement',
        status: status || 'open',
        authorName: authorName || 'Selvan',
        authorRole: authorRole || 'human',
        assignedTo: assignedTo || 'Agent 1 - PM',
        posX: typeof posX === 'number' ? posX : 180,
        posY: typeof posY === 'number' ? posY : 180,
        linkedNodeKey: linkedNodeKey || null,
        priority: priority || 'medium',
        gitBranch: gitBranch || 'main',
        gitFilePath: gitFilePath || `specs/${key}.md`,
        supabaseSyncState: 'synced',
      });

      await replicateNodesToSupabase([savedNode]);

      broadcastEvent('node:created', savedNode);

      const logMsg = await createBoardMessage({
        senderName: authorName || 'Selvan',
        senderRole: authorRole || 'human',
        targetNodeKey: savedNode.nodeKey,
        message: `Published "${savedNode.title}" (${savedNode.gitBranch} · ${savedNode.gitFilePath}) and synced with ${SUPABASE_PROJECT_REF}.`,
        actionTaken: 'Created Node',
      });
      broadcastEvent('message:created', logMsg);

      res.json({ node: savedNode, message: logMsg });
    } catch (error: any) {
      console.error('Failed to create node:', error);
      res.status(500).json({ error: error.message || 'Failed to create node' });
    }
  });

  // API: Update an existing blackboard node
  app.patch('/api/nodes/:nodeKey', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { nodeKey } = req.params;
      const {
        title,
        content,
        category,
        status,
        assignedTo,
        posX,
        posY,
        linkedNodeKey,
        priority,
        gitBranch,
        gitFilePath,
        supabaseSyncState,
        actorName,
      } = req.body;

      const updated = await updateBoardNodeByKey(nodeKey, {
        title,
        content,
        category,
        status,
        assignedTo,
        posX,
        posY,
        linkedNodeKey,
        priority,
        gitBranch,
        gitFilePath,
        supabaseSyncState,
      });

      if (!updated) {
        return res.status(404).json({ error: 'Node not found.' });
      }

      broadcastEvent('node:updated', updated);

      if (
        actorName &&
        (title !== undefined ||
          status !== undefined ||
          content !== undefined ||
          assignedTo !== undefined ||
          gitBranch !== undefined ||
          gitFilePath !== undefined)
      ) {
        const logMsg = await createBoardMessage({
          senderName: actorName,
          senderRole: actorName.startsWith('Agent') ? 'agent' : 'human',
          targetNodeKey: updated.nodeKey,
          message: `Updated "${updated.title}" [status: ${updated.status}, branch: ${updated.gitBranch || 'main'}].`,
          actionTaken: 'Updated Spec',
        });
        broadcastEvent('message:created', logMsg);
      }

      res.json({ node: updated });
    } catch (error: any) {
      console.error('Failed to update node:', error);
      res.status(500).json({ error: error.message || 'Failed to update node' });
    }
  });

  // API: Delete a blackboard node
  app.delete('/api/nodes/:nodeKey', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { nodeKey } = req.params;
      await deleteBoardNodeByKey(nodeKey);
      broadcastEvent('node:deleted', { nodeKey });
      res.json({ deletedKey: nodeKey });
    } catch (error: any) {
      console.error('Failed to delete node:', error);
      res.status(500).json({ error: error.message || 'Failed to delete node' });
    }
  });

  // API: Post a collaboration message to the blackboard feed
  app.post('/api/messages', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { senderName, senderRole, targetNodeKey, message, actionTaken } = req.body;
      if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Message content is required.' });
      }

      const savedMsg = await createBoardMessage({
        senderName: senderName || 'Selvan',
        senderRole: senderRole || 'human',
        targetNodeKey: targetNodeKey || null,
        message: message.trim(),
        actionTaken: actionTaken || 'Commented',
      });

      broadcastEvent('message:created', savedMsg);
      res.json({ message: savedMsg });
    } catch (error: any) {
      console.error('Failed to post message:', error);
      res.status(500).json({ error: error.message || 'Failed to post message' });
    }
  });

  // API: Save a freehand vector stroke on the blackboard
  app.post('/api/strokes', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { strokeKey, authorName, color, points } = req.body;
      if (!Array.isArray(points) || points.length < 2) {
        return res.status(400).json({ error: 'Valid stroke points are required.' });
      }
      const key = strokeKey || `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const saved = await createBoardStroke({
        strokeKey: key,
        authorName: authorName || 'Selvan',
        color: color || '#3B82F6',
        pointsJson: JSON.stringify(points),
      });

      if (saved) {
        broadcastEvent('stroke:created', saved);
      }
      res.json({ stroke: saved });
    } catch (error: any) {
      console.error('Failed to save stroke:', error);
      res.status(500).json({ error: error.message || 'Failed to save stroke' });
    }
  });

  // API: Clear all freehand strokes
  app.delete('/api/strokes', requireAuth, async (_req: AuthRequest, res) => {
    try {
      await clearAllBoardStrokes();
      broadcastEvent('stroke:cleared', {});
      res.json({ cleared: true });
    } catch (error: any) {
      console.error('Failed to clear strokes:', error);
      res.status(500).json({ error: error.message || 'Failed to clear strokes' });
    }
  });

  // API: Synchronize Blackboard Tables with Supabase (https://qkolwgxedpllcazuuqiu.supabase.co)
  app.post('/api/integrations/supabase/sync', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { actorName, nodeKey } = req.body;
      const actor = actorName || 'Selvan';
      const state = await getFullBlackboardState();
      const targetNodes = nodeKey
        ? state.nodes.filter((n) => n.nodeKey === nodeKey)
        : state.nodes;

      const repResult = await replicateNodesToSupabase(targetNodes);

      const syncEvent = await createRepoSyncEvent({
        targetSystem: 'supabase',
        nodeKey: nodeKey || null,
        actorName: actor,
        branchOrTable: 'public.board_nodes, public.board_messages',
        commitOrRecordRef: `${SUPABASE_PROJECT_REF}.supabase.co (${repResult.recordCount} rows)`,
        summary: `Synchronized ${repResult.recordCount} blackboard specification nodes with ${SUPABASE_PROJECT_URL}.`,
        status: 'completed',
      });

      broadcastEvent('sync:created', syncEvent);

      const logMsg = await createBoardMessage({
        senderName: actor,
        senderRole: actor.startsWith('Agent') ? 'agent' : 'human',
        targetNodeKey: nodeKey || null,
        message: `Synchronized ${repResult.recordCount} blackboard records with Supabase endpoint ${SUPABASE_PROJECT_URL}.`,
        actionTaken: 'Supabase Sync',
      });
      broadcastEvent('message:created', logMsg);

      res.json({
        syncEvent,
        replication: repResult,
        message: logMsg,
      });
    } catch (error: any) {
      console.error('Supabase sync failed:', error);
      res.status(500).json({ error: error.message || 'Supabase synchronization failed' });
    }
  });

  // API: Push Blackboard Node Specification(s) to GitHub (git@github.com:agentflow-ai-practice/agent-platform-ai.git)
  app.post('/api/integrations/github/push', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { actorName, nodeKey, branch, filePath } = req.body;
      const actor = actorName || 'Selvan';
      const state = await getFullBlackboardState();
      const targetNode = nodeKey
        ? state.nodes.find((n) => n.nodeKey === nodeKey)
        : state.nodes[state.nodes.length - 1];

      if (!targetNode) {
        return res.status(404).json({ error: 'No blackboard node found to push to GitHub.' });
      }

      const targetBranch = branch || targetNode.gitBranch || 'main';
      const targetPath =
        filePath || targetNode.gitFilePath || `specs/${targetNode.category}/${targetNode.nodeKey}.md`;

      const ghResult = await pushSpecToGitHubRepo({
        nodeKey: targetNode.nodeKey,
        title: targetNode.title,
        content: targetNode.content,
        authorName: actor,
        assignedTo: targetNode.assignedTo,
        gitBranch: targetBranch,
        gitFilePath: targetPath,
      });

      const updatedNode = await updateBoardNodeByKey(targetNode.nodeKey, {
        gitBranch: targetBranch,
        gitFilePath: targetPath,
      });

      if (updatedNode) {
        broadcastEvent('node:updated', updatedNode);
      }

      const syncEvent = await createRepoSyncEvent({
        targetSystem: 'github',
        nodeKey: targetNode.nodeKey,
        actorName: actor,
        branchOrTable: `${targetBranch} → ${targetPath}`,
        commitOrRecordRef: ghResult.commitRef,
        summary: `Committed specification "${targetNode.title}" to ${GITHUB_SSH_URI} (${ghResult.commitRef}).`,
        status: 'completed',
      });

      broadcastEvent('sync:created', syncEvent);

      const logMsg = await createBoardMessage({
        senderName: actor,
        senderRole: actor.startsWith('Agent') ? 'agent' : 'human',
        targetNodeKey: targetNode.nodeKey,
        message: `Pushed "${targetNode.title}" to ${GITHUB_SSH_URI} on branch ${targetBranch} (${targetPath}).`,
        actionTaken: 'GitHub Push',
      });
      broadcastEvent('message:created', logMsg);

      res.json({
        syncEvent,
        node: updatedNode,
        message: logMsg,
      });
    } catch (error: any) {
      console.error('GitHub push failed:', error);
      res.status(500).json({ error: error.message || 'GitHub repository push failed' });
    }
  });

  // API: Trigger a specialist AI Agent (Agent 1 - PM through Agent 6 - QA) to collaborate on the blackboard
  app.post('/api/agents/collaborate', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { agentName, instruction, targetNodeKey, requestedBy } = req.body;
      const agentProfile = AGENT_USERS.find((a) => a.name === agentName) || AGENT_USERS[0];

      broadcastEvent('agent:status', {
        agentName: agentProfile.name,
        status: 'synthesizing',
        requestedBy: requestedBy || 'Selvan',
      });

      const currentState = await getFullBlackboardState();
      const targetNode = targetNodeKey
        ? currentState.nodes.find((n) => n.nodeKey === targetNodeKey)
        : null;

      const boardSummary = currentState.nodes
        .map(
          (n) =>
            `- [${n.nodeKey}] "${n.title}" (${n.category}, branch: ${n.gitBranch || 'main'}, file: ${n.gitFilePath || 'specs/'}, status: ${n.status}, author: ${n.authorName}, assigned: ${n.assignedTo}): ${n.content}`
        )
        .join('\n');

      const recentMessages = currentState.messages
        .slice(-8)
        .map((m) => `${m.senderName}: ${m.message}`)
        .join('\n');

      const promptText = `
Connected Infrastructure:
- Supabase Backend: ${SUPABASE_PROJECT_URL}
- GitHub Repository: ${GITHUB_SSH_URI}

Current Blackboard Nodes:
${boardSummary}

Recent Collaboration Thread:
${recentMessages}

Human Collaborator Request (from ${requestedBy || 'Selvan'}):
${instruction || `Review the current blackboard state and contribute a concrete ${agentProfile.specialty} specification node wired to ${GITHUB_SSH_URI} and ${SUPABASE_PROJECT_URL}.`}
${targetNode ? `\nSpecifically build upon or respond to Target Node [${targetNode.nodeKey}] "${targetNode.title}": ${targetNode.content}` : ''}

Produce:
1. A new or refined blackboard node with a concise technical title, structured bullet/numbered specification content (3-5 concrete lines), priority ('medium' | 'high' | 'critical'), next assignee (Jay, Selvan, Hari, Harsham, or Agent 1-6), a Git branch name (e.g. feat/agent-spec), and a repository file path in agentflow-ai-practice/agent-platform-ai.
2. A concise collaboration message to the team explaining what you synthesized and how it connects to the repository and Supabase backend.
`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: promptText,
        config: {
          systemInstruction: agentProfile.systemPrompt,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              nodeTitle: {
                type: Type.STRING,
                description: 'Concise engineering or product title for the blackboard card.',
              },
              nodeContent: {
                type: Type.STRING,
                description: 'Detailed, actionable specification content (3-5 points).',
              },
              priority: {
                type: Type.STRING,
                description: 'Priority level: medium, high, or critical.',
              },
              assignedTo: {
                type: Type.STRING,
                description: 'Next collaborator to review or execute (e.g. Jay, Selvan, Hari, Harsham, or Agent 1-6).',
              },
              gitBranch: {
                type: Type.STRING,
                description: 'Target Git branch in agentflow-ai-practice/agent-platform-ai.',
              },
              gitFilePath: {
                type: Type.STRING,
                description: 'Target repository file path in agentflow-ai-practice/agent-platform-ai.',
              },
              teamMessage: {
                type: Type.STRING,
                description: 'Direct collaboration update message posted to the team thread.',
              },
            },
            required: [
              'nodeTitle',
              'nodeContent',
              'priority',
              'assignedTo',
              'gitBranch',
              'gitFilePath',
              'teamMessage',
            ],
          },
        },
      });

      const rawText = response.text || '{}';
      const parsed = JSON.parse(rawText);

      const nodeCount = currentState.nodes.length;
      const basePosX = targetNode
        ? Math.min(1150, targetNode.posX + 380)
        : 80 + (nodeCount % 3) * 400;
      const basePosY = targetNode
        ? targetNode.posY + 40
        : 90 + Math.floor(nodeCount / 3) * 290;

      const newNodeKey = `node-${agentProfile.initials.toLowerCase()}-${Date.now().toString(36).slice(-4)}`;
      const createdNode = await upsertBoardNode({
        nodeKey: newNodeKey,
        title: parsed.nodeTitle || `${agentProfile.name} Specification`,
        content: parsed.nodeContent || 'Synthesized specification.',
        category: agentProfile.defaultCategory,
        status: 'in_progress',
        authorName: agentProfile.name,
        authorRole: 'agent',
        assignedTo: parsed.assignedTo || requestedBy || 'Selvan',
        posX: basePosX,
        posY: basePosY,
        linkedNodeKey: targetNode
          ? targetNode.nodeKey
          : currentState.nodes[currentState.nodes.length - 1]?.nodeKey || null,
        priority: ['low', 'medium', 'high', 'critical'].includes(parsed.priority)
          ? parsed.priority
          : 'high',
        gitBranch: parsed.gitBranch || `feat/${newNodeKey}`,
        gitFilePath: parsed.gitFilePath || `specs/${agentProfile.defaultCategory}/${newNodeKey}.md`,
        supabaseSyncState: 'synced',
      });

      await replicateNodesToSupabase([createdNode]);

      const ghPush = await pushSpecToGitHubRepo({
        nodeKey: createdNode.nodeKey,
        title: createdNode.title,
        content: createdNode.content,
        authorName: agentProfile.name,
        assignedTo: createdNode.assignedTo,
        gitBranch: createdNode.gitBranch || 'main',
        gitFilePath: createdNode.gitFilePath || `specs/${createdNode.nodeKey}.md`,
      });

      const syncEvent = await createRepoSyncEvent({
        targetSystem: 'github',
        nodeKey: createdNode.nodeKey,
        actorName: agentProfile.name,
        branchOrTable: `${createdNode.gitBranch} → ${createdNode.gitFilePath}`,
        commitOrRecordRef: ghPush.commitRef,
        summary: `${agentProfile.name} synced "${createdNode.title}" to ${GITHUB_SSH_URI} & ${SUPABASE_PROJECT_REF}.`,
        status: 'completed',
      });

      broadcastEvent('node:created', createdNode);
      broadcastEvent('sync:created', syncEvent);

      const createdMsg = await createBoardMessage({
        senderName: agentProfile.name,
        senderRole: 'agent',
        targetNodeKey: createdNode.nodeKey,
        message:
          parsed.teamMessage ||
          `Synthesized "${createdNode.title}" onto ${createdNode.gitBranch} (${createdNode.gitFilePath}).`,
        actionTaken: 'Synthesized & Synced',
      });

      broadcastEvent('message:created', createdMsg);
      broadcastEvent('agent:status', {
        agentName: agentProfile.name,
        status: 'idle',
      });

      res.json({
        node: createdNode,
        syncEvent,
        message: createdMsg,
      });
    } catch (error: any) {
      console.error('Agent collaboration error:', error);
      broadcastEvent('agent:status', {
        agentName: req.body?.agentName || 'Agent',
        status: 'idle',
      });
      res.status(500).json({
        error: error.message || 'Agent synthesis failed. Please try again.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Synapse Blackboard server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
