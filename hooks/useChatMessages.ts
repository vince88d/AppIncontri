
import {
  addDoc,
  collection,
  limit as firestoreLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  doc,
  Timestamp,
} from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { db } from '@/lib/firebase';
import { useAuth } from './use-auth';

type ChatMessage = {
  id: string;
  text?: string;
  senderId: string;
  createdAt?: Timestamp | Date;
  image?: string;
  imagePath?: string;
  sensitive?: boolean;
  audio?: string;
  audioDuration?: number;
  expiresAfterView?: boolean;
  expiresAt?: Timestamp | Date;
  location?: {
    lat: number;
    lng: number;
  };
};

const INITIAL_MESSAGES_LIMIT = 30;

type SendMessageOptions = {
  messageId?: string;
};

export function useChatMessages(chatId: string | null, otherId: string, otherName?: string, otherPhoto?: string) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingMessages, setPendingMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!chatId) {
      setMessagesLoading(false);
      setInitialLoadDone(true);
      return;
    }

    const q = query(
      collection(db, 'chats', chatId, 'messages'),
      orderBy('createdAt', 'desc'),
      firestoreLimit(INITIAL_MESSAGES_LIMIT)
    );

    const unsub = onSnapshot(q, (snap) => {
      const items: ChatMessage[] = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .reverse();

      setMessages(items);
      setPendingMessages((prev) =>
        prev.filter(
          (p) =>
            !items.some(
              (m) =>
                m.senderId === p.senderId &&
                ((p.text && m.text === p.text) ||
                  (p.image && m.image === p.image) ||
                  (p.audio && m.audio === p.audio) ||
                  (p.location &&
                    m.location &&
                    m.location.lat === p.location.lat &&
                    m.location.lng === p.location.lng))
            )
        )
      );

      if (!initialLoadDone) {
        setInitialLoadDone(true);
        setMessagesLoading(false);
      }
    });

    return unsub;
  }, [chatId, initialLoadDone]);

  const handleSendMessage = useCallback(async (
    messageData: Partial<ChatMessage>,
    isSecret: boolean,
    options?: SendMessageOptions
  ) => {
    if (!chatId || !user?.uid) return;

    setSending(true);
    const normalizedMessage: Partial<ChatMessage> = { ...messageData };
    const tempIdPrefix = normalizedMessage.image
      ? 'local-img'
      : normalizedMessage.audio
      ? 'local-audio'
      : normalizedMessage.location
      ? 'local-location'
      : 'local';
    const tempId = `${tempIdPrefix}-${Date.now()}`;
    const optimisticMsg: ChatMessage = {
      id: tempId,
      senderId: user.uid,
      createdAt: new Date(),
      expiresAfterView: isSecret,
      ...normalizedMessage,
    };

    setPendingMessages((prev) => [...prev, optimisticMsg]);

    try {
      let lastMessageText = '[Messaggio]';
      if (normalizedMessage.text) lastMessageText = normalizedMessage.text;
      if (normalizedMessage.image) lastMessageText = '[Foto]';
      if (normalizedMessage.audio) lastMessageText = '[Audio]';
      if (normalizedMessage.location) lastMessageText = '[Posizione]';

      await setDoc(
        doc(db, 'chats', chatId),
        {
          participants: [user.uid, otherId],
          updatedAt: serverTimestamp(),
          lastMessage: lastMessageText,
          lastSender: user.uid,
          names: {
            ...(otherName ? { [otherId]: otherName } : {}),
            ...(user.displayName ? { [user.uid]: user.displayName } : {}),
          },
          photos: {
            ...(otherPhoto ? { [otherId]: otherPhoto } : {}),
          },
        },
        { merge: true }
      );

      const messagePayload = {
        ...normalizedMessage,
        senderId: user.uid,
        createdAt: serverTimestamp(),
        expiresAfterView: isSecret,
      };

      if (options?.messageId) {
        await setDoc(
          doc(db, 'chats', chatId, 'messages', options.messageId),
          { id: options.messageId, ...messagePayload },
          { merge: true }
        );
      } else {
        await addDoc(collection(db, 'chats', chatId, 'messages'), messagePayload);
      }
      
    } catch (e) {
      Alert.alert('Errore', 'Impossibile inviare il messaggio.');
    } finally {
      setPendingMessages((prev) => prev.filter((m) => m.id !== tempId));
      setSending(false);
    }
  }, [chatId, user?.uid, otherId, otherName, otherPhoto]);

  const chatData = useMemo(() => [...messages, ...pendingMessages], [messages, pendingMessages]);

  return {
    messages: chatData,
    messagesLoading,
    initialLoadDone,
    sending,
    handleSendMessage,
  };
}
