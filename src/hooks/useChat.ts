import { useState, useRef, useEffect, useCallback } from 'react';
import type { Message, Settings } from '../types';
import { sendChatMessageStream } from '../services/api';

const STORAGE_KEY = 'pi_web_chat_history_v1';

export function useChat(settings: Settings) {
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn('Failed to parse chat history', e);
    }
    return [];
  });

  const [isLoading, setIsLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch (e) {
      console.error('Failed to save chat history', e);
    }
  }, [messages]);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
      setMessages(prev =>
        prev.map(m =>
          m.status === 'streaming' ? { ...m, status: 'done' } : m
        )
      );
    }
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text.trim(),
        timestamp: Date.now(),
        status: 'done',
      };

      const assistantMsgId = `asst-${Date.now()}`;
      const assistantMsg: Message = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        reasoning: '',
        timestamp: Date.now(),
        status: 'streaming',
      };

      const updatedHistory = [...messages, userMsg];
      setMessages([...updatedHistory, assistantMsg]);
      setIsLoading(true);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        await sendChatMessageStream(
          updatedHistory,
          settings,
          chunk => {
            setMessages(prev =>
              prev.map(m => {
                if (m.id !== assistantMsgId) return m;

                let newReasoning = m.reasoning || '';
                let newContent = m.content || '';

                if (chunk.reasoning) {
                  newReasoning += chunk.reasoning;
                }

                // 支持兼容模型直接返回 <think> 标签的清洗
                if (chunk.content) {
                  const combined = newContent + chunk.content;
                  if (combined.includes('<think>') && !m.reasoning) {
                    const match = combined.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
                    if (match) {
                      newReasoning = match[1];
                      newContent = combined.replace(/<think>[\s\S]*?<\/think>/, '').trimStart();
                    } else {
                      newContent = combined;
                    }
                  } else {
                    newContent += chunk.content;
                  }
                }

                return {
                  ...m,
                  reasoning: newReasoning,
                  content: newContent,
                };
              })
            );
          },
          controller.signal
        );

        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId ? { ...m, status: 'done' } : m
          )
        );
      } catch (err: any) {
        if (err.name === 'AbortError') {
          // 用户手动终止
          return;
        }
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  status: 'error',
                  error: err.message || '网络连接失败，请检查 API 配置',
                }
              : m
          )
        );
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [messages, settings, isLoading]
  );

  const clearHistory = useCallback(() => {
    stopGeneration();
    setMessages([]);
  }, [stopGeneration]);

  return {
    messages,
    isLoading,
    sendMessage,
    stopGeneration,
    clearHistory,
  };
}
