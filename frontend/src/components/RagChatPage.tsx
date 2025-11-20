// frontend/src/components/RagChatPage.tsx

import React, {
  useEffect,
  useState,
  useRef,
  useCallback,
  FormEvent,
  KeyboardEvent,
} from 'react';
import api from '../services/api';
import './RagChatPage.css';

/* eslint-disable @typescript-eslint/no-var-requires */
const ReactMarkdown =
  (require('react-markdown') as any).default || require('react-markdown');
const remarkGfm =
  (require('remark-gfm') as any).default || require('remark-gfm');
/* eslint-enable @typescript-eslint/no-var-requires */


// ───────────────── Types ─────────────────

type ChatConversation = {
  id: number;
  team_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  archived: boolean;
};

type ChatMessage = {
  id: number;
  conversation_id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  meta?: Record<string, any> | null;
};

type ConversationWithMessages = {
  conversation: ChatConversation;
  messages: ChatMessage[];
};

type SendMessageResponse = {
  conversation: ChatConversation;
  messages: ChatMessage[];
};

// ───────────────── Helpers ─────────────────

// basic date formatting for convo list
function formatDateShort(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatTimeShort(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

// render message content with Markdown (headings, bullets, tables, code, etc.)
function renderMessageContent(content: string) {
  return (
    <div className="ragchat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node, children, ...props }: any) => (
            <h1 className="rg-md-h1" {...props}>
              {children}
            </h1>
          ),
          h2: ({ node, children, ...props }: any) => (
            <h2 className="rg-md-h2" {...props}>
              {children}
            </h2>
          ),
          h3: ({ node, children, ...props }: any) => (
            <h3 className="rg-md-h3" {...props}>
              {children}
            </h3>
          ),
          h4: ({ node, children, ...props }: any) => (
            <h4 className="rg-md-h4" {...props}>
              {children}
            </h4>
          ),
          p: ({ node, ...props }: any) => <p className="rg-md-p" {...props} />,
          ul: ({ node, ...props }: any) => <ul className="rg-md-ul" {...props} />,
          ol: ({ node, ...props }: any) => <ol className="rg-md-ol" {...props} />,
          li: ({ node, ...props }: any) => <li className="rg-md-li" {...props} />,
          strong: ({ node, ...props }: any) => (
            <strong className="rg-md-strong" {...props} />
          ),
          em: ({ node, ...props }: any) => <em className="rg-md-em" {...props} />,
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            if (inline) {
              return (
                <code className="rg-md-inline-code" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <pre className="ragchat-msg-code">
                <code
                  className={match ? `language-${match[1]}` : undefined}
                  {...props}
                >
                  {children}
                </code>
              </pre>
            );
          },
          table: ({ node, ...props }: any) => (
            <div className="rg-msg-table-wrapper">
              <table className="rg-msg-table" {...props} />
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ───────────────── Component ─────────────────

export default function RagChatPage() {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingConvos, setLoadingConvos] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const [thinkingPhase, setThinkingPhase] = useState<string | null>(null);
  const thinkingPollTimer = useRef<number | null>(null);
  const lastRunSeqRef = useRef<number | null>(null);

  const [includeArchived, setIncludeArchived] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);

  const [sidebarWidth, setSidebarWidth] = useState<number>(320);
  const resizingSidebar = useRef(false);

  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  // ───────── thinking status helpers ─────────

  const stopThinkingPoll = useCallback(() => {
    if (thinkingPollTimer.current !== null) {
      window.clearInterval(thinkingPollTimer.current);
      thinkingPollTimer.current = null;
    }
  }, []);

  const startThinkingPoll = useCallback((conversationId: number) => {
    stopThinkingPoll();
    lastRunSeqRef.current = null;

    // poll every ~5 seconds
    thinkingPollTimer.current = window.setInterval(async () => {
      try {
        const params: any = {};
        if (lastRunSeqRef.current != null) {
          params.since_seq = lastRunSeqRef.current;
        }

        const { data } = await api.get(
          `/rag-chat/conversations/${conversationId}/run_updates`,
          { params },
        );

        // data: { run_id, status, updates: [...] }
        const updates = (data && data.updates) || [];

        if (updates.length > 0) {
          // track last seq so we only get newer ones next time
          const last = updates[updates.length - 1];
          lastRunSeqRef.current = last.seq;

          // find last "status" update
          const lastStatus = [...updates]
            .reverse()
            .find((u: any) => u.kind === 'status' && u.content && u.content.text);

          if (lastStatus) {
            setThinkingPhase(lastStatus.content.text);
          }
        }

        // once run is no longer running, stop polling
        if (data && data.status && data.status !== 'running') {
          stopThinkingPoll();
        }
      } catch (err) {
        console.error('Error polling run_updates', err);
      }
    }, 5000);
  }, [stopThinkingPoll]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopThinkingPoll();
    };
  }, [stopThinkingPoll]);

  // ───────── sidebar resize handlers ─────────

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingSidebar.current) return;
      const min = 260;
      const max = 480;
      const newWidth = Math.max(min, Math.min(max, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      resizingSidebar.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleSidebarResizerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    resizingSidebar.current = true;
  };

  // ───────── fetch helpers ─────────

  const loadConversation = useCallback(async (conversationId: number) => {
    setLoadingMessages(true);
    try {
      const { data } = await api.get<ConversationWithMessages>(
        `/rag-chat/conversations/${conversationId}`,
      );
      setSelectedId(data.conversation.id);
      setMessages(data.messages);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const createNewConversation = useCallback(async () => {
    const { data } = await api.post<ChatConversation>('/rag-chat/conversations', {
      title: null,
    });
    setConversations((prev) => [data, ...prev]);
    await loadConversation(data.id);
  }, [loadConversation]);

  const fetchConversations = useCallback(async () => {
    setLoadingConvos(true);
    try {
      const { data } = await api.get<ChatConversation[]>('/rag-chat/conversations', {
        params: { include_archived: includeArchived },
      });

      setConversations(data);

      if (!data.length) {
        await createNewConversation();
        return;
      }

      // If nothing is selected or the selected convo disappeared, pick the first
      if (
        selectedId == null ||
        !data.some((c) => c.id === selectedId)
      ) {
        await loadConversation(data[0].id);
      }
    } finally {
      setLoadingConvos(false);
    }
  }, [includeArchived, createNewConversation, loadConversation, selectedId]);

  // initial load
  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // auto-scroll messages area (but NOT the whole page)
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, selectedId]);

  // ───────── actions ─────────

  const handleSelectConversation = async (id: number) => {
    if (id === selectedId) return;
    setOpenMenuId(null);
    await loadConversation(id);
  };

  const handleNewChatClick = async () => {
    setOpenMenuId(null);
    await createNewConversation();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedId) return;
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    setInput('');
    setThinkingPhase('Analyzing question…');
    startThinkingPoll(selectedId);

    const nowIso = new Date().toISOString();

    const tempUser: ChatMessage = {
      id: Date.now(),
      conversation_id: selectedId,
      role: 'user',
      content: text,
      created_at: nowIso,
      meta: { temp: true },
    };
    const tempAssistant: ChatMessage = {
      id: Date.now() + 1,
      conversation_id: selectedId,
      role: 'assistant',
      content: '',
      created_at: nowIso,
      meta: { temp: true, thinking: true },
    };

    setMessages((prev) => [...prev, tempUser, tempAssistant]);

    try {
      const { data } = await api.post<SendMessageResponse>(
        `/rag-chat/conversations/${selectedId}/messages`,
        { content: text },
      );

      setConversations((prev) => {
        const others = prev.filter((c) => c.id !== data.conversation.id);
        return [data.conversation, ...others];
      });

      setMessages((prev) => {
        const base = prev.filter((m) => !m.meta?.temp);
        return [...base, ...data.messages];
      });
    } catch (err: any) {
      setMessages((prev) => {
        const copy = [...prev];
        const idx = copy.findIndex((m) => m.meta?.thinking);
        const messageText =
          err?.response?.data?.detail ||
          err?.message ||
          'Something went wrong while talking to the assistant.';
        if (idx !== -1) {
          copy[idx] = {
            ...copy[idx],
            content: messageText,
            meta: { ...copy[idx].meta, error: true, thinking: false },
          };
        } else {
          copy.push({
            id: Date.now() + 2,
            conversation_id: selectedId,
            role: 'assistant',
            content: messageText,
            created_at: nowIso,
            meta: { error: true },
          });
        }
        return copy;
      });
    } finally {
      setSending(false);
      stopThinkingPoll();
      setThinkingPhase(null);
    }
  };

  const handleTextareaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const form = (e.currentTarget.closest('form') as HTMLFormElement) || null;
      if (form) form.requestSubmit();
    }
  };

  const handleTextareaInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  // ───────── conversation menu actions ─────────

  const handleRenameConversation = async (convo: ChatConversation) => {
    const current = (convo.title || '').trim();
    const next = window.prompt('Rename conversation', current);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === current) return;

    await api.patch<ChatConversation>(`/rag-chat/conversations/${convo.id}`, {
      title: trimmed,
    });
    setOpenMenuId(null);
    await fetchConversations();
  };

  const handleArchiveConversation = async (convo: ChatConversation) => {
    await api.patch<ChatConversation>(`/rag-chat/conversations/${convo.id}`, {
      archived: !convo.archived,
    });
    setOpenMenuId(null);

    // If we just hid the active convo, clear selection; fetch will pick a new one
    if (!includeArchived && !convo.archived && convo.id === selectedId) {
      setSelectedId(null);
      setMessages([]);
    }
    await fetchConversations();
  };

  const handleDeleteConversation = async (convo: ChatConversation) => {
    const ok = window.confirm(
      'Delete this conversation permanently? This cannot be undone.',
    );
    if (!ok) return;

    await api.delete(`/rag-chat/conversations/${convo.id}`);
    setOpenMenuId(null);

    if (convo.id === selectedId) {
      setSelectedId(null);
      setMessages([]);
    }
    await fetchConversations();
  };

  // ───────── render ─────────

  return (
    <div className="ragchat-root">
      {/* Sidebar */}
      <aside className="ragchat-sidebar" style={{ width: sidebarWidth }}>
        <div className="ragchat-sidebar-header">
          <button
            className="rg-btn rg-btn-ghost rg-btn-full"
            onClick={handleNewChatClick}
            disabled={loadingConvos}
          >
            + New chat
          </button>
        </div>

        <div className="ragchat-sidebar-section-label-row">
          <span className="ragchat-sidebar-section-label">Conversations</span>
          <label className="ragchat-archived-toggle">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            <span>Show archived</span>
          </label>
        </div>

        <div className="ragchat-sidebar-list">
          {loadingConvos && !conversations.length && (
            <div className="ragchat-sidebar-empty">Loading conversations…</div>
          )}

          {!loadingConvos && !conversations.length && (
            <div className="ragchat-sidebar-empty">
              No conversations yet.
              <br />
              Click &ldquo;New chat&rdquo; to get started.
            </div>
          )}

          {conversations.map((c) => {
            const active = c.id === selectedId;
            const label = (c.title && c.title.trim()) || 'New chat';
            return (
              <div
                key={c.id}
                className={
                  'ragchat-convo-item' +
                  (active ? ' ragchat-convo-item--active' : '')
                }
                onClick={() => handleSelectConversation(c.id)}
              >
                <div className="ragchat-convo-main">
                  <div className="ragchat-convo-title" title={label}>
                    {label}
                  </div>
                  <div className="ragchat-convo-meta">
                    <span>{formatDateShort(c.last_activity_at)}</span>
                    <span>·</span>
                    <span>{formatTimeShort(c.last_activity_at)}</span>
                    {c.archived && <span className="ragchat-convo-archived-pill">Archived</span>}
                  </div>
                </div>

                <div
                  className="ragchat-convo-menu"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="ragchat-convo-menu-button"
                    onClick={() =>
                      setOpenMenuId((id) => (id === c.id ? null : c.id))
                    }
                    aria-label="Conversation menu"
                  >
                    ⋯
                  </button>
                  {openMenuId === c.id && (
                    <div className="ragchat-convo-menu-popover">
                      <button
                        className="ragchat-convo-menu-item"
                        onClick={() => handleRenameConversation(c)}
                      >
                        Rename
                      </button>
                      <button
                        className="ragchat-convo-menu-item"
                        onClick={() => handleArchiveConversation(c)}
                      >
                        {c.archived ? 'Unarchive' : 'Archive'}
                      </button>
                      <button
                        className="ragchat-convo-menu-item ragchat-convo-menu-delete"
                        onClick={() => handleDeleteConversation(c)}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Resizer */}
      <div
        className="ragchat-sidebar-resizer"
        onMouseDown={handleSidebarResizerMouseDown}
      />

      {/* Main panel */}
      <main className="ragchat-main">
        <header className="ragchat-main-header">
          <div className="ragchat-main-model-name">RAG AI Assistant</div>
          <div className="ragchat-main-model-sub">
            Powered by your database + OpenAI
          </div>

          {thinkingPhase && (
            <div className="ragchat-thinking">
              <span className="ragchat-thinking-dot" />
              <span>{thinkingPhase}</span>
            </div>
          )}
        </header>

        {/* Messages area */}
        <div className="ragchat-messages" ref={messagesContainerRef}>
          {loadingMessages && !messages.length && (
            <div className="ragchat-empty-state">Loading conversation…</div>
          )}

          {!loadingMessages && messages.length === 0 && (
            <div className="ragchat-empty-state">
              <h1>Ready when you are.</h1>
              <p>Ask about clients, projects, mandates, subs, and more.</p>
            </div>
          )}

          {messages.map((m) => {
            const isUser = m.role === 'user';
            const meta = m.meta || {};
            const isThinking = !!meta.thinking;
            const isError = !!meta.error;

            return (
              <div
                key={m.id}
                className={
                  'ragchat-msg-row ' +
                  (isUser
                    ? 'ragchat-msg-row--user'
                    : 'ragchat-msg-row--assistant')
                }
              >
                <div className="ragchat-msg-avatar">
                  {isUser ? 'You' : 'AI'}
                </div>
                <div
                  className={
                    'ragchat-msg-bubble ' +
                    (isUser
                      ? 'ragchat-msg-bubble--user'
                      : 'ragchat-msg-bubble--assistant') +
                    (isError ? ' ragchat-msg-bubble--error' : '')
                  }
                >
                  {isThinking && !m.content && (
                    <div className="ragchat-msg-thinking">
                      {thinkingPhase && (
                        <div className="ragchat-msg-thinking-text">
                          {thinkingPhase}
                        </div>
                      )}
                      <div className="ragchat-msg-thinking-dots">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
                  )}
                  {m.content && renderMessageContent(m.content)}
                </div>
              </div>
            );
          })}
        </div>

        {/* Composer */}
        <footer className="ragchat-composer-wrapper">
          <form className="ragchat-composer" onSubmit={handleSubmit}>
            <textarea
              className="ragchat-input"
              placeholder="Ask anything"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              onInput={handleTextareaInput}
              rows={1}
            />
            <button
              type="submit"
              className="rg-btn ragchat-send-btn"
              disabled={sending || !input.trim() || !selectedId}
              title={selectedId ? 'Send message' : 'No conversation selected'}
            >
              {sending ? <span className="ragchat-send-spinner" /> : 'Send'}
            </button>
          </form>
          <div className="ragchat-composer-hint">
            Press <kbd>Enter</kbd> to send, <kbd>Shift</kbd> + <kbd>Enter</kbd> for
            a new line.
          </div>
        </footer>
      </main>
    </div>
  );
}
