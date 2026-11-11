'use client';

import { useEffect, useRef, useState } from 'react';

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
  isHost: boolean;
}

interface Props {
  messages: ChatMessage[];
  mySocketId: string;
  onSend: (text: string) => void;
  onClose: () => void;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function ChatPanel({ messages, mySocketId, onSend, onClose }: Props) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function send() {
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput('');
    inputRef.current?.focus();
  }

  return (
    <div
      className="unino-panel phone-sheet flex flex-col shrink-0"
      style={{
        width: 300,
        height: '100%',
        background: 'var(--panel-bg)',
        borderLeft: '1px solid var(--panel-border)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 shrink-0"
        style={{ height: 48, borderBottom: '1px solid var(--divider)' }}
      >
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
            strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-indigo-400">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="text-[13px] font-semibold text-gray-200">Chat</span>
          {messages.length > 0 && (
            <span className="text-[10px] text-gray-600 font-medium">{messages.length}</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-200 hover:bg-white/5 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
            strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <span className="text-3xl opacity-30">💬</span>
            <p className="text-[11px] text-gray-600 leading-relaxed">
              No messages yet.<br />Say something!
            </p>
          </div>
        ) : (
          messages.map((msg, i) => {
            const isMe = msg.senderId === mySocketId;
            const prevMsg = messages[i - 1];
            const showMeta = !isMe && (!prevMsg || prevMsg.senderId !== msg.senderId);

            return (
              <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                {showMeta && (
                  <div className="flex items-center gap-1.5 mb-1 px-1">
                    <span className="text-[10px] font-semibold text-gray-500">{msg.senderName}</span>
                    {msg.isHost && (
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full">
                        👑 Host
                      </span>
                    )}
                  </div>
                )}
                <div
                  className={`max-w-[220px] px-3.5 py-2 text-[13px] leading-snug break-words select-text ${
                    isMe
                      ? 'bg-indigo-600 text-white rounded-2xl rounded-br-sm'
                      : 'bg-white/[0.08] text-gray-100 rounded-2xl rounded-bl-sm'
                  }`}
                >
                  {msg.text}
                </div>
                <span className="text-[9px] text-gray-700 mt-0.5 px-1">{formatTime(msg.timestamp)}</span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div
        className="shrink-0 p-3 flex items-center gap-2"
        style={{ borderTop: '1px solid var(--divider)' }}
      >
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder="Message…"
          maxLength={500}
          className="u-input flex-1 rounded-xl px-3 py-2 text-[13px] focus:outline-none transition-colors min-w-0"
        />
        <button
          onClick={send}
          disabled={!input.trim()}
          className="w-8 h-8 rounded-xl bg-indigo-600 hover:bg-indigo-500 flex items-center justify-center disabled:opacity-30 transition-colors shrink-0"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-white" style={{ transform: 'rotate(90deg)' }}>
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
