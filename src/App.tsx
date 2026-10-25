import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import {
  Plus,
  Send,
  PenTool,
  MousePointer,
  Trash2,
  ArrowUpRight,
  Search,
  Sparkles,
  Check,
  X,
  LogOut,
  Play,
  Link2,
  GitBranch,
  RefreshCw,
  Copy,
} from 'lucide-react';
import { auth, googleAuthProvider } from './lib/firebase.ts';
import {
  COLLABORATORS,
  HUMAN_USERS,
  AGENT_USERS,
  CATEGORY_META,
  CollaboratorProfile,
} from './shared/collaborators.ts';

export interface BoardNode {
  id: number;
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
  width: number;
  linkedNodeKey: string | null;
  priority: string;
  gitBranch?: string | null;
  gitFilePath?: string | null;
  supabaseSyncState?: string | null;
  updatedAt?: string;
  createdAt?: string;
}

export interface BoardMessage {
  id: number;
  senderName: string;
  senderRole: string;
  targetNodeKey: string | null;
  message: string;
  actionTaken: string | null;
  createdAt?: string;
}

export interface BoardStroke {
  id: number;
  strokeKey: string;
  authorName: string;
  color: string;
  pointsJson: string;
}

export interface RepoSyncEvent {
  id: number;
  eventKey: string;
  targetSystem: 'supabase' | 'github';
  nodeKey: string | null;
  actorName: string;
  branchOrTable: string;
  commitOrRecordRef: string;
  summary: string;
  status: string;
  createdAt?: string;
}

export interface RemoteCursor {
  clientId: string;
  personaName: string;
  x: number;
  y: number;
}

type WorkspaceView = 'canvas' | 'matrix' | 'pipeline' | 'ledger';
type CanvasTool = 'select' | 'draw';

const SUPABASE_ENDPOINT = 'https://qkolwgxedpllcazuuqiu.supabase.co';
const GITHUB_SSH_REPO = 'git@github.com:agentflow-ai-practice/agent-platform-ai.git';

export default function App() {
  // Auth state (token kept strictly in memory)
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  // Active Human Persona (Jay, Selvan, Hari, Harsham)
  const [activePersona, setActivePersona] = useState<string>('Selvan');

  // Navigation & Workspace state
  const [activeView, setActiveView] = useState<WorkspaceView>('canvas');
  const [canvasTool, setCanvasTool] = useState<CanvasTool>('select');

  // Authoritative Blackboard State synced with PostgreSQL + Supabase + GitHub + WebSockets
  const [nodes, setNodes] = useState<BoardNode[]>([]);
  const [messages, setMessages] = useState<BoardMessage[]>([]);
  const [strokes, setStrokes] = useState<BoardStroke[]>([]);
  const [syncEvents, setSyncEvents] = useState<RepoSyncEvent[]>([]);
  const [boardLoading, setBoardLoading] = useState<boolean>(false);
  const [boardError, setBoardError] = useState<string | null>(null);

  // Sync action states
  const [syncingSupabase, setSyncingSupabase] = useState(false);
  const [pushingGitHub, setPushingGitHub] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Real-time multi-user presence & cursors
  const [activePresence, setActivePresence] = useState<RemoteCursor[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<Record<string, RemoteCursor>>({});
  const [activeAgentStatuses, setActiveAgentStatuses] = useState<Record<string, string>>({});

  // Selected node & modal states
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>('node-pm-102');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Create Node Form State
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState('requirement');
  const [newPriority, setNewPriority] = useState('high');
  const [newAssignedTo, setNewAssignedTo] = useState('Agent 1 - PM');
  const [newLinkedKey, setNewLinkedKey] = useState<string>('');
  const [newGitBranch, setNewGitBranch] = useState<string>('feat/blackboard-spec');
  const [newGitFilePath, setNewGitFilePath] = useState<string>('specs/architecture/new-spec.md');

  // Chat & Agent Prompt State
  const [chatInput, setChatInput] = useState('');
  const [selectedChatAgent, setSelectedChatAgent] = useState<string>('Auto-Detect');
  const [sendingChat, setSendingChat] = useState(false);

  // Matrix Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  // Pipeline Orchestration State
  const [pipelinePrompt, setPipelinePrompt] = useState(
    'Design and verify a real-time CRDT conflict resolver wired to https://qkolwgxedpllcazuuqiu.supabase.co and git@github.com:agentflow-ai-practice/agent-platform-ai.git.'
  );
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineStepIndex, setPipelineStepIndex] = useState<number>(-1);

  // Canvas Interaction Refs (prevent infinite sync loops & throttle drag)
  const wsRef = useRef<WebSocket | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const draggingNodeKeyRef = useRef<string | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastEmitTimeRef = useRef<number>(0);

  // Freehand Drawing State
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentStrokePoints, setCurrentStrokePoints] = useState<Array<{ x: number; y: number }>>([]);

  // Helper for authenticated API calls with in-memory Firebase ID token
  const authFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    let token = tokenRef.current;
    if (auth.currentUser) {
      token = await auth.currentUser.getIdToken();
      tokenRef.current = token;
    }
    if (!token) {
      throw new Error('Authentication required. Please sign in with Google.');
    }

    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    if (options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    return data;
  }, []);

  // Load initial state after sign-in
  const fetchBoardState = useCallback(async () => {
    setBoardLoading(true);
    setBoardError(null);
    try {
      const data = await authFetch('/api/board');
      if (data.user?.activePersona) {
        setActivePersona(data.user.activePersona);
      }
      if (Array.isArray(data.nodes)) {
        setNodes(data.nodes);
      }
      if (Array.isArray(data.messages)) {
        setMessages(data.messages);
      }
      if (Array.isArray(data.strokes)) {
        setStrokes(data.strokes);
      }
      if (Array.isArray(data.syncEvents)) {
        setSyncEvents(data.syncEvents);
      }
    } catch (err: any) {
      setBoardError(err.message || 'Could not load blackboard data.');
    } finally {
      setBoardLoading(false);
    }
  }, [authFetch]);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        try {
          const token = await user.getIdToken();
          tokenRef.current = token;
          await fetchBoardState();
        } catch (err: any) {
          setAuthError(err.message || 'Failed to initialize session.');
        }
      } else {
        tokenRef.current = null;
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, [fetchBoardState]);

  // Connect to Real-Time WebSocket Server with automatic reconnect
  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let isUnmounted = false;

    function connectWebSocket() {
      if (isUnmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'presence:join',
            payload: {
              personaName: activePersona,
              email: firebaseUser?.email || '',
            },
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const { type, payload } = msg;

          if (type === 'init') {
            if (Array.isArray(payload.nodes)) setNodes(payload.nodes);
            if (Array.isArray(payload.messages)) setMessages(payload.messages);
            if (Array.isArray(payload.strokes)) setStrokes(payload.strokes);
            if (Array.isArray(payload.syncEvents)) setSyncEvents(payload.syncEvents);
            if (Array.isArray(payload.presence)) setActivePresence(payload.presence);
          } else if (type === 'presence:update') {
            if (Array.isArray(payload)) {
              setActivePresence(payload);
            }
          } else if (type === 'cursor:moved') {
            if (payload?.clientId) {
              setRemoteCursors((prev) => ({
                ...prev,
                [payload.clientId]: payload,
              }));
            }
          } else if (type === 'node:created') {
            setNodes((prev) => {
              const exists = prev.some((n) => n.nodeKey === payload.nodeKey);
              if (exists) {
                return prev.map((n) => (n.nodeKey === payload.nodeKey ? payload : n));
              }
              return [...prev, payload];
            });
          } else if (type === 'node:updated') {
            setNodes((prev) =>
              prev.map((n) => {
                if (n.nodeKey !== payload.nodeKey) return n;
                if (draggingNodeKeyRef.current === payload.nodeKey) {
                  return { ...payload, posX: n.posX, posY: n.posY };
                }
                return payload;
              })
            );
          } else if (type === 'node:moved') {
            const { nodeKey, posX, posY } = payload || {};
            if (draggingNodeKeyRef.current === nodeKey) return;
            setNodes((prev) =>
              prev.map((n) => (n.nodeKey === nodeKey ? { ...n, posX, posY } : n))
            );
          } else if (type === 'node:deleted') {
            setNodes((prev) => prev.filter((n) => n.nodeKey !== payload?.nodeKey));
          } else if (type === 'message:created') {
            setMessages((prev) => {
              if (prev.some((m) => m.id === payload.id)) return prev;
              return [...prev, payload];
            });
          } else if (type === 'stroke:created') {
            setStrokes((prev) => {
              if (prev.some((s) => s.strokeKey === payload.strokeKey)) return prev;
              return [...prev, payload];
            });
          } else if (type === 'stroke:cleared') {
            setStrokes([]);
          } else if (type === 'sync:created') {
            setSyncEvents((prev) => {
              if (prev.some((e) => e.eventKey === payload.eventKey)) return prev;
              return [payload, ...prev];
            });
          } else if (type === 'agent:status') {
            const { agentName, status } = payload || {};
            if (agentName) {
              setActiveAgentStatuses((prev) => ({
                ...prev,
                [agentName]: status,
              }));
            }
          }
        } catch (err) {
          console.error('Failed to parse WebSocket event:', err);
        }
      };

      ws.onclose = () => {
        if (!isUnmounted) {
          reconnectTimer = setTimeout(connectWebSocket, 2000);
        }
      };
    }

    connectWebSocket();

    return () => {
      isUnmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [activePersona, firebaseUser?.email]);

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const token = await cred.user.getIdToken();
      tokenRef.current = token;
    } catch (err: any) {
      setAuthError(err.message || 'Sign-in cancelled or failed.');
    }
  };

  const handleSelectPersona = async (personaName: string) => {
    setActivePersona(personaName);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'presence:join',
          payload: { personaName, email: firebaseUser?.email || '' },
        })
      );
    }
    if (firebaseUser) {
      try {
        await authFetch('/api/persona', {
          method: 'POST',
          body: JSON.stringify({ personaName }),
        });
      } catch (err: any) {
        setBoardError(err.message);
      }
    }
  };

  // Trigger Supabase Replication (https://qkolwgxedpllcazuuqiu.supabase.co)
  const handleSyncToSupabase = async (targetNodeKey?: string) => {
    if (syncingSupabase) return;
    setSyncingSupabase(true);
    setBoardError(null);
    try {
      const res = await authFetch('/api/integrations/supabase/sync', {
        method: 'POST',
        body: JSON.stringify({
          actorName: activePersona,
          nodeKey: targetNodeKey || null,
        }),
      });
      if (res.syncEvent) {
        setSyncEvents((prev) =>
          prev.some((e) => e.eventKey === res.syncEvent.eventKey)
            ? prev
            : [res.syncEvent, ...prev]
        );
      }
    } catch (err: any) {
      setBoardError(err.message);
    } finally {
      setSyncingSupabase(false);
    }
  };

  // Trigger GitHub Spec Push (git@github.com:agentflow-ai-practice/agent-platform-ai.git)
  const handlePushToGitHub = async (node?: BoardNode | null) => {
    const target = node || selectedNode;
    if (!target || pushingGitHub) return;
    setPushingGitHub(true);
    setBoardError(null);
    try {
      const res = await authFetch('/api/integrations/github/push', {
        method: 'POST',
        body: JSON.stringify({
          actorName: activePersona,
          nodeKey: target.nodeKey,
          branch: target.gitBranch || 'main',
          filePath: target.gitFilePath || `specs/${target.nodeKey}.md`,
        }),
      });
      if (res.syncEvent) {
        setSyncEvents((prev) =>
          prev.some((e) => e.eventKey === res.syncEvent.eventKey)
            ? prev
            : [res.syncEvent, ...prev]
        );
      }
    } catch (err: any) {
      setBoardError(err.message);
    } finally {
      setPushingGitHub(false);
    }
  };

  const handleCopyText = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  // Create a new blackboard node
  const handleCreateNode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;

    try {
      const offsetIdx = nodes.length;
      const posX = 100 + (offsetIdx % 3) * 380;
      const posY = 100 + Math.floor(offsetIdx / 3) * 280;

      const res = await authFetch('/api/nodes', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle.trim(),
          content: newContent.trim(),
          category: newCategory,
          status: 'open',
          authorName: activePersona,
          authorRole: 'human',
          assignedTo: newAssignedTo,
          posX,
          posY,
          linkedNodeKey: newLinkedKey || null,
          priority: newPriority,
          gitBranch: newGitBranch.trim() || 'main',
          gitFilePath: newGitFilePath.trim() || 'specs/architecture/spec.md',
        }),
      });

      if (res.node) {
        setNodes((prev) =>
          prev.some((n) => n.nodeKey === res.node.nodeKey) ? prev : [...prev, res.node]
        );
        setSelectedNodeKey(res.node.nodeKey);
      }
      setNewTitle('');
      setNewContent('');
      setShowCreateModal(false);
    } catch (err: any) {
      setBoardError(err.message);
    }
  };

  // Update node properties
  const handleUpdateNode = async (nodeKey: string, patch: Partial<BoardNode>) => {
    setNodes((prev) =>
      prev.map((n) => (n.nodeKey === nodeKey ? { ...n, ...patch } : n))
    );
    try {
      await authFetch(`/api/nodes/${nodeKey}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...patch,
          actorName: activePersona,
        }),
      });
    } catch (err: any) {
      setBoardError(err.message);
      fetchBoardState();
    }
  };

  // Delete a node
  const handleDeleteNode = async (nodeKey: string) => {
    setNodes((prev) => prev.filter((n) => n.nodeKey !== nodeKey));
    if (selectedNodeKey === nodeKey) {
      setSelectedNodeKey(null);
    }
    try {
      await authFetch(`/api/nodes/${nodeKey}`, {
        method: 'DELETE',
      });
    } catch (err: any) {
      setBoardError(err.message);
      fetchBoardState();
    }
  };

  // Summon a specific AI Agent (Agent 1 - PM .. Agent 6 - QA)
  const handleInvokeAgent = async (
    agentName: string,
    customInstruction?: string,
    targetKey?: string | null
  ) => {
    if (!firebaseUser) {
      setBoardError('Please sign in with Google to dispatch autonomous agents.');
      return;
    }
    setActiveAgentStatuses((prev) => ({ ...prev, [agentName]: 'synthesizing' }));
    try {
      const res = await authFetch('/api/agents/collaborate', {
        method: 'POST',
        body: JSON.stringify({
          agentName,
          instruction:
            customInstruction ||
            `Collaborate with ${activePersona} on the blackboard and synthesize the next ${agentName} deliverable wired to ${GITHUB_SSH_REPO} and ${SUPABASE_ENDPOINT}.`,
          targetNodeKey: targetKey ?? selectedNodeKey,
          requestedBy: activePersona,
        }),
      });
      if (res.node) {
        setSelectedNodeKey(res.node.nodeKey);
      }
    } catch (err: any) {
      setBoardError(err.message);
    } finally {
      setActiveAgentStatuses((prev) => ({ ...prev, [agentName]: 'idle' }));
    }
  };

  // Run sequential Multi-Agent Sprint Relay across Agents 1 -> 3 -> 4 -> 2 -> 5 -> 6
  const handleRunAgentPipeline = async () => {
    if (!firebaseUser || pipelineRunning) return;
    setPipelineRunning(true);
    setBoardError(null);

    const sequence = [
      'Agent 1 - PM',
      'Agent 3 - UX',
      'Agent 4 - UI',
      'Agent 2 - Developer',
      'Agent 5 - DevOps',
      'Agent 6 - QA',
    ];

    let lastKey = selectedNodeKey;
    try {
      for (let i = 0; i < sequence.length; i++) {
        const agentName = sequence[i];
        setPipelineStepIndex(i);
        setActiveAgentStatuses((prev) => ({ ...prev, [agentName]: 'synthesizing' }));

        const res = await authFetch('/api/agents/collaborate', {
          method: 'POST',
          body: JSON.stringify({
            agentName,
            instruction: `Sprint Initiative from ${activePersona}: "${pipelinePrompt}". Build directly upon the previous stage node and sync to ${GITHUB_SSH_REPO} and ${SUPABASE_ENDPOINT}.`,
            targetNodeKey: lastKey,
            requestedBy: activePersona,
          }),
        });

        if (res.node?.nodeKey) {
          lastKey = res.node.nodeKey;
          setSelectedNodeKey(res.node.nodeKey);
        }
        setActiveAgentStatuses((prev) => ({ ...prev, [agentName]: 'idle' }));
      }
    } catch (err: any) {
      setBoardError(err.message);
    } finally {
      setPipelineRunning(false);
      setPipelineStepIndex(-1);
    }
  };

  // Send message in the collaboration thread
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || sendingChat) return;

    const text = chatInput.trim();
    setChatInput('');
    setSendingChat(true);

    try {
      await authFetch('/api/messages', {
        method: 'POST',
        body: JSON.stringify({
          senderName: activePersona,
          senderRole: 'human',
          targetNodeKey: selectedNodeKey,
          message: text,
          actionTaken: 'Commented',
        }),
      });

      let targetAgent: CollaboratorProfile | undefined;
      if (selectedChatAgent !== 'Auto-Detect') {
        targetAgent = AGENT_USERS.find((a) => a.name === selectedChatAgent);
      } else {
        targetAgent = AGENT_USERS.find(
          (a) =>
            text.toLowerCase().includes(a.name.toLowerCase()) ||
            text.toLowerCase().includes(a.initials.toLowerCase()) ||
            (a.name.includes('PM') && text.toLowerCase().includes('@pm')) ||
            (a.name.includes('Developer') && text.toLowerCase().includes('@dev')) ||
            (a.name.includes('UX') && text.toLowerCase().includes('@ux')) ||
            (a.name.includes('UI') && text.toLowerCase().includes('@ui')) ||
            (a.name.includes('DevOps') && text.toLowerCase().includes('@devops')) ||
            (a.name.includes('QA') && text.toLowerCase().includes('@qa'))
        );
      }

      if (targetAgent) {
        await handleInvokeAgent(targetAgent.name, text, selectedNodeKey);
      }
    } catch (err: any) {
      setBoardError(err.message);
    } finally {
      setSendingChat(false);
    }
  };

  // Spatial Blackboard Pointer Handlers
  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canvasContainerRef.current) return;
    const rect = canvasContainerRef.current.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left + canvasContainerRef.current.scrollLeft);
    const y = Math.round(e.clientY - rect.top + canvasContainerRef.current.scrollTop);

    const now = Date.now();
    if (now - lastEmitTimeRef.current > 60 && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'cursor:moved',
          payload: { personaName: activePersona, x, y },
        })
      );
    }

    if (draggingNodeKeyRef.current) {
      const nodeKey = draggingNodeKeyRef.current;
      const nextX = Math.max(16, x - dragOffsetRef.current.x);
      const nextY = Math.max(16, y - dragOffsetRef.current.y);

      setNodes((prev) =>
        prev.map((n) => (n.nodeKey === nodeKey ? { ...n, posX: nextX, posY: nextY } : n))
      );

      if (now - lastEmitTimeRef.current > 50 && wsRef.current?.readyState === WebSocket.OPEN) {
        lastEmitTimeRef.current = now;
        wsRef.current.send(
          JSON.stringify({
            type: 'node:moved',
            payload: { nodeKey, posX: nextX, posY: nextY },
          })
        );
      }
      return;
    }

    if (isDrawing && canvasTool === 'draw') {
      setCurrentStrokePoints((prev) => [...prev, { x, y }]);
    }
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (canvasTool !== 'draw' || !canvasContainerRef.current) return;
    const rect = canvasContainerRef.current.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left + canvasContainerRef.current.scrollLeft);
    const y = Math.round(e.clientY - rect.top + canvasContainerRef.current.scrollTop);
    setIsDrawing(true);
    setCurrentStrokePoints([{ x, y }]);
  };

  const handleCanvasPointerUp = async () => {
    if (draggingNodeKeyRef.current) {
      const finishedKey = draggingNodeKeyRef.current;
      draggingNodeKeyRef.current = null;
      const movedNode = nodes.find((n) => n.nodeKey === finishedKey);
      if (movedNode && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'node:moved',
            payload: {
              nodeKey: movedNode.nodeKey,
              posX: movedNode.posX,
              posY: movedNode.posY,
            },
          })
        );
      }
    }

    if (isDrawing && canvasTool === 'draw') {
      setIsDrawing(false);
      if (currentStrokePoints.length > 1 && firebaseUser) {
        const personaMeta = COLLABORATORS.find((c) => c.name === activePersona);
        try {
          await authFetch('/api/strokes', {
            method: 'POST',
            body: JSON.stringify({
              authorName: activePersona,
              color: personaMeta?.colorHex || '#3B82F6',
              points: currentStrokePoints,
            }),
          });
        } catch (err: any) {
          setBoardError(err.message);
        }
      }
      setCurrentStrokePoints([]);
    }
  };

  const handleClearStrokes = async () => {
    setStrokes([]);
    try {
      await authFetch('/api/strokes', { method: 'DELETE' });
    } catch (err: any) {
      setBoardError(err.message);
    }
  };

  const selectedNode = useMemo(
    () => nodes.find((n) => n.nodeKey === selectedNodeKey) || null,
    [nodes, selectedNodeKey]
  );

  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      if (statusFilter !== 'all' && node.status !== statusFilter) return false;
      if (roleFilter !== 'all' && node.authorRole !== roleFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          node.title.toLowerCase().includes(q) ||
          node.content.toLowerCase().includes(q) ||
          node.authorName.toLowerCase().includes(q) ||
          node.assignedTo.toLowerCase().includes(q) ||
          node.nodeKey.toLowerCase().includes(q) ||
          (node.gitBranch || '').toLowerCase().includes(q) ||
          (node.gitFilePath || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [nodes, statusFilter, roleFilter, searchQuery]);

  // Sign-In Gate if user is not authenticated yet
  if (!authLoading && !firebaseUser) {
    return (
      <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col justify-between">
        {/* Strict 3-Zone Top Bar Contract */}
        <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-800/80 bg-[#0F172A]">
          <a
            href="#top"
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            Synapse Blackboard
          </a>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
            <a href="#roster" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Collaborator Roster
            </a>
            <a href="#integrations" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Supabase & GitHub
            </a>
            <a href="#agents" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Autonomous Agents
            </a>
            <a href="#specs" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Specification Graph
            </a>
          </nav>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={handleGoogleSignIn}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Sign In with Google
            </button>
          </div>
        </header>

        <main className="max-w-6xl mx-auto w-full px-6 py-16 grid grid-cols-1 lg:grid-cols-12 gap-12 items-stretch">
          <div className="lg:col-span-7 flex flex-col justify-center space-y-6">
            <p className="text-xs font-mono tracking-wider text-blue-400 uppercase">
              01. Multi-User & Autonomous Agent Workspace
            </p>
            <h1
              className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-white leading-[1.12]"
              style={{ textWrap: 'balance' }}
            >
              Shared spatial architecture wired to Supabase and GitHub.
            </h1>
            <p className="text-base text-slate-300 leading-relaxed max-w-2xl">
              Collaborate synchronously with human leads{' '}
              <span className="text-white font-medium">Jay, Selvan, Hari, and Harsham</span> and{' '}
              <span className="text-white font-medium">Agents 1 through 6</span> (PM, Developer, UX,
              UI, DevOps, QA). Every specification node links directly to{' '}
              <span className="font-mono text-xs text-slate-200">{GITHUB_SSH_REPO}</span> and
              replicates across <span className="font-mono text-xs text-slate-200">{SUPABASE_ENDPOINT}</span>.
            </p>

            {authError && (
              <div className="p-3.5 rounded-lg border border-rose-500/40 bg-rose-950/30 text-xs text-rose-200">
                {authError}
              </div>
            )}

            <div className="pt-2 flex flex-wrap items-center gap-4">
              <button
                onClick={handleGoogleSignIn}
                className="px-6 py-3 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Authenticate & Launch Blackboard
              </button>
              <span className="text-xs text-slate-400">
                qkolwgxedpllcazuuqiu.supabase.co · agentflow-ai-practice/agent-platform-ai
              </span>
            </div>
          </div>

          <div
            id="roster"
            className="lg:col-span-5 bg-[#0F172A] border border-slate-800 rounded-xl p-6 flex flex-col justify-between space-y-6"
          >
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                Active Workspace Roster (10 Collaborators)
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                4 Human Leads · 6 Autonomous Domain Specialists
              </p>
            </div>

            <div className="space-y-4 divide-y divide-slate-800/80">
              <div className="pt-2">
                <div className="text-xs font-medium text-slate-400 mb-2.5">
                  Human Architecture Team
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {HUMAN_USERS.map((h) => (
                    <div
                      key={h.id}
                      className="p-2.5 rounded-lg bg-[#0B0F17] border border-slate-800/90 flex items-center gap-2.5"
                    >
                      <div
                        className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-mono font-semibold text-white shrink-0"
                        style={{ backgroundColor: h.colorHex }}
                      >
                        {h.initials}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white truncate">{h.name}</div>
                        <div className="text-[11px] text-slate-400 truncate">{h.title}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-4">
                <div className="text-xs font-medium text-slate-400 mb-2.5">
                  Autonomous Specialist Agents
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {AGENT_USERS.map((ag) => (
                    <div
                      key={ag.id}
                      className="p-2.5 rounded-lg bg-[#0B0F17] border border-slate-800/90 flex items-center gap-2.5"
                    >
                      <div
                        className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-mono font-semibold text-white shrink-0"
                        style={{ backgroundColor: ag.colorHex }}
                      >
                        {ag.initials}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white truncate">{ag.name}</div>
                        <div className="text-[11px] text-slate-400 truncate">{ag.specialty}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </main>

        <footer className="px-6 py-4 border-t border-slate-800/80 text-xs text-slate-500 flex items-center justify-between">
          <span>Synapse Collaborative Blackboard Platform</span>
          <span>{SUPABASE_ENDPOINT} · {GITHUB_SSH_REPO}</span>
        </footer>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0B0F17] text-slate-100 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-slate-800 bg-[#0F172A] shrink-0">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#workspace"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('canvas');
          }}
          className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          Synapse Blackboard
        </a>

        {/* Zone 2: 4 single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <a
            href="#canvas"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('canvas');
            }}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 ${
              activeView === 'canvas' ? 'text-white underline underline-offset-8 decoration-blue-500 decoration-2' : ''
            }`}
          >
            Spatial Blackboard
          </a>
          <a
            href="#matrix"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('matrix');
            }}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 ${
              activeView === 'matrix' ? 'text-white underline underline-offset-8 decoration-blue-500 decoration-2' : ''
            }`}
          >
            Specification Matrix
          </a>
          <a
            href="#pipeline"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('pipeline');
            }}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 ${
              activeView === 'pipeline' ? 'text-white underline underline-offset-8 decoration-blue-500 decoration-2' : ''
            }`}
          >
            Agent Pipeline
          </a>
          <a
            href="#ledger"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('ledger');
            }}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 ${
              activeView === 'ledger' ? 'text-white underline underline-offset-8 decoration-blue-500 decoration-2' : ''
            }`}
          >
            Supabase & GitHub Sync
          </a>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            New Spec Node
          </button>
        </div>
      </header>

      {/* Main 3-Column Workspace Layout */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Sidebar (268px): Human Persona Switcher, Specialist Agents & Wiring Targets */}
        <aside className="w-[268px] bg-[#0F172A] border-r border-slate-800 flex flex-col justify-between shrink-0 overflow-y-auto">
          <div className="p-4 space-y-5">
            {/* Active Human Identity Selector */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-300">
                  Human Collaborators
                </span>
                <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                  4 Architects
                </span>
              </div>
              <div className="space-y-1.5">
                {HUMAN_USERS.map((human) => {
                  const isCurrent = activePersona === human.name;
                  const isOnline =
                    isCurrent ||
                    activePresence.some((p) => p.personaName === human.name);
                  return (
                    <button
                      key={human.id}
                      onClick={() => handleSelectPersona(human.name)}
                      className={`w-full px-2.5 py-2 rounded-lg text-left transition-colors flex items-center justify-between border cursor-pointer ${
                        isCurrent
                          ? 'bg-slate-800/90 border-blue-500/50 text-white'
                          : 'bg-[#0B0F17]/60 border-slate-800/80 text-slate-300 hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className="w-6 h-6 rounded flex items-center justify-center text-[11px] font-mono font-bold text-white shrink-0"
                          style={{ backgroundColor: human.colorHex }}
                        >
                          {human.initials}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate">
                            {human.name}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">
                            {human.title}
                          </div>
                        </div>
                      </div>
                      <span className="text-[11px] font-mono text-slate-400 whitespace-nowrap shrink-0 ml-2">
                        {isCurrent ? 'Active' : isOnline ? 'Synced' : 'Idle'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Specialist Autonomous Agents (Agents 1 to 6) */}
            <div className="pt-4 border-t border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-300">
                  Autonomous Agents
                </span>
                <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                  6 Specialists
                </span>
              </div>
              <div className="space-y-1.5">
                {AGENT_USERS.map((agent) => {
                  const isWorking = activeAgentStatuses[agent.name] === 'synthesizing';
                  return (
                    <div
                      key={agent.id}
                      className="p-2.5 rounded-lg bg-[#0B0F17]/80 border border-slate-800/90 hover:border-slate-700 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className="w-6 h-6 rounded flex items-center justify-center text-[11px] font-mono font-bold text-white shrink-0"
                            style={{ backgroundColor: agent.colorHex }}
                          >
                            {agent.initials}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-white truncate">
                              {agent.name}
                            </div>
                            <div className="text-[11px] text-slate-400 truncate">
                              {agent.title}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => handleInvokeAgent(agent.name)}
                          disabled={isWorking}
                          className="px-2.5 py-1 text-[11px] font-medium rounded bg-slate-800 hover:bg-blue-600 text-slate-200 hover:text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
                        >
                          {isWorking ? 'Working...' : 'Dispatch'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Wired Supabase & GitHub Endpoints Quick Panel */}
            <div className="pt-4 border-t border-slate-800 space-y-2.5">
              <div className="text-xs font-semibold text-slate-300">
                Wired Infrastructure
              </div>
              <div className="p-2.5 rounded-lg bg-[#0B0F17] border border-slate-800 space-y-1.5">
                <div className="text-[11px] font-medium text-emerald-400">
                  Supabase Endpoint
                </div>
                <div className="text-[11px] font-mono text-slate-300 truncate">
                  {SUPABASE_ENDPOINT}
                </div>
                <button
                  onClick={() => handleSyncToSupabase()}
                  disabled={syncingSupabase}
                  className="w-full mt-1 py-1 text-[11px] font-medium bg-slate-800 hover:bg-emerald-600 text-slate-200 hover:text-white rounded transition-colors cursor-pointer disabled:opacity-50"
                >
                  {syncingSupabase ? 'Syncing Tables...' : 'Sync All Nodes to Supabase'}
                </button>
              </div>

              <div className="p-2.5 rounded-lg bg-[#0B0F17] border border-slate-800 space-y-1.5">
                <div className="text-[11px] font-medium text-sky-400">
                  GitHub Repository
                </div>
                <div className="text-[11px] font-mono text-slate-300 truncate">
                  {GITHUB_SSH_REPO}
                </div>
                <button
                  onClick={() => handlePushToGitHub(selectedNode)}
                  disabled={pushingGitHub || !selectedNode}
                  className="w-full mt-1 py-1 text-[11px] font-medium bg-slate-800 hover:bg-blue-600 text-slate-200 hover:text-white rounded transition-colors cursor-pointer disabled:opacity-50"
                >
                  {pushingGitHub ? 'Pushing Spec...' : 'Push Selected Node to Git'}
                </button>
              </div>
            </div>
          </div>

          {/* Authenticated Account Footer */}
          <div className="p-4 border-t border-slate-800 bg-[#0B0F17]/50 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-200 truncate">
                Acting as {activePersona}
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                {firebaseUser?.email}
              </div>
            </div>
            <button
              onClick={() => signOut(auth)}
              title="Sign Out"
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </aside>

        {/* Center Workspace Viewport */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#0B0F17] relative">
          {/* Sub-Header Workspace Toolbar */}
          <div className="px-5 py-2.5 border-b border-slate-800 bg-[#0F172A]/60 flex flex-wrap items-center justify-between gap-4 shrink-0">
            <div className="flex items-center gap-2.5 text-xs text-slate-400 truncate">
              <span className="font-mono text-slate-300 truncate">
                qkolwgxedpllcazuuqiu.supabase.co
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-slate-300 truncate">
                agentflow-ai-practice/agent-platform-ai
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-slate-300 shrink-0">
                {nodes.length} Nodes
              </span>
            </div>

            {/* Interactive Canvas Mode Controls */}
            <div className="flex items-center gap-2 shrink-0">
              {activeView === 'canvas' && (
                <>
                  <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
                    <button
                      onClick={() => setCanvasTool('select')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                        canvasTool === 'select'
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <MousePointer className="w-3.5 h-3.5" />
                      Select & Move
                    </button>
                    <button
                      onClick={() => setCanvasTool('draw')}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                        canvasTool === 'draw'
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <PenTool className="w-3.5 h-3.5" />
                      Annotate Board
                    </button>
                  </div>
                  {strokes.length > 0 && (
                    <button
                      onClick={handleClearStrokes}
                      className="px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-900 border border-slate-800 rounded-lg hover:border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Clear Ink
                    </button>
                  )}
                </>
              )}

              <button
                onClick={() => setActiveView('pipeline')}
                className="px-3 py-1.5 text-xs font-medium text-blue-300 hover:text-white bg-blue-950/50 border border-blue-500/30 rounded-lg hover:bg-blue-900/50 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Run 6-Agent Sprint Relay
              </button>
            </div>
          </div>

          {/* Error Banner if any */}
          {boardError && (
            <div className="px-5 py-2.5 bg-rose-950/60 border-b border-rose-500/40 flex items-center justify-between text-xs text-rose-200 shrink-0">
              <span>{boardError}</span>
              <button
                onClick={() => setBoardError(null)}
                className="text-rose-300 hover:text-white font-medium ml-4 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* VIEW 1: SPATIAL BLACKBOARD CANVAS */}
          {activeView === 'canvas' && (
            <div className="flex-1 flex min-h-0 relative overflow-hidden">
              <div
                ref={canvasContainerRef}
                onPointerMove={handleCanvasPointerMove}
                onPointerDown={handleCanvasPointerDown}
                onPointerUp={handleCanvasPointerUp}
                className={`flex-1 relative overflow-auto select-none ${
                  canvasTool === 'draw' ? 'cursor-crosshair' : 'cursor-default'
                }`}
                style={{
                  backgroundImage:
                    'radial-gradient(rgba(148, 163, 184, 0.14) 1px, transparent 1px)',
                  backgroundSize: '24px 24px',
                }}
              >
                <div className="w-[1800px] h-[1200px] relative">
                  {/* SVG Layer for Node Dependency Links & Freehand Vector Strokes */}
                  <svg className="absolute inset-0 w-full h-full pointer-events-none">
                    <defs>
                      <marker
                        id="dep-arrow"
                        viewBox="0 0 10 10"
                        refX="7"
                        refY="5"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 1 L 10 5 L 0 9 z" fill="#475569" />
                      </marker>
                    </defs>

                    {nodes.map((node) => {
                      if (!node.linkedNodeKey) return null;
                      const parent = nodes.find((n) => n.nodeKey === node.linkedNodeKey);
                      if (!parent) return null;

                      const startX = parent.posX + (parent.width || 340) / 2;
                      const startY = parent.posY + 110;
                      const endX = node.posX + (node.width || 340) / 2;
                      const endY = node.posY + 20;
                      const midY = (startY + endY) / 2;

                      const d = `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
                      return (
                        <g key={`edge-${parent.nodeKey}-${node.nodeKey}`}>
                          <path
                            d={d}
                            fill="none"
                            stroke="#334155"
                            strokeWidth="2"
                            strokeDasharray="5 4"
                            markerEnd="url(#dep-arrow)"
                          />
                        </g>
                      );
                    })}

                    {strokes.map((s) => {
                      let pts: Array<{ x: number; y: number }> = [];
                      try {
                        pts = JSON.parse(s.pointsJson);
                      } catch {
                        pts = [];
                      }
                      if (pts.length < 2) return null;
                      const d = pts
                        .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
                        .join(' ');
                      return (
                        <path
                          key={s.strokeKey}
                          d={d}
                          fill="none"
                          stroke={s.color || '#3B82F6'}
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      );
                    })}

                    {currentStrokePoints.length > 1 && (
                      <path
                        d={currentStrokePoints
                          .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
                          .join(' ')}
                        fill="none"
                        stroke="#60A5FA"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}
                  </svg>

                  {/* Blackboard Spatial Cards */}
                  {nodes.map((node) => {
                    const isSelected = selectedNodeKey === node.nodeKey;
                    const catMeta =
                      CATEGORY_META[node.category] || CATEGORY_META.requirement;
                    const authorProfile = COLLABORATORS.find(
                      (c) => c.name === node.authorName
                    );

                    return (
                      <div
                        key={node.nodeKey}
                        style={{
                          transform: `translate3d(${node.posX}px, ${node.posY}px, 0)`,
                          width: `${node.width || 340}px`,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedNodeKey(node.nodeKey);
                        }}
                        className={`absolute top-0 left-0 rounded-xl bg-[#0F172A] border transition-shadow ${
                          isSelected
                            ? 'border-blue-500 shadow-lg shadow-blue-950/50 z-20'
                            : 'border-slate-800 hover:border-slate-700 z-10'
                        }`}
                      >
                        {/* Drag Handle Bar */}
                        <div
                          onPointerDown={(e) => {
                            if (canvasTool !== 'select') return;
                            e.stopPropagation();
                            setSelectedNodeKey(node.nodeKey);
                            draggingNodeKeyRef.current = node.nodeKey;
                            if (canvasContainerRef.current) {
                              const rect =
                                canvasContainerRef.current.getBoundingClientRect();
                              const pointerX =
                                e.clientX -
                                rect.left +
                                canvasContainerRef.current.scrollLeft;
                              const pointerY =
                                e.clientY -
                                rect.top +
                                canvasContainerRef.current.scrollTop;
                              dragOffsetRef.current = {
                                x: pointerX - node.posX,
                                y: pointerY - node.posY,
                              };
                            }
                          }}
                          className="px-4 pt-3 pb-2 border-b border-slate-800/80 cursor-grab active:cursor-grabbing flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 truncate">
                            <span className={`font-medium ${catMeta.accent}`}>
                              {catMeta.label}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono uppercase text-slate-400">
                              {node.priority}
                            </span>
                          </div>
                          <span className="text-[11px] font-mono text-slate-500 tabular-nums shrink-0">
                            {node.posX},{node.posY}
                          </span>
                        </div>

                        {/* Node Body */}
                        <div className="p-4 space-y-2.5">
                          <h3 className="font-display text-sm font-semibold text-white leading-snug">
                            {node.title}
                          </h3>
                          <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line line-clamp-4">
                            {node.content}
                          </p>

                          {/* Git Branch & File Path Unboxed Metadata */}
                          <div className="pt-1 flex items-center gap-1.5 text-[11px] font-mono text-slate-400 truncate">
                            <GitBranch className="w-3 h-3 text-sky-400 shrink-0" />
                            <span className="text-slate-300 truncate">
                              {node.gitBranch || 'main'}
                            </span>
                            <span aria-hidden="true">/</span>
                            <span className="truncate">
                              {node.gitFilePath || `specs/${node.nodeKey}.md`}
                            </span>
                          </div>

                          {/* Unboxed Footer Metadata */}
                          <div className="pt-2 border-t border-slate-800/70 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                            <div className="flex items-center gap-1.5 truncate">
                              <span
                                className="w-4 h-4 rounded text-[9px] font-mono font-bold text-white flex items-center justify-center shrink-0"
                                style={{
                                  backgroundColor:
                                    authorProfile?.colorHex || '#3B82F6',
                                }}
                              >
                                {authorProfile?.initials || 'SY'}
                              </span>
                              <span className="text-slate-200 font-medium truncate">
                                {node.authorName}
                              </span>
                              <span aria-hidden="true">→</span>
                              <span className="text-slate-300 truncate">
                                {node.assignedTo}
                              </span>
                            </div>

                            <span className="font-mono text-[11px] text-slate-400 shrink-0">
                              {node.status.replace('_', ' ')}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Remote Multi-User Live Cursors */}
                  {Object.values(remoteCursors).map((rc) => {
                    const prof = COLLABORATORS.find(
                      (c) => c.name === rc.personaName
                    );
                    return (
                      <div
                        key={rc.clientId}
                        style={{
                          transform: `translate3d(${rc.x}px, ${rc.y}px, 0)`,
                        }}
                        className="absolute top-0 left-0 pointer-events-none z-30 transition-transform duration-75"
                      >
                        <MousePointer
                          className="w-4 h-4"
                          style={{ color: prof?.colorHex || '#38BDF8' }}
                        />
                        <span
                          className="mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono text-white whitespace-nowrap block"
                          style={{ backgroundColor: prof?.colorHex || '#0284C7' }}
                        >
                          {rc.personaName}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Selected Node Inspector Drawer inside Canvas View */}
              {selectedNode && (
                <div className="w-[336px] bg-[#0F172A] border-l border-slate-800 p-4 overflow-y-auto shrink-0 flex flex-col justify-between space-y-5">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                      <div>
                        <span className="text-[11px] font-mono text-slate-400">
                          {selectedNode.nodeKey}
                        </span>
                        <h4 className="font-display text-sm font-semibold text-white">
                          Node Specification & Git Link
                        </h4>
                      </div>
                      <button
                        onClick={() => setSelectedNodeKey(null)}
                        className="p-1 text-slate-400 hover:text-white rounded cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        Title
                      </label>
                      <input
                        type="text"
                        value={selectedNode.title}
                        onChange={(e) =>
                          handleUpdateNode(selectedNode.nodeKey, {
                            title: e.target.value,
                          })
                        }
                        className="w-full px-3 py-1.5 text-xs bg-[#0B0F17] border border-slate-800 rounded-lg text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        Specification Details
                      </label>
                      <textarea
                        rows={4}
                        value={selectedNode.content}
                        onChange={(e) =>
                          handleUpdateNode(selectedNode.nodeKey, {
                            content: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-lg text-slate-200 leading-relaxed focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    {/* GitHub Branch & File Path Wiring */}
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">
                          Git Branch
                        </label>
                        <input
                          type="text"
                          value={selectedNode.gitBranch || 'main'}
                          onChange={(e) =>
                            handleUpdateNode(selectedNode.nodeKey, {
                              gitBranch: e.target.value,
                            })
                          }
                          className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-800 rounded-lg text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">
                          Repo File Path
                        </label>
                        <input
                          type="text"
                          value={
                            selectedNode.gitFilePath ||
                            `specs/${selectedNode.nodeKey}.md`
                          }
                          onChange={(e) =>
                            handleUpdateNode(selectedNode.nodeKey, {
                              gitFilePath: e.target.value,
                            })
                          }
                          className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-800 rounded-lg text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handlePushToGitHub(selectedNode)}
                        disabled={pushingGitHub}
                        className="px-2.5 py-1.5 text-[11px] font-medium bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/40 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {pushingGitHub ? 'Pushing...' : 'Push Spec to GitHub'}
                      </button>
                      <button
                        onClick={() => handleSyncToSupabase(selectedNode.nodeKey)}
                        disabled={syncingSupabase}
                        className="px-2.5 py-1.5 text-[11px] font-medium bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/40 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {syncingSupabase ? 'Syncing...' : 'Sync to Supabase'}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">
                          Status
                        </label>
                        <select
                          value={selectedNode.status}
                          onChange={(e) =>
                            handleUpdateNode(selectedNode.nodeKey, {
                              status: e.target.value,
                            })
                          }
                          className="w-full px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-slate-800 rounded-lg text-white"
                        >
                          <option value="open">Open</option>
                          <option value="in_progress">In Progress</option>
                          <option value="review">In Review</option>
                          <option value="resolved">Resolved</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">
                          Priority
                        </label>
                        <select
                          value={selectedNode.priority}
                          onChange={(e) =>
                            handleUpdateNode(selectedNode.nodeKey, {
                              priority: e.target.value,
                            })
                          }
                          className="w-full px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-slate-800 rounded-lg text-white"
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="critical">Critical</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        Assigned Collaborator (Human or Agent)
                      </label>
                      <select
                        value={selectedNode.assignedTo}
                        onChange={(e) =>
                          handleUpdateNode(selectedNode.nodeKey, {
                            assignedTo: e.target.value,
                          })
                        }
                        className="w-full px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-slate-800 rounded-lg text-white"
                      >
                        {COLLABORATORS.map((c) => (
                          <option key={c.id} value={c.name}>
                            {c.name} ({c.title})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        Parent Dependency Node
                      </label>
                      <select
                        value={selectedNode.linkedNodeKey || ''}
                        onChange={(e) =>
                          handleUpdateNode(selectedNode.nodeKey, {
                            linkedNodeKey: e.target.value || null,
                          })
                        }
                        className="w-full px-2.5 py-1.5 text-xs bg-[#0B0F17] border border-slate-800 rounded-lg text-white"
                      >
                        <option value="">None (Root Node)</option>
                        {nodes
                          .filter((n) => n.nodeKey !== selectedNode.nodeKey)
                          .map((n) => (
                            <option key={n.nodeKey} value={n.nodeKey}>
                              {n.title} ({n.nodeKey})
                            </option>
                          ))}
                      </select>
                    </div>

                    {/* Summon Specialist Agent on this Selected Node */}
                    <div className="pt-3 border-t border-slate-800">
                      <div className="text-xs font-semibold text-slate-200 mb-2">
                        Dispatch Specialist Agent on This Node
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {AGENT_USERS.map((ag) => {
                          const busy =
                            activeAgentStatuses[ag.name] === 'synthesizing';
                          return (
                            <button
                              key={ag.id}
                              disabled={busy}
                              onClick={() =>
                                handleInvokeAgent(
                                  ag.name,
                                  `Expand and execute the next specialist deliverable for node "${selectedNode.title}" on branch ${selectedNode.gitBranch || 'main'}.`,
                                  selectedNode.nodeKey
                                )
                              }
                              className="px-2.5 py-1.5 text-[11px] font-medium bg-[#0B0F17] hover:bg-blue-600/20 border border-slate-800 hover:border-blue-500/50 rounded-lg text-left text-slate-200 transition-colors truncate cursor-pointer disabled:opacity-50"
                            >
                              {busy ? 'Working...' : `+ ${ag.name}`}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">
                      Author: {selectedNode.authorName}
                    </span>
                    <button
                      onClick={() => handleDeleteNode(selectedNode.nodeKey)}
                      className="px-2.5 py-1.5 text-xs font-medium text-rose-400 hover:text-white hover:bg-rose-600 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete Node
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* VIEW 2: SPECIFICATION MATRIX (High-Density Data Grid) */}
          {activeView === 'matrix' && (
            <div className="flex-1 p-6 overflow-y-auto space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg font-semibold text-white">
                    Blackboard Specification Matrix
                  </h2>
                  <p className="text-xs text-slate-400">
                    Synchronized relational view of all human and autonomous agent nodes mapped to{' '}
                    <span className="font-mono text-slate-300">{GITHUB_SSH_REPO}</span>.
                  </p>
                </div>

                {/* Live Client-Side Search & Segmented Status Filter */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Filter specs, branches, owners..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 pr-3 py-1.5 text-xs bg-[#0F172A] border border-slate-800 rounded-lg text-white focus:outline-none focus:border-blue-500 w-56"
                    />
                  </div>

                  <div className="flex items-center gap-1 p-1 bg-[#0F172A] border border-slate-800 rounded-lg">
                    {(['all', 'open', 'in_progress', 'review', 'resolved'] as const).map(
                      (st) => (
                        <button
                          key={st}
                          onClick={() => setStatusFilter(st)}
                          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            statusFilter === st
                              ? 'bg-blue-600 text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {st === 'all' ? 'All Statuses' : st.replace('_', ' ')}
                        </button>
                      )
                    )}
                  </div>

                  <div className="flex items-center gap-1 p-1 bg-[#0F172A] border border-slate-800 rounded-lg">
                    {(['all', 'human', 'agent'] as const).map((rl) => (
                      <button
                        key={rl}
                        onClick={() => setRoleFilter(rl)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          roleFilter === rl
                            ? 'bg-slate-800 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {rl === 'all' ? 'All Roles' : rl === 'human' ? 'Humans (4)' : 'Agents (6)'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {boardLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4].map((skeleton) => (
                    <div
                      key={skeleton}
                      className="h-11 w-full bg-[#0F172A] border border-slate-800 rounded-lg animate-pulse"
                    />
                  ))}
                </div>
              ) : filteredNodes.length === 0 ? (
                <div className="p-12 border border-slate-800 rounded-xl bg-[#0F172A] text-center space-y-3">
                  <div className="text-sm font-semibold text-white">
                    No matching specification nodes
                  </div>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    Create a new specification node or clear your active search filters to inspect the blackboard matrix.
                  </p>
                  <button
                    onClick={() => {
                      setStatusFilter('all');
                      setRoleFilter('all');
                      setSearchQuery('');
                    }}
                    className="px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors cursor-pointer"
                  >
                    Reset Filters
                  </button>
                </div>
              ) : (
                <div className="border border-slate-800 rounded-xl overflow-hidden bg-[#0F172A]">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400 bg-[#0B0F17]/60">
                        <th className="py-2.5 px-4">Key</th>
                        <th className="py-2.5 px-4">Specification Title</th>
                        <th className="py-2.5 px-4">Git Branch & File</th>
                        <th className="py-2.5 px-4">Author</th>
                        <th className="py-2.5 px-4">Assigned To</th>
                        <th className="py-2.5 px-4">Status</th>
                        <th className="py-2.5 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 text-xs">
                      {filteredNodes.map((n) => (
                        <tr
                          key={n.nodeKey}
                          className="hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="py-2.5 px-4 font-mono text-slate-400 tabular-nums whitespace-nowrap">
                            {n.nodeKey}
                          </td>
                          <td className="py-2.5 px-4 font-medium text-white max-w-xs truncate">
                            {n.title}
                          </td>
                          <td className="py-2.5 px-4 font-mono text-[11px] text-slate-300 whitespace-nowrap">
                            {n.gitBranch || 'main'} · {n.gitFilePath || `specs/${n.nodeKey}.md`}
                          </td>
                          <td className="py-2.5 px-4 text-slate-200 whitespace-nowrap">
                            {n.authorName}
                          </td>
                          <td className="py-2.5 px-4 text-slate-300 whitespace-nowrap">
                            {n.assignedTo}
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap">
                            <select
                              value={n.status}
                              onChange={(e) =>
                                handleUpdateNode(n.nodeKey, {
                                  status: e.target.value,
                                })
                              }
                              className="bg-[#0B0F17] border border-slate-800 rounded px-2 py-1 text-xs text-slate-200"
                            >
                              <option value="open">open</option>
                              <option value="in_progress">in_progress</option>
                              <option value="review">review</option>
                              <option value="resolved">resolved</option>
                            </select>
                          </td>
                          <td className="py-2.5 px-4 text-right whitespace-nowrap space-x-3">
                            <button
                              onClick={() => handlePushToGitHub(n)}
                              className="text-sky-400 hover:text-sky-300 font-medium cursor-pointer"
                            >
                              Git Push
                            </button>
                            <button
                              onClick={() => {
                                setSelectedNodeKey(n.nodeKey);
                                setActiveView('canvas');
                              }}
                              className="text-blue-400 hover:text-blue-300 font-medium inline-flex items-center gap-1 cursor-pointer"
                            >
                              Locate
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* VIEW 3: MULTI-AGENT PIPELINE ORCHESTRATOR */}
          {activeView === 'pipeline' && (
            <div className="flex-1 p-6 overflow-y-auto space-y-6">
              <div className="max-w-4xl space-y-6">
                <div>
                  <h2 className="font-display text-lg font-semibold text-white">
                    Autonomous 6-Agent Blackboard Relay
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Dispatch a high-level engineering initiative as{' '}
                    <span className="text-white font-medium">{activePersona}</span>. Agents 1 through 6
                    will sequentially synthesize their domain deliverables, commit specs to{' '}
                    <span className="font-mono text-slate-300">{GITHUB_SSH_REPO}</span>, and replicate
                    nodes to <span className="font-mono text-slate-300">{SUPABASE_ENDPOINT}</span>.
                  </p>
                </div>

                <div className="p-5 rounded-xl bg-[#0F172A] border border-slate-800 space-y-4">
                  <label className="block text-xs font-semibold text-slate-200">
                    Sprint Initiative / Problem Statement
                  </label>
                  <textarea
                    rows={3}
                    value={pipelinePrompt}
                    onChange={(e) => setPipelinePrompt(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm bg-[#0B0F17] border border-slate-800 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    placeholder="Describe the feature or architecture problem for Agents 1-6 to solve collaboratively..."
                  />
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs text-slate-400">
                      Initiated by <strong className="text-white">{activePersona}</strong> · Target Root:{' '}
                      <span className="font-mono text-slate-300">
                        {selectedNodeKey || 'Latest Node'}
                      </span>
                    </span>
                    <button
                      onClick={handleRunAgentPipeline}
                      disabled={pipelineRunning}
                      className="px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5" />
                      {pipelineRunning
                        ? 'Executing Multi-Agent Chain...'
                        : 'Execute Full 6-Agent Chain'}
                    </button>
                  </div>
                </div>

                {/* 6-Stage Agent Chain Visual Progress */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[
                    {
                      step: '01',
                      agent: AGENT_USERS[0],
                      outcome: 'Synthesizes PRD & acceptance criteria node',
                    },
                    {
                      step: '02',
                      agent: AGENT_USERS[2],
                      outcome: 'Maps spatial interaction flow & ergonomics',
                    },
                    {
                      step: '03',
                      agent: AGENT_USERS[3],
                      outcome: 'Defines design tokens, contrast & type grid',
                    },
                    {
                      step: '04',
                      agent: AGENT_USERS[1],
                      outcome: 'Architects WebSocket events & Drizzle schema',
                    },
                    {
                      step: '05',
                      agent: AGENT_USERS[4],
                      outcome: 'Configures Supabase & Cloud SQL bridge spec',
                    },
                    {
                      step: '06',
                      agent: AGENT_USERS[5],
                      outcome: 'Generates concurrency & regression test suite',
                    },
                  ].map((item, idx) => {
                    const isCurrent = pipelineStepIndex === idx;
                    const isCompleted =
                      pipelineStepIndex > idx && pipelineRunning;
                    const isBusy =
                      activeAgentStatuses[item.agent.name] === 'synthesizing';

                    return (
                      <div
                        key={item.agent.id}
                        className={`p-4 rounded-xl border transition-colors ${
                          isCurrent || isBusy
                            ? 'bg-blue-950/20 border-blue-500'
                            : isCompleted
                            ? 'bg-emerald-950/15 border-emerald-500/40'
                            : 'bg-[#0F172A] border-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <span className="font-mono text-xs text-slate-400 tabular-nums">
                            {item.step}. Stage
                          </span>
                          <span className="text-[11px] font-mono text-slate-400">
                            {isCurrent || isBusy
                              ? 'Synthesizing...'
                              : isCompleted
                              ? 'Completed'
                              : 'Ready'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2.5 mb-2">
                          <div
                            className="w-7 h-7 rounded flex items-center justify-center text-xs font-mono font-bold text-white shrink-0"
                            style={{ backgroundColor: item.agent.colorHex }}
                          >
                            {item.agent.initials}
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-white">
                              {item.agent.name}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {item.agent.title}
                            </div>
                          </div>
                        </div>
                        <p className="text-xs text-slate-300 mt-2">
                          {item.outcome}
                        </p>
                        <button
                          onClick={() =>
                            handleInvokeAgent(item.agent.name, pipelinePrompt)
                          }
                          disabled={isBusy || pipelineRunning}
                          className="mt-3 w-full py-1.5 text-xs font-medium bg-[#0B0F17] hover:bg-slate-800 border border-slate-800 rounded-lg text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          Run Stage Individually
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* VIEW 4: SUPABASE & GITHUB WIRING & SYNC LEDGER */}
          {activeView === 'ledger' && (
            <div className="flex-1 p-6 overflow-y-auto space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg font-semibold text-white">
                    Supabase & GitHub Repository Synchronization
                  </h2>
                  <p className="text-xs text-slate-400">
                    Live bidirectional wiring between the collaborative blackboard,{' '}
                    <span className="font-mono text-slate-200">{SUPABASE_ENDPOINT}</span>, and{' '}
                    <span className="font-mono text-slate-200">{GITHUB_SSH_REPO}</span>.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleSyncToSupabase()}
                    disabled={syncingSupabase}
                    className="px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {syncingSupabase
                      ? 'Replicating to Supabase...'
                      : 'Replicate State to Supabase'}
                  </button>
                  <button
                    onClick={() => handlePushToGitHub(selectedNode)}
                    disabled={pushingGitHub || !selectedNode}
                    className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    <GitBranch className="w-3.5 h-3.5" />
                    {pushingGitHub
                      ? 'Committing to GitHub...'
                      : 'Commit Selected Spec to GitHub'}
                  </button>
                </div>
              </div>

              {/* Dual Infrastructure Cards */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="p-5 rounded-xl bg-[#0F172A] border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-emerald-400">
                      01. Supabase Real-Time & Table Bridge
                    </span>
                    <button
                      onClick={() => handleCopyText('sb', SUPABASE_ENDPOINT)}
                      className="text-xs font-mono text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      {copiedKey === 'sb' ? 'Copied' : 'Copy Endpoint'}
                    </button>
                  </div>
                  <div className="font-mono text-sm text-white break-all">
                    {SUPABASE_ENDPOINT}
                  </div>
                  <div className="text-xs text-slate-400 space-y-1">
                    <div>
                      Project Reference: <span className="font-mono text-slate-200">qkolwgxedpllcazuuqiu</span> ·
                      Synced Tables: <span className="font-mono text-slate-200">board_nodes</span>,{' '}
                      <span className="font-mono text-slate-200">board_messages</span>,{' '}
                      <span className="font-mono text-slate-200">board_strokes</span>
                    </div>
                  </div>
                </div>

                <div className="p-5 rounded-xl bg-[#0F172A] border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-sky-400">
                      02. GitHub Repository Target
                    </span>
                    <button
                      onClick={() => handleCopyText('gh', GITHUB_SSH_REPO)}
                      className="text-xs font-mono text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      {copiedKey === 'gh' ? 'Copied' : 'Copy SSH URI'}
                    </button>
                  </div>
                  <div className="font-mono text-sm text-white break-all">
                    {GITHUB_SSH_REPO}
                  </div>
                  <div className="text-xs text-slate-400">
                    Organization: <span className="font-mono text-slate-200">agentflow-ai-practice</span> ·
                    Repository: <span className="font-mono text-slate-200">agent-platform-ai</span> ·
                    Automated Agent Spec Commits Enabled
                  </div>
                </div>
              </div>

              {/* Synchronization Event Table */}
              <div className="border border-slate-800 rounded-xl overflow-hidden bg-[#0F172A]">
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                  <h3 className="font-display text-sm font-semibold text-white">
                    Synchronization & Commit Audit Ledger
                  </h3>
                  <span className="text-xs font-mono text-slate-400 tabular-nums">
                    {syncEvents.length} records
                  </span>
                </div>
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400 bg-[#0B0F17]/60">
                      <th className="py-2.5 px-4">Target System</th>
                      <th className="py-2.5 px-4">Collaborator</th>
                      <th className="py-2.5 px-4">Branch / Table</th>
                      <th className="py-2.5 px-4">Commit / Endpoint Ref</th>
                      <th className="py-2.5 px-4">Summary</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 text-xs">
                    {syncEvents.map((ev) => (
                      <tr key={ev.eventKey} className="hover:bg-slate-800/30">
                        <td className="py-2.5 px-4 font-mono uppercase text-[11px] whitespace-nowrap">
                          <span
                            className={
                              ev.targetSystem === 'supabase'
                                ? 'text-emerald-400'
                                : 'text-sky-400'
                            }
                          >
                            {ev.targetSystem}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-white font-medium whitespace-nowrap">
                          {ev.actorName}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-300 whitespace-nowrap">
                          {ev.branchOrTable}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-400 whitespace-nowrap">
                          {ev.commitOrRecordRef}
                        </td>
                        <td className="py-2.5 px-4 text-slate-300">
                          {ev.summary}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>

        {/* Right Collaboration Thread & Live Stream Sidebar (320px) */}
        <aside className="w-[320px] bg-[#0F172A] border-l border-slate-800 flex flex-col justify-between shrink-0">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="font-display text-xs font-semibold text-white">
                Blackboard Live Stream
              </h3>
              <p className="text-[11px] text-slate-400">
                Real-Time Human & Agent Thread
              </p>
            </div>
            <span className="text-[11px] font-mono text-slate-400 tabular-nums">
              {messages.length} events
            </span>
          </div>

          <div className="flex-1 p-3.5 overflow-y-auto space-y-3">
            {messages.map((msg) => {
              const prof = COLLABORATORS.find((c) => c.name === msg.senderName);
              return (
                <div
                  key={msg.id}
                  className="p-3 rounded-lg bg-[#0B0F17] border border-slate-800/90 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                    <div className="flex items-center gap-1.5 truncate">
                      <span
                        className="w-4 h-4 rounded text-[9px] font-mono font-bold text-white flex items-center justify-center shrink-0"
                        style={{ backgroundColor: prof?.colorHex || '#3B82F6' }}
                      >
                        {prof?.initials || 'SY'}
                      </span>
                      <span className="font-semibold text-white truncate">
                        {msg.senderName}
                      </span>
                    </div>
                    {msg.actionTaken && (
                      <span className="text-[10px] font-mono text-blue-400 shrink-0">
                        {msg.actionTaken}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">
                    {msg.message}
                  </p>

                  {msg.targetNodeKey && (
                    <button
                      onClick={() => {
                        setSelectedNodeKey(msg.targetNodeKey);
                        setActiveView('canvas');
                      }}
                      className="text-[11px] font-mono text-slate-400 hover:text-blue-400 flex items-center gap-1 pt-0.5 cursor-pointer"
                    >
                      <Link2 className="w-3 h-3" />
                      {msg.targetNodeKey}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Message & Agent Dispatch Composer */}
          <form
            onSubmit={handleSendMessage}
            className="p-3.5 border-t border-slate-800 bg-[#0B0F17]/60 space-y-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] text-slate-400">
                Co-Collaborate With:
              </label>
              <select
                value={selectedChatAgent}
                onChange={(e) => setSelectedChatAgent(e.target.value)}
                className="px-2 py-1 text-[11px] bg-[#0F172A] border border-slate-800 rounded text-slate-200"
              >
                <option value="Auto-Detect">Team Broadcast (@mention enabled)</option>
                {AGENT_USERS.map((ag) => (
                  <option key={ag.id} value={ag.name}>
                    + Summon {ag.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={`Post as ${activePersona} or @pm, @dev, @ux...`}
                className="flex-1 px-3 py-2 text-xs bg-[#0F172A] border border-slate-800 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={sendingChat || !chatInput.trim()}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        </aside>
      </div>

      {/* Create New Blackboard Specification Node Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#0F172A] border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-display text-base font-semibold text-white">
                  Create Blackboard Specification Node
                </h3>
                <p className="text-xs text-slate-400">
                  Authoring as {activePersona} · Wired to {GITHUB_SSH_REPO} & Supabase
                </p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 text-slate-400 hover:text-white rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateNode} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Specification Title
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g., Distributed WebSocket State Reconciliation"
                  className="w-full px-3 py-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-lg text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Technical Content & Acceptance Criteria
                </label>
                <textarea
                  rows={3}
                  required
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="Outline architectural constraints, UX requirements, or verification checks..."
                  className="w-full px-3 py-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-lg text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Git Branch (agent-platform-ai)
                  </label>
                  <input
                    type="text"
                    value={newGitBranch}
                    onChange={(e) => setNewGitBranch(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-[#0B0F17] border border-slate-800 rounded-lg text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Repository File Path
                  </label>
                  <input
                    type="text"
                    value={newGitFilePath}
                    onChange={(e) => setNewGitFilePath(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-[#0B0F17] border border-slate-800 rounded-lg text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Domain Category
                  </label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-lg text-white"
                  >
                    {Object.entries(CATEGORY_META).map(([key, meta]) => (
                      <option key={key} value={key}>
                        {meta.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Priority Level
                  </label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-lg text-white"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Assign To (Human or Agent)
                  </label>
                  <select
                    value={newAssignedTo}
                    onChange={(e) => setNewAssignedTo(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-lg text-white"
                  >
                    {COLLABORATORS.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Link to Parent Node
                  </label>
                  <select
                    value={newLinkedKey}
                    onChange={(e) => setNewLinkedKey(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[#0B0F17] border border-slate-800 rounded-lg text-white"
                  >
                    <option value="">None (Root Node)</option>
                    {nodes.map((n) => (
                      <option key={n.nodeKey} value={n.nodeKey}>
                        {n.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg flex items-center gap-1.5 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  Publish & Sync
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
