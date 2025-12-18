import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
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
  Linking,
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
import { useAuth } from '@/hooks/use-auth';
import { db } from '@/lib/firebase';

type ChatMessage = {
  id: string;
  text?: string;
  senderId: string;
  createdAt?: Timestamp | Date;
  image?: string;
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

// Componente ParticleEffect semplificato
const ParticleEffect = React.memo(({ visible, color }: { visible: boolean; color: string }) => {
  const particles = useMemo(
    () =>
      Array.from({ length: 12 }).map(() => ({
        anim: new Animated.Value(0),
        angle: Math.random() * 360,
        distance: 30 + Math.random() * 60,
        size: 2 + Math.random() * 4,
        delay: Math.random() * 120,
      })),
    []
  );

  const [showParticles, setShowParticles] = useState(false);

  useEffect(() => {
    if (visible) {
      setShowParticles(true);
      const animations = particles.map((p, i) =>
        Animated.timing(p.anim, {
          toValue: 1,
          duration: 900,
          delay: p.delay + i * 15,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        })
      );
      Animated.parallel(animations).start(() => {
        setShowParticles(false);
        particles.forEach((p) => p.anim.setValue(0));
      });
    } else {
      setShowParticles(false);
      particles.forEach((p) => p.anim.setValue(0));
    }
  }, [visible, particles]);

  if (!showParticles) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} pointerEvents="none">
      {particles.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            width: p.size,
            height: p.size,
            borderRadius: p.size / 2,
            backgroundColor: color,
            left: '50%',
            top: '50%',
            opacity: p.anim.interpolate({
              inputRange: [0, 0.3, 0.7, 1],
              outputRange: [1, 0.8, 0.4, 0],
            }),
            transform: [
              {
                translateX: p.anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, Math.cos((p.angle * Math.PI) / 180) * p.distance],
                }),
              },
              {
                translateY: p.anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, Math.sin((p.angle * Math.PI) / 180) * p.distance],
                }),
              },
              {
                scale: p.anim.interpolate({
                  inputRange: [0, 0.5, 1],
                  outputRange: [1, 1.05, 0.2],
                }),
              },
              {
                rotate: p.anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0deg', `${Math.random() * 30 - 15}deg`],
                }),
              },
            ],
          }}
        />
      ))}
    </View>
  );
});

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

  // Stati base
  const [otherName, setOtherName] = useState<string>(initialName ?? '');
  const [otherPhoto, setOtherPhoto] = useState<string | undefined>(initialPhoto ?? FALLBACK_PHOTO);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingMessages, setPendingMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  
  // Stati secondari
  const [sending, setSending] = useState(false);
  const [sendingImage, setSendingImage] = useState(false);
  const [sendingAudio, setSendingAudio] = useState(false);
  const [sendingLocation, setSendingLocation] = useState(false);
  const [deletingChat, setDeletingChat] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [imageTimed, setImageTimed] = useState(false);
  const [viewImage, setViewImage] = useState<string | null>(null);
  const [viewImageVisible, setViewImageVisible] = useState(false);
  const [viewImageTimed, setViewImageTimed] = useState(false);
  const [viewImageCountdown, setViewImageCountdown] = useState<number | null>(null);
  const [viewImageExpiry, setViewImageExpiry] = useState<number | null>(null);
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
  const [isRecording, setIsRecording] = useState(false);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playbackStatus, setPlaybackStatus] = useState<Audio.AVPlaybackStatus | null>(null);
  const [blockingUser, setBlockingUser] = useState(false);
  
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const prevCountRef = useRef(0);
  const [chatMeta, setChatMeta] = useState<any | null>(null);
  const readInFlightRef = useRef(false);
  const lastMarkedRef = useRef(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const audioCacheRef = useRef<Record<string, string>>({});
  const expiryStartedRef = useRef<Set<string>>(new Set());
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const fadeTimeoutsRef = useRef<Record<string, NodeJS.Timeout>>({});
  const fadeValuesRef = useRef<Record<string, Animated.Value>>({});
  const scaleValuesRef = useRef<Record<string, Animated.Value>>({});
  const base64Encoding = (FileSystem as any).EncodingType?.Base64 || 'base64';

  const chatId = useMemo(() => {
    if (chatIdParam) return String(chatIdParam);
    if (!user?.uid || !otherId) return null;
    return [user.uid, otherId].sort().join('_');
  }, [user?.uid, otherId, chatIdParam]);

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

  // Carica messaggi
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
        setTimeout(() => scheduleScroll(50), 100);
      } else {
        scheduleScroll(50);
      }
    });
    
    return unsub;
  }, [chatId, initialLoadDone, scheduleScroll]);

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
    const chatData = [...messages, ...pendingMessages];
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
  }, [chatId, user?.uid, messages, pendingMessages, chatMeta, initialLoadDone]);

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
        const toTranslate = [...messages, ...pendingMessages].filter((m) => {
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
    [messages, pendingMessages, translations, translateText, getTargetLangForMessage]
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
    const toTranslate = messages.filter((m) => {
      if (!m.text) return false;
      const desiredTarget = getTargetLangForMessage(m);
      const existing = translations[m.id];
      return !existing || existing.target !== desiredTarget;
    });
    if (!toTranslate.length) return;
    translateAllMessages();
  }, [messages, translateAllEnabled, translations, translateAllMessages, getTargetLangForMessage]);

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
    if (!chatId || !user?.uid || !otherId) return;
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
    setSending(true);
    const tempId = `local-${Date.now()}`;
    const optimisticMsg: ChatMessage = {
      id: tempId,
      text: textToSend,
      senderId: user.uid,
      createdAt: new Date(),
      expiresAfterView: secretMode,
    };
    setPendingMessages((prev) => [...prev, optimisticMsg]);
    setInput('');
    try {
      await setDoc(
        doc(db, 'chats', chatId),
        {
          participants: [user.uid, otherId],
          updatedAt: serverTimestamp(),
          lastMessage: textToSend,
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

      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        text: textToSend,
        senderId: user.uid,
        createdAt: serverTimestamp(),
        expiresAfterView: secretMode,
      });
      setPendingMessages((prev) => prev.filter((m) => m.id !== tempId));
    } catch (e) {
      setPendingMessages((prev) => prev.filter((m) => m.id !== tempId));
    } finally {
      setSending(false);
    }
  };

  const handleSendImage = async () => {
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
    const dataUrl = asset.base64 && asset.type ? `data:${asset.type};base64,${asset.base64}` : asset.uri;
    setImageTimed(false);
    setPreviewImage(dataUrl);
    setPreviewVisible(true);
  };

  const sendImageMessage = async (dataUrl: string, timed: boolean) => {
    if (!chatId || !user?.uid || !otherId) return;
    setSendingImage(true);
    const tempId = `local-img-${Date.now()}`;
    const optimisticMsg: ChatMessage = {
      id: tempId,
      senderId: user.uid,
      createdAt: new Date(),
      image: dataUrl,
      expiresAfterView: timed || secretMode,
    };
    setPendingMessages((prev) => [...prev, optimisticMsg]);
    try {
      await setDoc(
        doc(db, 'chats', chatId),
        {
          participants: [user.uid, otherId],
          updatedAt: serverTimestamp(),
          lastMessage: '[Foto]',
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

      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        image: dataUrl,
        expiresAfterView: timed || secretMode,
        senderId: user.uid,
        createdAt: serverTimestamp(),
      });
      setPendingMessages((prev) => prev.filter((m) => m.id !== tempId));
    } catch (e) {
      setPendingMessages((prev) => prev.filter((m) => m.id !== tempId));
      Alert.alert('Errore', 'Non sono riuscito a inviare la foto.');
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
      const tempId = `local-location-${Date.now()}`;
      const optimisticMsg: ChatMessage = {
        id: tempId,
        senderId: user.uid,
        createdAt: new Date(),
        location: coords,
        expiresAfterView: secretMode,
      };
      setPendingMessages((prev) => [...prev, optimisticMsg]);

      await setDoc(
        doc(db, 'chats', chatId),
        {
          participants: [user.uid, otherId],
          updatedAt: serverTimestamp(),
          lastMessage: '[Posizione]',
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

      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        location: coords,
        senderId: user.uid,
        createdAt: serverTimestamp(),
        expiresAfterView: secretMode,
      });
      setPendingMessages((prev) => prev.filter((m) => m.id !== tempId));
    } catch (e) {
      setPendingMessages((prev) => prev.filter((m) => m.id !== tempId));
      Alert.alert('Errore', 'Non sono riuscito a inviare la posizione.');
    } finally {
      setSendingLocation(false);
    }
  };

  const startRecording = async () => {
    try {
      setActionsOpen(false);
      if (!chatId || !user?.uid || !otherId) {
        Alert.alert('Errore', 'Chat non disponibile per l\'invio audio.');
        return;
      }
      if (soundRef.current) {
        try {
          await soundRef.current.stopAsync();
          await soundRef.current.unloadAsync();
        } catch {}
        soundRef.current = null;
        setPlayingId(null);
        setPlaybackStatus(null);
      }
      const existing = await Audio.getPermissionsAsync();
      const perm = existing.granted ? existing : await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permesso negato', 'Concedi accesso al microfono per inviare un audio.');
        return;
      }

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.LOW_QUALITY);
      await recording.startAsync();
      recording.setOnRecordingStatusUpdate((status) => {
        if (status.isRecording) {
          setRecordingDuration(status.durationMillis ?? 0);
        }
      });
      recordingRef.current = recording;
      setIsRecording(true);
      setRecordingPaused(false);
      setRecordingDuration(0);
    } catch (e) {
      recordingRef.current = null;
      setIsRecording(false);
      Alert.alert('Errore', 'Non sono riuscito ad avviare la registrazione.');
    }
  };

  const stopRecordingAndSend = async () => {
    const active = recordingRef.current;
    if (!active || !chatId || !user?.uid || !otherId) return;
    const tempId = `local-audio-${Date.now()}`;
    setSendingAudio(true);
    try {
      await active.stopAndUnloadAsync();
      const status = await active.getStatusAsync();
      const uri = active.getURI();
      recordingRef.current = null;
      setIsRecording(false);
      const duration = status && 'durationMillis' in status ? status.durationMillis ?? 0 : 0;
      const base64 = uri
        ? await FileSystem.readAsStringAsync(uri, { encoding: base64Encoding as any })
        : null;
      if (!uri || !base64) {
        throw new Error('Audio non valido');
      }
      const dataUrl = `data:audio/m4a;base64,${base64}`;
      const optimisticMsg: ChatMessage = {
        id: tempId,
        senderId: user.uid,
        createdAt: new Date(),
        audio: dataUrl,
        audioDuration: duration || recordingDuration,
        expiresAfterView: secretMode,
      };
      setPendingMessages((prev) => [...prev, optimisticMsg]);

      await setDoc(
        doc(db, 'chats', chatId),
        {
          participants: [user.uid, otherId],
          updatedAt: serverTimestamp(),
          lastMessage: '[Audio]',
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

      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        audio: dataUrl,
        audioDuration: duration || recordingDuration,
        senderId: user.uid,
        createdAt: serverTimestamp(),
        expiresAfterView: secretMode,
      });
      setPendingMessages((prev) => prev.filter((m) => m.id !== tempId));
    } catch (e) {
      setPendingMessages((prev) => prev.filter((m) => m.id !== tempId));
      Alert.alert('Errore', 'Non sono riuscito a inviare il messaggio audio.');
    } finally {
      setSendingAudio(false);
      setRecordingDuration(0);
      recordingRef.current = null;
      setIsRecording(false);
      setRecordingPaused(false);
    }
  };

  const handleRecordAudio = async () => {
    if (sendingAudio) return;
    if (isRecording) {
      await stopRecordingAndSend();
    } else {
      await startRecording();
    }
  };

  const pauseRecording = async () => {
    const rec = recordingRef.current;
    if (!rec) return;
    try {
      await rec.pauseAsync();
      setRecordingPaused(true);
    } catch {}
  };

  const resumeRecording = async () => {
    const rec = recordingRef.current;
    if (!rec) return;
    try {
      await rec.startAsync();
      setRecordingPaused(false);
    } catch {}
  };

  const cancelRecording = async () => {
    const rec = recordingRef.current;
    try {
      if (rec) {
        await rec.stopAndUnloadAsync();
      }
    } catch {}
    recordingRef.current = null;
    setIsRecording(false);
    setRecordingPaused(false);
    setRecordingDuration(0);
  };

  const chatData = useMemo(() => [...messages, ...pendingMessages], [messages, pendingMessages]);

  const prepareAudioUri = async (audio: string | undefined, id: string) => {
    if (!audio) return null;
    if (audio.startsWith('http')) return audio;
    if (audio.startsWith('data:audio')) {
      if (audioCacheRef.current[id]) return audioCacheRef.current[id];
      const base64 = audio.split(',')[1] ?? audio;
      const cacheDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (!cacheDir) return null;
      const fileUri = `${cacheDir}chat-audio-${id}.m4a`;
      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: base64Encoding as any,
      });
      audioCacheRef.current[id] = fileUri;
      return fileUri;
    }
    return audio;
  };

  const handlePlayAudio = async (item: ChatMessage) => {
    if (!item.audio) return;
    try {
      const uri = await prepareAudioUri(item.audio, item.id);
      if (!uri) return;

      if (playingId === item.id && soundRef.current) {
        const status = await soundRef.current.getStatusAsync();
        if (status.isLoaded && status.isPlaying) {
          await soundRef.current.pauseAsync();
        } else {
          await soundRef.current.playAsync();
        }
        return;
      }

      if (soundRef.current) {
        try {
          await soundRef.current.stopAsync();
          await soundRef.current.unloadAsync();
        } catch {}
        soundRef.current = null;
      }

      setPlaybackStatus(null);

      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        setPlaybackStatus(status);
        if (status.didJustFinish) {
          setPlayingId(null);
          setPlaybackStatus(null);
        }
      });
      soundRef.current = sound;
      setPlayingId(item.id);
    } catch (e) {
      setPlayingId(null);
      setPlaybackStatus(null);
      Alert.alert('Errore', 'Non sono riuscito a riprodurre l\'audio.');
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

  const handleOpenImageMessage = (message: ChatMessage) => {
    if (!message.image) return;
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

  useEffect(() => {
    return () => {
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
      }
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
    };
  }, []);

  const renderItem = ({ item }: { item: ChatMessage }) => {
    const isMine = item.senderId === user?.uid;
    const time = formatTime(item.createdAt);
    const isPendingImage = isMine && item.image && item.id.startsWith('local-img-');
    const isPendingAudio = isMine && item.audio && item.id.startsWith('local-audio-');
    const isPendingLocation = isMine && item.location && item.id.startsWith('local-location-');
    const loadedPlayback = playbackStatus && playbackStatus.isLoaded ? playbackStatus : null;
    const isPlayingThis = playingId === item.id && !!loadedPlayback;
    const progress =
      isPlayingThis && loadedPlayback?.durationMillis
        ? (loadedPlayback.positionMillis ?? 0) / loadedPlayback.durationMillis
        : 0;
    const isEphemeral = !!item.expiresAfterView;
    const isEphemeralImage = isEphemeral && !!item.image;
    const isLockedImage =
      isEphemeralImage && !item.expiresAt && !expiryStartedRef.current.has(item.id);
    const isFading = !!fadingMap[item.id];
    const createdAtMs =
      item.createdAt instanceof Date
        ? item.createdAt.getTime()
        : (item.createdAt as any)?.toDate
        ? (item.createdAt as any).toDate().getTime()
        : 0;
    const otherReadMs =
      chatMeta?.readBy?.[otherId]?.toDate?.()
        ? chatMeta.readBy[otherId].toDate().getTime()
        : chatMeta?.readBy?.[otherId] instanceof Date
        ? (chatMeta.readBy[otherId] as Date).getTime()
        : 0;
    const isReadByOther = isMine && createdAtMs && otherReadMs && otherReadMs >= createdAtMs;
    const isSendingLocal = isMine && item.id.startsWith('local-');
    const statusColor = isMine ? 'rgba(255,255,255,0.7)' : palette.muted;
    const statusIconColor = isReadByOther ? palette.accent : statusColor;
    const translation = translations[item.id];
    const desiredTarget = getTargetLangForMessage(item);
    const translatedText =
      translation && translation.target === desiredTarget ? translation.text : undefined;
    const translating = translatingMap[item.id];
    const showParticleEffect = !!showParticles[item.id];
    const displayText =
      translateAllEnabled && translatedText !== undefined
        ? translatedText || item.text || ''
        : item.text || '';
    const showTranslating = translateAllEnabled && translating && translatedText === undefined;
    
    const fadeAnim = fadeValuesRef.current[item.id];
    const scaleAnim = scaleValuesRef.current[item.id];
    
    const crumbleStyle = fadeAnim && scaleAnim ? {
      opacity: fadeAnim,
      transform: [
        { scale: scaleAnim },
        {
          translateX: fadeAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [isMine ? 10 : -10, 0],
          }),
        },
      ],
    } : undefined;

    if (item.location) {
      return (
        <View style={{ position: 'relative' }}>
          <Animated.View
            style={[
              styles.messageRow,
              isMine ? styles.messageRowMine : styles.messageRowOther,
              crumbleStyle,
            ]}
            pointerEvents={isFading ? 'none' : 'auto'}
          >
            <Pressable
              style={[
                styles.locationMessage,
                {
                  borderColor: isMine ? palette.tint : palette.border,
                  backgroundColor: isMine ? `${palette.tint}20` : palette.card,
                },
              ]}
              onPress={() => {
                const { lat, lng } = item.location!;
                const url = Platform.select({
                  ios: `http://maps.apple.com/?ll=${lat},${lng}`,
                  android: `geo:${lat},${lng}`,
                  default: `https://www.google.com/maps?q=${lat},${lng}`,
                });
                if (url) Linking.openURL(url).catch(() => {});
              }}
            >
              <View style={styles.locationRow}>
                <View style={[styles.locationIcon, { backgroundColor: `${palette.tint}18` }]}>
                  <Ionicons name="location" size={16} color={palette.tint} />
                </View>
                <Text style={[styles.locationText, { color: isMine ? '#fff' : palette.text }]}>
                  Posizione
                </Text>
                {isPendingLocation ? (
                  <ActivityIndicator size="small" color={isMine ? '#fff' : palette.text} />
                ) : (
                  <Ionicons name="chevron-forward" size={16} color={isMine ? '#fff' : palette.muted} />
                )}
              </View>
              <View style={styles.statusRow}>
                <Text style={[styles.timeInside, { color: statusColor }]}>{time}</Text>
                {isMine && !isSendingLocal ? (
                  <Ionicons
                    name={isReadByOther ? 'checkmark-done' : 'checkmark'}
                    size={16}
                    color={statusIconColor}
                    style={styles.statusIcon}
                  />
                ) : null}
              </View>
              {isEphemeral ? (
                <View
                  style={[
                    styles.ephemeralRow,
                    {
                      borderColor: isMine ? 'rgba(255,255,255,0.3)' : palette.border,
                      marginTop: 6,
                    },
                  ]}
                >
                  <Ionicons
                    name="timer-outline"
                    size={14}
                    color={isMine ? 'rgba(255,255,255,0.85)' : palette.muted}
                  />
                  <Text
                    style={[
                      styles.ephemeralText,
                      { color: isMine ? 'rgba(255,255,255,0.85)' : palette.muted },
                    ]}
                  >
                    Messaggio a tempo
                  </Text>
                </View>
              ) : null}
            </Pressable>
          </Animated.View>
          
          {showParticleEffect && (
            <ParticleEffect
              visible={showParticleEffect}
              color={isMine ? palette.tint : palette.border}
            />
          )}
        </View>
      );
    }

    if (item.audio) {
      return (
        <View style={{ position: 'relative' }}>
          <Animated.View
            style={[
              styles.messageRow,
              isMine ? styles.messageRowMine : styles.messageRowOther,
              crumbleStyle,
            ]}
            pointerEvents={isFading ? 'none' : 'auto'}
          >
            <Pressable
              style={[
                styles.audioMessage,
                {
                  borderColor: isMine ? palette.tint : palette.border,
                  backgroundColor: isMine ? `${palette.tint}20` : palette.card,
                },
              ]}
              onPress={() => handlePlayAudio(item)}
            >
              <View style={[styles.audioIcon, { backgroundColor: `${palette.tint}18` }]}>
                {isPendingAudio ? (
                  <ActivityIndicator size="small" color={palette.tint} />
                ) : (
                  <Ionicons
                    name={isPlayingThis && loadedPlayback?.isPlaying ? 'pause' : 'play'}
                    size={16}
                    color={palette.tint}
                  />
                )}
              </View>

              <View style={styles.audioContent}>
                <View style={styles.audioProgressRow}>
                  <View
                    style={[
                      styles.audioProgressBar,
                      { backgroundColor: isMine ? 'rgba(255,255,255,0.25)' : palette.border },
                    ]}
                  >
                    <View
                      style={[
                        styles.audioProgressFill,
                        {
                          width: `${Math.min(100, Math.max(0, progress * 100))}%`,
                          backgroundColor: palette.tint,
                        },
                      ]}
                    />
                  </View>
                  <Text
                    style={[
                      styles.audioDuration,
                      { color: isMine ? 'rgba(255,255,255,0.8)' : palette.muted },
                    ]}
                  >
                    {isPlayingThis && loadedPlayback?.durationMillis
                      ? formatAudioDuration(
                          loadedPlayback.positionMillis ?? loadedPlayback.durationMillis
                        )
                      : formatAudioDuration(item.audioDuration)}
                  </Text>
                </View>

                <View style={styles.audioMetaRow}>
                  <Text style={[styles.audioLabel, { color: isMine ? '#fff' : palette.text }]}>
                    Audio
                  </Text>
                  <View style={styles.statusRow}>
                    <Text style={[styles.timeInside, { color: statusColor }]}>{time}</Text>
                    {isMine && !isSendingLocal ? (
                      <Ionicons
                        name={isReadByOther ? 'checkmark-done' : 'checkmark'}
                        size={16}
                        color={statusIconColor}
                        style={styles.statusIcon}
                      />
                    ) : null}
                  </View>
                </View>
              </View>

              {isEphemeral ? (
                <View
                  style={[
                    styles.ephemeralRow,
                    {
                      borderColor: isMine ? 'rgba(255,255,255,0.25)' : palette.border,
                      marginTop: 6,
                    },
                  ]}
                >
                  <Ionicons
                    name="timer-outline"
                    size={14}
                    color={isMine ? 'rgba(255,255,255,0.85)' : palette.muted}
                  />
                  <Text
                    style={[
                      styles.ephemeralText,
                      { color: isMine ? 'rgba(255,255,255,0.85)' : palette.muted },
                    ]}
                  >
                    Messaggio a tempo
                  </Text>
                </View>
              ) : null}
            </Pressable>
          </Animated.View>
          
          {showParticleEffect && (
            <ParticleEffect
              visible={showParticleEffect}
              color={isMine ? palette.tint : palette.border}
            />
          )}
        </View>
      );
    }

    return (
      <View style={{ position: 'relative' }}>
        <Animated.View
          style={[
            styles.messageRow,
            isMine ? styles.messageRowMine : styles.messageRowOther,
            crumbleStyle,
          ]}
          pointerEvents={isFading ? 'none' : 'auto'}
        >
          <View
            style={[
              styles.bubble,
              isMine ? styles.bubbleMine : styles.bubbleOther,
              {
                backgroundColor: isMine ? palette.tint : palette.card,
                borderColor: isMine ? palette.tint : palette.border,
              },
            ]}
          >
            {item.image ? (
              <Pressable
                style={styles.imageWrapper}
                onPress={() => handleOpenImageMessage(item)}
                disabled={isPendingImage}
              >
                <Image
                  source={{ uri: item.image }}
                  style={[styles.chatImage, isLockedImage && styles.chatImageLocked]}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  blurRadius={isLockedImage ? 20 : 0}
                />
                {isLockedImage ? (
                  <View style={styles.imageLockOverlay}>
                    <View style={styles.imageLockBadge}>
                      <Ionicons name="eye-off-outline" size={18} color="#fff" />
                    </View>
                    <Text style={styles.imageLockText}>Foto a tempo - tocca per aprire</Text>
                  </View>
                ) : null}
                {isPendingImage && (
                  <View style={styles.pendingOverlay}>
                    <ActivityIndicator size="small" color="#fff" />
                  </View>
                )}
              </Pressable>
            ) : null}

            {isEphemeral ? (
              <View
                style={[
                  styles.ephemeralRow,
                  { borderColor: isMine ? 'rgba(255,255,255,0.25)' : palette.border },
                ]}
              >
                <Ionicons
                  name="timer-outline"
                  size={14}
                  color={isMine ? '#fff' : palette.muted}
                />
                <Text
                  style={[
                    styles.ephemeralText,
                    { color: isMine ? 'rgba(255,255,255,0.85)' : palette.muted },
                  ]}
                >
                  Messaggio a tempo
                </Text>
              </View>
            ) : null}

            {item.text ? (
              <Text
                style={[
                  styles.bubbleText,
                  { color: isMine ? '#fff' : palette.text },
                ]}
              >
                {displayText}
              </Text>
            ) : null}
            {showTranslating ? (
              <ActivityIndicator size="small" color={isMine ? '#fff' : palette.text} />
            ) : null}

            <View style={styles.statusRow}>
              <Text style={[styles.timeInside, { color: statusColor }]}>{time}</Text>
              {isMine && !isSendingLocal ? (
                <Ionicons
                  name={isReadByOther ? 'checkmark-done' : 'checkmark'}
                  size={16}
                  color={statusIconColor}
                  style={styles.statusIcon}
                />
              ) : null}
            </View>
          </View>
        </Animated.View>
        
        {showParticleEffect && (
          <ParticleEffect
            visible={showParticleEffect}
            color={isMine ? palette.tint : palette.border}
          />
        )}
      </View>
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  headerCenter: {
    flex: 1,
    marginHorizontal: 12,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 2,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  userText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: '400',
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  blockBadge: {
    minWidth: 72,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  blockBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  // Skeleton styles
  skeletonAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 22,
  },
  skeletonText: {
    height: 12,
    borderRadius: 6,
  },
  skeletonTitle: {
    width: 120,
    marginBottom: 6,
  },
  skeletonSubtitle: {
    width: 60,
  },
  skeletonMessages: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 16,
  },
  skeletonBubble: {
    height: 60,
    borderRadius: 20,
    borderWidth: 1,
    maxWidth: '70%',
  },
  skeletonBubbleMine: {
    alignSelf: 'flex-end',
  },
  skeletonBubbleOther: {
    alignSelf: 'flex-start',
  },
  skeletonButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  skeletonInput: {
    flex: 1,
    height: 40,
    borderRadius: 20,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 12,
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyChat: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 40,
  },
  emptyChatText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  loadingText: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  messageRowMine: {
    justifyContent: 'flex-end',
  },
  messageRowOther: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
  },
  bubbleMine: {
    borderBottomRightRadius: 6,
  },
  bubbleOther: {
    borderBottomLeftRadius: 6,
  },
  bubbleText: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '400',
  },
  timeInside: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 6,
    alignSelf: 'flex-end',
    opacity: 0.9,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-end',
  },
  statusIcon: {
    marginLeft: 2,
  },
  ephemeralRow: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
  },
  ephemeralText: {
    fontSize: 12,
    fontWeight: '600',
  },
  imageWrapper: {
    marginVertical: 4,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
  },
  chatImage: {
    width: 240,
    height: 240,
    borderRadius: 16,
  },
  chatImageLocked: {
    opacity: 0.2,
  },
  imageLockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    gap: 10,
  },
  imageLockBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  imageLockText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  locationMessage: {
    flexDirection: 'column',
    gap: 8,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minWidth: 160,
    maxWidth: 240,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  locationIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
  },
  audioMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minWidth: 200,
    maxWidth: 280,
  },
  audioIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioContent: {
    flex: 1,
    gap: 6,
  },
  audioProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  audioProgressBar: {
    flex: 1,
    height: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  audioProgressFill: {
    height: '100%',
    borderRadius: 999,
  },
  audioDuration: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  audioMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  audioLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  pendingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  inputContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  inputWrapper: {
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
  },
  actionsPanel: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '48%',
  },
  actionButtonRow: {
    alignItems: 'flex-start',
  },
  particleHost: {
    position: 'relative',
    overflow: 'visible',
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    fontSize: 12,
    fontWeight: '500',
  },
  actionSubText: {
    fontSize: 11,
    fontWeight: '400',
  },
  actionLabels: {
    flex: 1,
    gap: 2,
  },
  secretBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 14,
    marginHorizontal: 12,
    marginTop: 8,
  },
  secretBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  menuButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    maxHeight: 120,
    minHeight: 40,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    fontWeight: '400',
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    padding: 3,
  },
  sendButtonInner: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonPressed: {
    transform: [{ scale: 0.96 }],
  },
  voiceButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  voiceButtonRecording: {
    backgroundColor: '#ef4444',
    borderColor: '#ef4444',
  },
  recordingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    marginHorizontal: 12,
    marginBottom: 10,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  recordingText: {
    fontSize: 14,
    fontWeight: '600',
  },
  recordingControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginLeft: 'auto',
  },
  recordingButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingCancel: {
    backgroundColor: '#ef4444',
  },
  translationModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  translationModalCard: {
    width: '100%',
    maxWidth: 480,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  translationModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  translationModalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  translationModalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
  },
  translationModalLabelWrap: {
    flex: 1,
  },
  translationModalLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  translationModalHint: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  translationBadge: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    minWidth: 70,
    alignItems: 'center',
  },
  translationCloseButton: {
    backgroundColor: 'transparent',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalImage: {
    width: '100%',
    height: '70%',
  },
  modalHeader: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  cancelButton: {},
  modalFooter: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  modalHint: {
    position: 'absolute',
    bottom: 30,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  modalHintText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    flexShrink: 1,
  },
  timedToggleWrapper: {
    position: 'absolute',
    top: 110,
    left: 20,
    right: 20,
  },
  timedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  timedToggleIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timedToggleText: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  modalActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    gap: 8,
  },
  cancelActionButton: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  confirmActionButton: {
    backgroundColor: '#22c55e',
  },
  modalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonIcon: {
    marginRight: 4,
  },
});
