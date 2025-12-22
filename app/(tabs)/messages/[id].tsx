import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  arrayUnion,
  arrayRemove,
  limit as firestoreLimit,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Switch,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { useAuth } from '@/hooks/use-auth';
import { useChatMessages } from '@/hooks/useChatMessages';
import { db } from '@/lib/firebase';

import { ChatMessageItem } from '@/components/messages/ChatMessageItem';
import { ParticleEffect } from '@/components/messages/ParticleEffect';

type ChatMessage = {
  id: string;
  text?: string;
  senderId: string;
  createdAt?: Timestamp | Date;
  image?: string;
  imagePath?: string;
  moderationStatus?: 'pending' | 'ok' | 'flagged';
  contentWarning?: 'nudity' | null;
  audio?: string;
  audioDuration?: number;
  expiresAfterView?: boolean;
  expiresAt?: Timestamp | Date;
  location?: {
    lat: number;
    lng: number;
  };
};

type TranslationEntry = {
  text: string | null;
  target: string;
};

const FALLBACK_PHOTO = 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80';
const SECRET_EXPIRY_MS = 10_000;
const INITIAL_MESSAGES_LIMIT = 30;
const TRANSLATION_LANG_OPTIONS = ['en', 'es', 'fr', 'de', 'it'];
const DEFAULT_INCOMING_TRANSLATION_LANG = 'it';

export default function ChatScreen() {
  const { id: otherId, name: initialName, photo: initialPhoto, chatId: chatIdParam } =
    useLocalSearchParams<{ id: string; name?: string; photo?: string; chatId?: string }>();
  const { user } = useAuth();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];

  const chatId = useMemo(() => {
    if (chatIdParam) return String(chatIdParam);
    if (!user?.uid || !otherId) return null;
    return [user.uid, otherId].sort().join('_');
  }, [user?.uid, otherId, chatIdParam]);

  // Stati base
  const [otherName, setOtherName] = useState<string>(initialName ?? '');
  const [otherPhoto, setOtherPhoto] = useState<string | undefined>(initialPhoto ?? FALLBACK_PHOTO);
  
  const {
    messages: chatData,
    messagesLoading,
    initialLoadDone,
    sending,
    handleSendMessage,
  } = useChatMessages(chatId, otherId, otherName, otherPhoto);
  
  const [input, setInput] = useState('');
  const [actionsOpen, setActionsOpen] = useState(false);
  const [secretMode, setSecretMode] = useState(false);
  const [translateAllEnabled, setTranslateAllEnabled] = useState(false);
  const [translatingAll, setTranslatingAll] = useState(false);
  const [outgoingTargetLang, setOutgoingTargetLang] = useState<string>('en');
  const [incomingTargetLang, setIncomingTargetLang] = useState<string>(
    DEFAULT_INCOMING_TRANSLATION_LANG
  );
  const [translationSettingsVisible, setTranslationSettingsVisible] = useState(false);
  const [translations, setTranslations] = useState<Record<string, TranslationEntry | undefined>>(
    {}
  );
  const [translatingMap, setTranslatingMap] = useState<Record<string, boolean>>({});
  const [fadingMap, setFadingMap] = useState<Record<string, boolean>>({});
  const [showParticles, setShowParticles] = useState<Record<string, boolean>>({});
  const [blockingUser, setBlockingUser] = useState(false);
  const [deletingChat, setDeletingChat] = useState(false);

  const [sendingImage, setSendingImage] = useState(false);
  const [sendingLocation, setSendingLocation] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [imageTimed, setImageTimed] = useState(false);
  const [viewImage, setViewImage] = useState<string | null>(null);
  const [viewImageVisible, setViewImageVisible] = useState(false);
  const [viewImageTimed, setViewImageTimed] = useState(false);
  const [viewImageCountdown, setViewImageCountdown] = useState<number | null>(null);
  const [viewImageExpiry, setViewImageExpiry] = useState<number | null>(null);
  const [revealedWarnings, setRevealedWarnings] = useState<Record<string, boolean>>({});

  const {
    isRecording,
    recordingPaused,
    recordingDuration,
    sendingAudio,
    handleRecordAudio,
    pauseRecording,
    resumeRecording,
    cancelRecording,
  } = useAudioRecorder(chatId, otherId, secretMode, handleSendMessage);

  const { playingId, playbackStatus, handlePlayAudio, soundRef } = useAudioPlayer();
  
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [chatMeta, setChatMeta] = useState<any | null>(null);
  const readInFlightRef = useRef(false);
  const lastMarkedRef = useRef(0);
  const expiryStartedRef = useRef<Set<string>>(new Set());
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const fadeTimeoutsRef = useRef<Record<string, NodeJS.Timeout>>({});
  const fadeValuesRef = useRef<Record<string, Animated.Value>>({});
  const scaleValuesRef = useRef<Record<string, Animated.Value>>({});

  const formatTime = useCallback((timestamp: any) => {
    if (!timestamp) return '';
    const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Ora';
    if (diffMins < 60) return `${diffMins}m`;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, []);
  
  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
    };
  }, [soundRef]);
  
  const scrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToEnd({ animated: true });
  }, []);
  
  const scheduleScroll = useCallback((delay = 80) => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = setTimeout(scrollToBottom, delay);
  }, [scrollToBottom]);

  const ensureFadeValue = useCallback((id: string) => {
    if (!fadeValuesRef.current[id]) {
      fadeValuesRef.current[id] = new Animated.Value(1);
    }
    return fadeValuesRef.current[id];
  }, []);

  const ensureScaleValue = useCallback((id: string) => {
    if (!scaleValuesRef.current[id]) {
      scaleValuesRef.current[id] = new Animated.Value(1);
    }
    return scaleValuesRef.current[id];
  }, []);

  const startFade = useCallback((id: string) => {
    const fadeAnim = ensureFadeValue(id);
    const scaleAnim = ensureScaleValue(id);
    
    // Imposta valori iniziali
    fadeAnim.setValue(1);
    scaleAnim.setValue(1);
    
    // Attiva le particelle
    setShowParticles(prev => ({ ...prev, [id]: true }));
    
    // Animazione parallela per l'effetto sgretolamento
    Animated.parallel([
      // Dissolvenza
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 1000,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
      // Riduzione scala
      Animated.timing(scaleAnim, {
        toValue: 0.7,
        duration: 1000,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Dopo l'animazione, nascondi le particelle
      setShowParticles(prev => ({ ...prev, [id]: false }));
      setFadingMap(prev => ({ ...prev, [id]: false }));
    });
    
    // Segna come in dissolvenza
    setFadingMap(prev => ({ ...prev, [id]: true }));
  }, [ensureFadeValue, ensureScaleValue]);

  useEffect(() => {
    return () => {
      Object.values(fadeTimeoutsRef.current).forEach((t) => clearTimeout(t));
      Object.values(fadeValuesRef.current).forEach((anim) => anim.stopAnimation?.());
      Object.values(scaleValuesRef.current).forEach((anim) => anim.stopAnimation?.());
    };
  }, []);

  // Carica profilo utente in background
  useEffect(() => {
    let active = true;
    
    if (initialName && initialPhoto) {
      return;
    }
    
    (async () => {
      if (!otherId) return;
      try {
        const snap = await getDoc(doc(db, 'profiles', otherId));
        if (!active) return;
        if (snap.exists()) {
          const data = snap.data() as any;
          setOtherName((prev) => prev || (data.name ?? 'Utente'));
          setOtherPhoto((prev) => prev || (data.photo ?? data.photos?.[0] ?? FALLBACK_PHOTO));
        }
      } catch (e) {
        // Silently fail
      }
    })();
    return () => {
      active = false;
    };
  }, [otherId, initialName, initialPhoto]);

  const isBlocked = useMemo(() => {
    if (!user?.uid) return false;
    return !!chatMeta?.blockedBy?.[user.uid];
  }, [chatMeta?.blockedBy, user?.uid]);

  const chatBlocked = useMemo(() => {
    const blockedBy = chatMeta?.blockedBy;
    if (!blockedBy) return false;
    return Object.keys(blockedBy).length > 0;
  }, [chatMeta?.blockedBy]);
  const chatDismissedRef = useRef(false);

  useEffect(() => {
    if (chatBlocked && !chatDismissedRef.current) {
      chatDismissedRef.current = true;
      Alert.alert('Chat bloccata', 'Questa chat non è più disponibile.');
      router.back();
    }
  }, [chatBlocked]);

  useEffect(() => {
    if (initialLoadDone) {
        scheduleScroll(50);
    }
  }, [chatData.length, initialLoadDone, scheduleScroll]);

  // Carica metadata chat in background
  useEffect(() => {
    if (!chatId) return;
    const unsub = onSnapshot(doc(db, 'chats', chatId), (snap) => {
      setChatMeta(snap.exists() ? (snap.data() as any) : null);
    });
    return unsub;
  }, [chatId]);

  const markChatReadIfNeeded = useCallback(() => {
    if (!chatId || !user?.uid || !initialLoadDone) return;
    const lastMessage = [...chatData].reverse().find((m) => m.senderId);
    if (!lastMessage || lastMessage.senderId === user.uid) return;
    const lastTime =
      lastMessage.createdAt instanceof Date
        ? lastMessage.createdAt.getTime()
        : lastMessage.createdAt?.toDate
        ? lastMessage.createdAt.toDate().getTime()
        : 0;
    if (!lastTime) return;
    const lastRead =
      chatMeta?.readBy?.[user.uid]?.toDate?.() ? chatMeta.readBy[user.uid].toDate().getTime() : 0;
    if (lastRead >= lastTime || lastMarkedRef.current >= lastTime || readInFlightRef.current) return;
    readInFlightRef.current = true;
    setDoc(
      doc(db, 'chats', chatId),
      { readBy: { [user.uid]: serverTimestamp() } },
      { merge: true }
    ).finally(() => {
      readInFlightRef.current = false;
      lastMarkedRef.current = lastTime;
    });
  }, [chatId, user?.uid, chatData, chatMeta, initialLoadDone]);

  const cycleLang = useCallback((current: string) => {
    const idx = TRANSLATION_LANG_OPTIONS.indexOf(current);
    return TRANSLATION_LANG_OPTIONS[(idx + 1) % TRANSLATION_LANG_OPTIONS.length];
  }, []);

  const getTargetLangForMessage = useCallback(
    (message: ChatMessage) =>
      message.senderId === user?.uid ? outgoingTargetLang : incomingTargetLang,
    [outgoingTargetLang, incomingTargetLang, user?.uid]
  );

  const translateText = useCallback(
    async (message: ChatMessage) => {
      if (!message.text || !message.id) return;
      if (translatingMap[message.id]) return;
      const targetLang = getTargetLangForMessage(message);
      setTranslatingMap((prev) => ({ ...prev, [message.id]: true }));
      try {
        const res = await fetch(
          `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(
            message.text
          )}`
        );
        const data = await res.json();
        const translated =
          Array.isArray(data) && Array.isArray(data[0])
            ? data[0].map((part: any) => part[0]).join('')
            : null;
        setTranslations((prev) => ({
          ...prev,
          [message.id]: { text: translated, target: targetLang },
        }));
      } catch (e) {
        setTranslations((prev) => ({
          ...prev,
          [message.id]: { text: null, target: targetLang },
        }));
      } finally {
        setTranslatingMap((prev) => ({ ...prev, [message.id]: false }));
      }
    },
    [translatingMap, getTargetLangForMessage]
  );

  const translateAllMessages = useCallback(
    async () => {
      setTranslatingAll(true);
      try {
        const toTranslate = chatData.filter((m) => {
          if (!m.text) return false;
          const desiredTarget = getTargetLangForMessage(m);
          const existing = translations[m.id];
          return !existing || existing.target !== desiredTarget;
        });
        for (const m of toTranslate) {
          // sequenziale per evitare rate limit
          // eslint-disable-next-line no-await-in-loop
          await translateText(m);
        }
      } finally {
        setTranslatingAll(false);
      }
    },
    [chatData, translations, translateText, getTargetLangForMessage]
  );

  const handleToggleTranslateAll = useCallback(() => {
    setTranslateAllEnabled((prev) => {
      const next = !prev;
      if (next) {
        translateAllMessages();
      }
      return next;
    });
  }, [translateAllMessages]);

  useEffect(() => {
    if (initialLoadDone) {
      markChatReadIfNeeded();
    }
  }, [initialLoadDone, markChatReadIfNeeded]);

  // auto-traduci nuovi messaggi quando la traduzione globale è attiva
  useEffect(() => {
    if (!translateAllEnabled) return;
    const toTranslate = chatData.filter((m) => {
      if (!m.text) return false;
      const desiredTarget = getTargetLangForMessage(m);
      const existing = translations[m.id];
      return !existing || existing.target !== desiredTarget;
    });
    if (!toTranslate.length) return;
    translateAllMessages();
  }, [chatData, translateAllEnabled, translations, translateAllMessages, getTargetLangForMessage]);

  const translateOutgoingText = useCallback(async (text: string, target: string) => {
    try {
      const res = await fetch(
        `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${encodeURIComponent(
          text
        )}`
      );
      const data = await res.json();
      const translated =
        Array.isArray(data) && Array.isArray(data[0])
          ? data[0].map((part: any) => part[0]).join('')
          : null;
      return translated || null;
    } catch (e) {
      return null;
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (initialLoadDone) {
        markChatReadIfNeeded();
      }
      return undefined;
    }, [markChatReadIfNeeded, initialLoadDone])
  );

  const handleSend = async () => {
    if (chatBlocked) {
      Alert.alert('Chat bloccata', 'Sblocca per inviare nuovi messaggi.');
      return;
    }
    if (isBlocked) {
      Alert.alert('Utente bloccato', 'Sblocca per inviare nuovi messaggi.');
      return;
    }
    const trimmed = input.trim();
    if (!trimmed) return;
    let textToSend = trimmed;
    if (translateAllEnabled) {
      const translated = await translateOutgoingText(trimmed, outgoingTargetLang);
      if (translated) {
        textToSend = translated;
      }
    }
    setInput('');
    handleSendMessage({ text: textToSend }, secretMode);
  };

  const handleSendImage = async () => {
    if (chatBlocked) {
      Alert.alert('Chat bloccata', 'Sblocca per inviare nuove foto.');
      return;
    }
    if (isBlocked) {
      Alert.alert('Utente bloccato', 'Sblocca per inviare nuove foto.');
      return;
    }
    if (!chatId || !user?.uid || !otherId) return;
    setActionsOpen(false);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permesso negato', 'Concedi accesso alle foto per inviare un\'immagine.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      base64: true,
      quality: 0.8,
      selectionLimit: 1,
    });
    if (result.canceled || !result.assets.length) return;
    const asset = result.assets[0];
    const mime =
      (asset as any).mimeType ||
      (asset.type && asset.type.includes('/') ? asset.type : null) ||
      null;
    const dataUrl = asset.base64
      ? `data:${mime ?? 'image/jpeg'};base64,${asset.base64}`
      : asset.uri;
    setImageTimed(false);
    setPreviewImage(dataUrl);
    setPreviewVisible(true);
  };

  const sendImageMessage = async (imageUri: string, timed: boolean) => {
    if (!chatId || !user?.uid || !otherId) return;

    setSendingImage(true);

    try {
      await handleSendMessage({ image: imageUri }, timed || secretMode);
    } catch (e: any) {
      console.error('sendImageMessage error:', e);
      Alert.alert('Errore Upload', e.message || 'Errore sconosciuto durante il caricamento.');
    } finally {
      setSendingImage(false);
      setPreviewImage(null);
      setPreviewVisible(false);
      setImageTimed(false);
    }
  };

  const handleAddEmoji = () => {
    setActionsOpen(false);
    setInput((prev) => `${prev}😊`);
  };

  const handleSendLocation = async () => {
    if (!chatId || !user?.uid || !otherId) return;
    if (sendingLocation) return;
    setSendingLocation(true);
    setActionsOpen(false);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permesso negato', 'Concedi accesso alla posizione per inviare la tua posizione.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coords = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      };
      await handleSendMessage(
        {
          location: coords,
        },
        secretMode
      );
    } catch (e) {
      Alert.alert('Errore', 'Non sono riuscito a inviare la posizione.');
    } finally {
      setSendingLocation(false);
    }
  };

  const handleDeleteChat = async () => {
    if (!chatId) return;
    Alert.alert(
      'Elimina chat',
      'Vuoi eliminare tutta la conversazione? L\'operazione non può essere annullata.',
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Elimina',
          style: 'destructive',
          onPress: async () => {
            setDeletingChat(true);
            try {
              const msgsSnap = await getDocs(collection(db, 'chats', chatId, 'messages'));
              await Promise.all(
                msgsSnap.docs.map((d) => deleteDoc(doc(db, 'chats', chatId, 'messages', d.id)))
              );
              await deleteDoc(doc(db, 'chats', chatId));
              router.back();
            } catch (e) {
              Alert.alert('Errore', 'Non sono riuscito a eliminare la chat. Riprova.');
            } finally {
              setDeletingChat(false);
            }
          },
        },
      ]
    );
  };

  const handleToggleBlock = useCallback(() => {
    if (!chatId || !user?.uid || !otherId) return;
    if (blockingUser) return;
    const nextBlocked = !isBlocked;
    const title = nextBlocked ? 'Blocca utente' : 'Sblocca utente';
    const message = nextBlocked
      ? 'Vuoi bloccare questo utente? Non vi vedrete più e la chat sparirà.'
      : 'Vuoi sbloccare questo utente? Potrete tornare a vedervi e chattare.';
    Alert.alert(title, message, [
      { text: 'Annulla', style: 'cancel' },
      {
        text: nextBlocked ? 'Blocca' : 'Sblocca',
        style: nextBlocked ? 'destructive' : 'default',
        onPress: async () => {
          setBlockingUser(true);
          try {
            await Promise.all([
              setDoc(
                doc(db, 'chats', chatId),
                {
                  blockedBy: {
                    [user.uid]: nextBlocked ? serverTimestamp() : deleteField(),
                  },
                },
                { merge: true }
              ),
              setDoc(
                doc(db, 'profiles', user.uid),
                {
                  blocked: nextBlocked ? arrayUnion(otherId) : arrayRemove(otherId),
                },
                { merge: true }
              ),
              setDoc(
                doc(db, 'profiles', otherId),
                {
                  blockedBy: nextBlocked ? arrayUnion(user.uid) : arrayRemove(user.uid),
                },
                { merge: true }
              ),
            ]);
            if (nextBlocked) {
              router.back();
            }
          } catch (e) {
            Alert.alert('Errore', 'Operazione non riuscita, riprova.');
          } finally {
            setBlockingUser(false);
          }
        },
      },
    ]);
  }, [chatId, otherId, user?.uid, blockingUser, isBlocked]);

  const formatAudioDuration = (ms?: number) => {
    if (ms === undefined || ms === null) return '0:00';
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const startExpiryCountdown = useCallback(
    (message: ChatMessage) => {
      if (!chatId || !user?.uid) return;
      if (!message.expiresAfterView) return;
      if (message.senderId === user.uid) return;
      if (message.id.startsWith('local-')) return;
      if (expiryStartedRef.current.has(message.id)) return;

      expiryStartedRef.current.add(message.id);

      const expiryDate =
        message.expiresAt && (message.expiresAt as any).toDate
          ? (message.expiresAt as any).toDate()
          : message.expiresAt
          ? new Date(message.expiresAt)
          : new Date(Date.now() + SECRET_EXPIRY_MS);

      if (!message.expiresAt) {
        setDoc(
          doc(db, 'chats', chatId, 'messages', message.id),
          { expiresAt: Timestamp.fromDate(expiryDate) },
          { merge: true }
        ).catch(() => {});
      }

      const delay = Math.max(0, expiryDate.getTime() - Date.now());
      const fadeLead = 1000; // Inizia l'effetto 1 secondo prima della cancellazione
      const fadeDelay = Math.max(0, delay - fadeLead);
      
      if (!fadeTimeoutsRef.current[message.id]) {
        fadeTimeoutsRef.current[message.id] = setTimeout(() => {
          startFade(message.id);
        }, fadeDelay);
      }
      
      setTimeout(() => {
        deleteDoc(doc(db, 'chats', chatId, 'messages', message.id)).catch(() => {});
      }, delay + 100);
    },
    [chatId, user?.uid, startFade]
  );

  useEffect(() => {
    chatData.forEach((m) => {
      const isImage = !!m.image;
      if (m.expiresAfterView && (!isImage || m.expiresAt)) {
        startExpiryCountdown(m);
      }
    });
    
    setFadingMap((prev) => {
      const next = { ...prev };
      const ids = new Set(chatData.map((m) => m.id));
      Object.keys(next).forEach((id) => {
        if (!ids.has(id)) delete next[id];
      });
      return next;
    });
    
    setShowParticles((prev) => {
      const next = { ...prev };
      const ids = new Set(chatData.map((m) => m.id));
      Object.keys(next).forEach((id) => {
        if (!ids.has(id)) delete next[id];
      });
      return next;
    });
  }, [chatData, startExpiryCountdown]);

  useEffect(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    if (!viewImageVisible || !viewImageTimed || !viewImageExpiry) {
      setViewImageCountdown(null);
      return;
    }
    const update = () => {
      const remainingMs = viewImageExpiry - Date.now();
      setViewImageCountdown(Math.max(0, Math.ceil(remainingMs / 1000)));
    };
    update();
    countdownRef.current = setInterval(update, 500);
    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, [viewImageVisible, viewImageTimed, viewImageExpiry]);

  useEffect(() => {
    if (
      viewImageVisible &&
      viewImageTimed &&
      viewImageCountdown !== null &&
      viewImageCountdown <= 0
    ) {
      setViewImageVisible(false);
      setViewImage(null);
      setViewImageTimed(false);
      setViewImageCountdown(null);
      setViewImageExpiry(null);
    }
  }, [viewImageVisible, viewImageTimed, viewImageCountdown]);

  const handleDeleteMessage = useCallback(
    (message: ChatMessage) => {
      if (!chatId || message.id.startsWith('local-')) return;
      deleteDoc(doc(db, 'chats', chatId, 'messages', message.id)).catch(() => {});
    },
    [chatId]
  );

  const openImageWithExpiry = (message: ChatMessage) => {
    let expiryDate: Date | null = null;
    if (message.expiresAfterView) {
      const serverExpiry =
        message.expiresAt && (message.expiresAt as any).toDate
          ? (message.expiresAt as any).toDate()
          : message.expiresAt
          ? new Date(message.expiresAt)
          : null;
      expiryDate = serverExpiry ?? new Date(Date.now() + SECRET_EXPIRY_MS);
      startExpiryCountdown(message);
      setViewImageTimed(true);
      setViewImageExpiry(expiryDate.getTime());
      setViewImageCountdown(
        Math.max(0, Math.ceil((expiryDate.getTime() - Date.now()) / 1000))
      );
    } else {
      setViewImageTimed(false);
      setViewImageExpiry(null);
      setViewImageCountdown(null);
    }
    setViewImage(message.image);
    setViewImageVisible(true);
  };

  const handleOpenImageMessage = (message: ChatMessage) => {
    if (!message.image) return;
    const isMine = message.senderId === user?.uid;
    const missingModeration = !message.moderationStatus && !!message.imagePath;
    if (!isMine && (message.moderationStatus === 'pending' || missingModeration)) {
      Alert.alert('Contenuto in verifica', 'L\'immagine e in analisi. Riprova tra poco.');
      return;
    }
    const isFlagged =
      message.moderationStatus === 'flagged' && message.contentWarning === 'nudity';
    if (isFlagged && !revealedWarnings[message.id]) {
      Alert.alert(
        'Contenuto sensibile',
        'Questa immagine potrebbe contenere nudità. Vuoi vederla?',
        [
          { text: 'Annulla', style: 'cancel' },
          { text: 'Elimina', style: 'destructive', onPress: () => handleDeleteMessage(message) },
          {
            text: 'OK',
            onPress: () => {
              setRevealedWarnings((prev) => ({ ...prev, [message.id]: true }));
              openImageWithExpiry(message);
            },
          },
        ]
      );
      return;
    }
    openImageWithExpiry(message);
  };

  const renderItem = ({ item }: { item: ChatMessage }) => {
    const isMine = item.senderId === user?.uid;
    return (
      <ChatMessageItem
        item={item}
        isMine={isMine}
        chatMeta={chatMeta}
        otherId={otherId}
        palette={palette}
        translations={translations}
        translatingMap={translatingMap}
        fadingMap={fadingMap}
        showParticles={showParticles}
        fadeValuesRef={fadeValuesRef}
        scaleValuesRef={scaleValuesRef}
        playbackStatus={playbackStatus}
        playingId={playingId}
        expiryStartedRef={expiryStartedRef}
        formatTime={formatTime}
        getTargetLangForMessage={getTargetLangForMessage}
        handlePlayAudio={handlePlayAudio}
        handleOpenImageMessage={handleOpenImageMessage}
        translateAllEnabled={translateAllEnabled}
        revealedWarnings={revealedWarnings}
        ParticleEffect={ParticleEffect}
      />
    );
  };

  const renderHeader = () => (
    <View style={[styles.header, { 
      backgroundColor: palette.background,
      borderBottomColor: palette.border,
    }]}>
      <Pressable 
        style={[styles.headerButton, { backgroundColor: palette.card }]} 
        onPress={() => router.back()}
      >
        <Ionicons name="chevron-back" size={24} color={palette.text} />
      </Pressable>
      
      <View style={styles.headerCenter}>
        <View style={styles.userInfo}>
          {otherPhoto && (
            <View style={[styles.avatarContainer, { borderColor: palette.border }]}>
              <Image
                source={{ uri: otherPhoto }}
                style={styles.avatar}
                contentFit="cover"
                priority="high"
              />
            </View>
          )}
          <View style={styles.userText}>
            <Text style={[styles.headerTitle, { color: palette.text }]}>
              {otherName || 'Chat'}
            </Text>
            <Text style={[styles.headerSubtitle, { color: palette.muted }]}>
              Online
            </Text>
          </View>
        </View>
      </View>
      
      <View style={styles.headerActions}>
        <Pressable
          style={[
            styles.blockBadge,
            {
              backgroundColor: isBlocked ? `${palette.accent}22` : `${palette.tint}12`,
              borderColor: isBlocked ? palette.accent : palette.border,
            },
          ]}
          onPress={handleToggleBlock}
        >
          {blockingUser ? (
            <ActivityIndicator size="small" color={palette.text} />
          ) : (
            <Text
              style={[
                styles.blockBadgeText,
                { color: isBlocked ? palette.accent : palette.text },
              ]}
            >
              {isBlocked ? 'Sblocca' : 'Blocca'}
            </Text>
          )}
        </Pressable>

        <Pressable
          style={[styles.iconButton, { backgroundColor: palette.card }]}
          onPress={handleDeleteChat}
          disabled={deletingChat || blockingUser}
        >
          {deletingChat ? (
            <ActivityIndicator size="small" color={palette.text} />
          ) : (
            <Ionicons name="trash-outline" size={20} color={palette.text} />
          )}
        </Pressable>
      </View>
    </View>
  );

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: palette.background }]}
      edges={['top', 'bottom']}
    >
      {renderHeader()}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={chatData}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.listContent,
            !chatData.length ? styles.listContentEmpty : null,
          ]}
          style={styles.flex}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scheduleScroll(100)}
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews={true}
          ListEmptyComponent={
            messagesLoading ? (
              <View style={styles.emptyChat}>
                <ActivityIndicator size="large" color={palette.tint} />
                <Text style={[styles.loadingText, { color: palette.muted }]}>
                  Caricamento messaggi...
                </Text>
              </View>
            ) : (
              <View style={styles.emptyChat}>
                <Ionicons name="chatbubbles-outline" size={36} color={palette.muted} />
                <Text style={[styles.emptyChatText, { color: palette.muted }]}>
                  Nessun messaggio in questa chat.
                </Text>
              </View>
            )
          }
        />

        <View style={[styles.inputContainer, { backgroundColor: palette.background }]}>
          <View style={[styles.inputWrapper, { 
            backgroundColor: palette.card,
            borderColor: palette.border,
          }]}>
            {actionsOpen && (
              <View style={[styles.actionsPanel, { 
                backgroundColor: palette.card,
                borderColor: palette.border,
              }]}>
                <Pressable style={[styles.actionButton, styles.actionButtonRow]} onPress={handleSendLocation} disabled={sendingLocation}>
                  <View style={[styles.actionIcon, { backgroundColor: `${palette.tint}15` }]}>
                    {sendingLocation ? (
                      <ActivityIndicator size="small" color={palette.tint} />
                    ) : (
                      <Ionicons name="location-outline" size={22} color={palette.tint} />
                    )}
                  </View>
                  <View style={styles.actionLabels}>
                    <Text style={[styles.actionText, { color: palette.text }]}>Posizione</Text>
                    <Text style={[styles.actionSubText, { color: palette.muted }]}>Condividi coordinate</Text>
                  </View>
                </Pressable>

                <Pressable
                  style={[styles.actionButton, styles.actionButtonRow]}
                  onPress={() => setTranslationSettingsVisible(true)}
                  onLongPress={handleToggleTranslateAll}
                  >
                    <View
                      style={[
                        styles.actionIcon,
                        { backgroundColor: translateAllEnabled ? `${palette.accent}22` : `${palette.tint}15` },
                    ]}
                  >
                    {translatingAll ? (
                      <ActivityIndicator size="small" color={palette.accent} />
                    ) : (
                      <Ionicons
                        name="language-outline"
                        size={22}
                        color={translateAllEnabled ? palette.accent : palette.tint}
                      />
                    )}
                  </View>
                  <View style={styles.actionLabels}>
                    <Text style={[styles.actionText, { color: palette.text }]}>
                      {translateAllEnabled ? 'Traduzione ON' : 'Traduci chat'}
                    </Text>
                    <Text style={[styles.actionSubText, { color: palette.muted }]} numberOfLines={1}>
                      Arrivo -> {incomingTargetLang.toUpperCase()} | Invio -> {outgoingTargetLang.toUpperCase()}
                    </Text>
                  </View>
                </Pressable>

                <Pressable style={[styles.actionButton, styles.actionButtonRow]} onPress={() => setSecretMode((prev) => !prev)}>
                  <View
                    style={[
                      styles.actionIcon,
                      { backgroundColor: secretMode ? `${palette.accent}22` : `${palette.tint}15` },
                    ]}
                  >
                    <Ionicons
                      name={secretMode ? 'lock-closed' : 'lock-open-outline'}
                      size={22}
                      color={secretMode ? palette.accent : palette.tint}
                    />
                  </View>
                  <View style={styles.actionLabels}>
                    <Text style={[styles.actionText, { color: palette.text }]}>
                      {secretMode ? 'Segreta ON' : 'Segreta'}
                    </Text>
                    <Text style={[styles.actionSubText, { color: palette.muted }]} numberOfLines={1}>
                      Messaggi autodistruzione
                    </Text>
                  </View>
                </Pressable>
              </View>
            )}

            {secretMode && (
              <View
                style={[
                  styles.secretBanner,
                  {
                    backgroundColor: `${palette.accent}16`,
                    borderColor: palette.accent,
                  },
                ]}
              >
                <Ionicons name="timer-outline" size={16} color={palette.accent} />
                <Text style={[styles.secretBannerText, { color: palette.text }]}>
                  Chat segreta attiva: i messaggi spariscono dopo la lettura.
                </Text>
              </View>
            )}

            {translateAllEnabled && (
              <View
                style={[
                  styles.secretBanner,
                  {
                    backgroundColor: `${palette.accent}12`,
                    borderColor: palette.accent,
                  },
                ]}
              >
                <Ionicons name="language-outline" size={16} color={palette.accent} />
                <Text style={[styles.secretBannerText, { color: palette.text }]}>
                  Traduzione automatica attiva | Arrivo -> {incomingTargetLang.toUpperCase()} | Invio -> {outgoingTargetLang.toUpperCase()}
                </Text>
              </View>
            )}

            <View style={styles.inputRow}>
              <Pressable
                style={[styles.menuButton, { 
                  backgroundColor: actionsOpen ? palette.tint : 'transparent',
                  borderColor: actionsOpen ? palette.tint : palette.border,
                }]}
                onPress={() => setActionsOpen((prev) => !prev)}
              >
                <Ionicons
                  name={actionsOpen ? 'close' : 'add'}
                  size={20}
                  color={actionsOpen ? '#fff' : palette.text}
                />
              </Pressable>

              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder={isRecording ? '' : 'messaggio..'}
                placeholderTextColor={palette.muted}
                style={[styles.textInput, { 
                  color: palette.text,
                  backgroundColor: palette.background,
                  opacity: isRecording ? 0.5 : 1,
                }]}
                multiline
                maxLength={500}
                underlineColorAndroid="transparent"
                editable={!isRecording}
              />

              <Pressable
                style={[
                  styles.voiceButton,
                  { backgroundColor: palette.card },
                  (sendingImage || isRecording) && { opacity: 0.6 },
                ]}
                onPress={handleSendImage}
                disabled={sendingImage || isRecording}
              >
                {sendingImage ? (
                  <ActivityIndicator size="small" color={palette.text} />
                ) : (
                  <Ionicons name="camera-outline" size={20} color={palette.text} />
                )}
              </Pressable>
              
              {input.trim() ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.sendButton,
                    {
                      backgroundColor: `${palette.tint}12`,
                      borderColor: `${palette.tint}35`,
                    },
                    pressed && styles.sendButtonPressed,
                  ]}
                  onPress={handleSend}
                  disabled={sending}
                >
                  <View style={[styles.sendButtonInner, { backgroundColor: palette.tint }]}>
                    {sending ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Ionicons name="send" size={20} color="#fff" />
                    )}
                  </View>
                </Pressable>
              ) : (
                <Pressable
                  style={[
                    styles.voiceButton,
                    isRecording ? styles.voiceButtonRecording : { backgroundColor: palette.card },
                  ]}
                  onPress={handleRecordAudio}
                  disabled={sendingAudio}
                >
                  {sendingAudio ? (
                    <ActivityIndicator size="small" color={isRecording ? '#fff' : palette.text} />
                  ) : (
                    <Ionicons
                      name={isRecording ? 'stop' : 'mic-outline'}
                      size={20}
                      color={isRecording ? '#fff' : palette.text}
                    />
                  )}
                </Pressable>
              )}
            </View>
            {isRecording ? (
              <View
                style={[
                  styles.recordingBadge,
                  { backgroundColor: `${palette.tint}10`, borderColor: `${palette.tint}35` },
                ]}
              >
                <View style={[styles.recordingDot, { backgroundColor: palette.tint }]} />
                <Text style={[styles.recordingText, { color: palette.text }]}>
                  Registrazione... {formatAudioDuration(recordingDuration)}
                </Text>
                <View style={styles.recordingControls}>
                  <Pressable
                    style={[
                      styles.recordingButton,
                      { backgroundColor: palette.tint },
                    ]}
                    onPress={recordingPaused ? resumeRecording : pauseRecording}
                  >
                    <Ionicons
                      name={recordingPaused ? 'play' : 'pause'}
                      size={16}
                      color="#fff"
                    />
                  </Pressable>
                  <Pressable
                    style={[styles.recordingButton, styles.recordingCancel]}
                    onPress={cancelRecording}
                  >
                    <Ionicons name="close" size={16} color="#fff" />
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={translationSettingsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setTranslationSettingsVisible(false)}
      >
        <View style={styles.translationModalBackdrop}>
          <View
            style={[
              styles.translationModalCard,
              { backgroundColor: palette.card, borderColor: palette.border },
            ]}
          >
            <View style={styles.translationModalHeader}>
              <Text style={[styles.translationModalTitle, { color: palette.text }]}>
                Impostazioni traduzione
              </Text>
              <Pressable
                style={[styles.modalButton, styles.translationCloseButton]}
                onPress={() => setTranslationSettingsVisible(false)}
              >
                <Ionicons name="close" size={20} color={palette.text} />
              </Pressable>
            </View>

            <View style={styles.translationModalRow}>
              <View style={styles.translationModalLabelWrap}>
                <Text style={[styles.translationModalLabel, { color: palette.text }]}>
                  Traduci automaticamente
                </Text>
                <Text style={[styles.translationModalHint, { color: palette.muted }]}>
                  Mantieni i messaggi nella lingua scelta
                </Text>
              </View>
              <Switch
                value={translateAllEnabled}
                onValueChange={handleToggleTranslateAll}
                trackColor={{ false: palette.border, true: palette.accent }}
                thumbColor={translateAllEnabled ? '#fff' : '#f4f3f4'}
              />
            </View>

            <Pressable
              style={styles.translationModalRow}
              onPress={() => setIncomingTargetLang((prev) => cycleLang(prev))}
            >
              <View style={styles.translationModalLabelWrap}>
                <Text style={[styles.translationModalLabel, { color: palette.text }]}>
                  Lingua di arrivo
                </Text>
                <Text style={[styles.translationModalHint, { color: palette.muted }]}>
                  Mostra i messaggi ricevuti in
                </Text>
              </View>
              <View
                style={[
                  styles.translationBadge,
                  { backgroundColor: `${palette.tint}12`, borderColor: palette.border },
                ]}
              >
                <Text style={[styles.translationModalLabel, { color: palette.text }]}>
                  {incomingTargetLang.toUpperCase()}
                </Text>
              </View>
            </Pressable>

            <Pressable
              style={styles.translationModalRow}
              onPress={() => setOutgoingTargetLang((prev) => cycleLang(prev))}
            >
              <View style={styles.translationModalLabelWrap}>
                <Text style={[styles.translationModalLabel, { color: palette.text }]}>
                  Lingua di invio
                </Text>
                <Text style={[styles.translationModalHint, { color: palette.muted }]}>
                  Traduce quello che scrivi
                </Text>
              </View>
              <View
                style={[
                  styles.translationBadge,
                  { backgroundColor: `${palette.tint}12`, borderColor: palette.border },
                ]}
              >
                <Text style={[styles.translationModalLabel, { color: palette.text }]}>
                  {outgoingTargetLang.toUpperCase()}
                </Text>
              </View>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={previewVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          {previewImage ? (
            <Image
              source={{ uri: previewImage }}
              style={styles.modalImage}
              contentFit="contain"
            />
          ) : null}
          
          <View style={styles.modalHeader}>
            <Pressable
              style={[styles.modalButton, styles.cancelButton]}
              onPress={() => {
                if (sendingImage) return;
                setPreviewImage(null);
                setPreviewVisible(false);
                setImageTimed(false);
              }}
              disabled={sendingImage}
            >
              <Ionicons name="close" size={24} color="#fff" />
            </Pressable>
          </View>
          
          <View style={styles.timedToggleWrapper}>
            <Pressable
              style={[
                styles.timedToggle,
                { borderColor: imageTimed ? palette.tint : 'rgba(255,255,255,0.2)' },
              ]}
              onPress={() => setImageTimed((prev) => !prev)}
              disabled={sendingImage}
            >
              <View
                style={[
                  styles.timedToggleIcon,
                  { backgroundColor: imageTimed ? palette.tint : 'rgba(255,255,255,0.1)' },
                ]}
              >
                <Ionicons
                  name="timer-outline"
                  size={18}
                  color={imageTimed ? '#fff' : 'rgba(255,255,255,0.9)'}
                />
              </View>
              <Text style={styles.timedToggleText}>
                Autodistruzione dopo 10s dalla visualizzazione
              </Text>
              <Ionicons
                name={imageTimed ? 'checkbox' : 'square-outline'}
                size={20}
                color={imageTimed ? '#fff' : 'rgba(255,255,255,0.7)'}
              />
            </Pressable>
          </View>
          
          <View style={styles.modalFooter}>
            <Pressable
              style={[styles.modalActionButton, styles.cancelActionButton]}
              onPress={() => {
                if (sendingImage) return;
                setPreviewImage(null);
                setPreviewVisible(false);
                setImageTimed(false);
              }}
              disabled={sendingImage}
            >
              <Text style={styles.modalButtonText}>Annulla</Text>
            </Pressable>
            
            <Pressable
              style={[styles.modalActionButton, styles.confirmActionButton]}
              onPress={() => previewImage && sendImageMessage(previewImage, imageTimed || secretMode)}
              disabled={sendingImage || !previewImage}
            >
              {sendingImage ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark" size={20} color="#fff" style={styles.buttonIcon} />
                  <Text style={styles.modalButtonText}>Invia</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={viewImageVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setViewImageVisible(false);
          setViewImage(null);
          setViewImageTimed(false);
          setViewImageCountdown(null);
          setViewImageExpiry(null);
        }}
      >
        <View style={styles.modalBackdrop}>
          {viewImage ? (
            <Image source={{ uri: viewImage }} style={styles.modalImage} contentFit="contain" />
          ) : null}

          <View style={styles.modalHeader}>
            <Pressable
              style={[styles.modalButton, styles.cancelButton]}
              onPress={() => {
                setViewImageVisible(false);
                setViewImage(null);
                setViewImageTimed(false);
                setViewImageCountdown(null);
                setViewImageExpiry(null);
              }}
            >
              <Ionicons name="close" size={24} color="#fff" />
            </Pressable>
          </View>

          {viewImageTimed ? (
            <View style={styles.modalHint}>
              <Ionicons name="timer-outline" size={18} color="#fff" />
              <Text style={styles.modalHintText}>
                Questa foto si cancellerà tra {viewImageCountdown ?? 10}s
              </Text>
            </View>
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    paddingHorizontal: 8,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  userText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  blockBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  blockBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 20,
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyChat: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  emptyChatText: {
    marginTop: 10,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 14,
    textAlign: 'center',
  },
  inputContainer: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    paddingTop: 6,
  },
  inputWrapper: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 10,
  },
  actionsPanel: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 10,
    marginBottom: 8,
    gap: 8,
  },
  actionButton: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  actionButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabels: {
    flex: 1,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  actionSubText: {
    fontSize: 12,
    lineHeight: 16,
  },
  secretBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  secretBannerText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  menuButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
  },
  voiceButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceButtonRecording: {
    backgroundColor: '#E53935',
  },
  sendButton: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 3,
  },
  sendButtonPressed: {
    opacity: 0.8,
  },
  sendButtonInner: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 8,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  recordingText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  recordingControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recordingButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingCancel: {
    backgroundColor: '#E53935',
  },
  translationModalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  translationModalCard: {
    width: '100%',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
  },
  translationModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  translationModalTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  translationModalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  translationModalLabelWrap: {
    flex: 1,
    marginRight: 12,
  },
  translationModalLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  translationModalHint: {
    fontSize: 12,
    marginTop: 2,
  },
  translationBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  translationCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalImage: {
    width: '100%',
    height: '100%',
  },
  modalHeader: {
    position: 'absolute',
    top: 20,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  cancelButton: {},
  timedToggleWrapper: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 90,
  },
  timedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  timedToggleIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timedToggleText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  modalFooter: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    flexDirection: 'row',
    gap: 12,
  },
  modalActionButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelActionButton: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  confirmActionButton: {
    backgroundColor: 'rgba(76,175,80,0.9)',
  },
  modalButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  buttonIcon: {
    marginRight: 6,
  },
  modalHint: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  modalHintText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});


