import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import {
  collection,
  doc,
  arrayRemove,
  arrayUnion,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useProfile } from '@/hooks/use-profile';
import { db } from '@/lib/firebase';

type ChatPreview = {
  id: string;
  participants: string[];
  lastMessage?: string;
  lastSender?: string;
  updatedAt?: any;
  names?: Record<string, string>;
  photos?: Record<string, string>;
  blockedBy?: Record<string, any>;
  readBy?: Record<string, any>;
};

type ProfilePreview = {
  id: string;
  name: string;
  photo?: string;
  age?: number;
  city?: string;
};

type TapResponseItem = ProfilePreview & {
  response: 'no' | 'maybe' | 'match';
};

type InterestListItem = ProfilePreview & {
  kind: 'incoming' | 'response';
  response?: 'no' | 'maybe' | 'match';
};

const FALLBACK_PHOTO = 'https://ui-avatars.com/api/?name=User&background=random';

export default function MessagesListScreen() {
  const { user } = useAuth();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const { profile: myProfile } = useProfile(user?.uid);
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const navigation = useNavigation();
  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingChatId, setOpeningChatId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'chats' | 'interests'>(
    tab === 'interests' ? 'interests' : 'chats'
  );
  const [interests, setInterests] = useState<ProfilePreview[]>([]);
  const [interestsLoading, setInterestsLoading] = useState(false);
  const [interestsRefreshing, setInterestsRefreshing] = useState(false);
  const [interestsUnread, setInterestsUnread] = useState(0);
  const [interestedByIds, setInterestedByIds] = useState<string[]>([]);
  const [tapResponses, setTapResponses] = useState<TapResponseItem[]>([]);
  const [tapResponsesUnread, setTapResponsesUnread] = useState(0);
  const [tapResponseIds, setTapResponseIds] = useState<string[]>([]);
  const [tapResponsesSeenIds, setTapResponsesSeenIds] = useState<string[]>([]);
  const [respondingInterest, setRespondingInterest] = useState<Record<string, boolean>>({});
  const [isScreenFocused, setIsScreenFocused] = useState(false);
  const resetGuardRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      setOpeningChatId(null);
      setIsScreenFocused(true);
      const state = navigation.getState();
      const routes = state?.routes ?? [];
      const firstRoute = routes[0]?.name;
      const needsReset = routes.length > 1 || firstRoute !== 'index';
      if (needsReset && !resetGuardRef.current) {
        resetGuardRef.current = true;
        navigation.reset({
          index: 0,
          routes: [{ name: 'index' as never }],
        });
      }
      return () => {
        setIsScreenFocused(false);
        setActiveTab('chats');
        resetGuardRef.current = false;
      };
    }, [navigation])
  );

  useEffect(() => {
    if (!user?.uid) {
      setChats([]);
      setLoading(false);
      return;
    }
    setLoading(true);

    const q = query(
      collection(db, 'chats'),
      where('participants', 'array-contains', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const chatList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as ChatPreview));

      // Ordina per data di aggiornamento
      chatList.sort((a, b) => {
        const aTime = a.updatedAt?.toDate ? a.updatedAt.toDate().getTime() : 0;
        const bTime = b.updatedAt?.toDate ? b.updatedAt.toDate().getTime() : 0;
        return bTime - aTime;
      });

      const visible = chatList.filter((c) => {
        const blocked = c.blockedBy && Object.keys(c.blockedBy).length > 0;
        return !blocked;
      });

      setChats(visible);
      setLoading(false);
    }, (error) => {
      console.error('Error fetching chats:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) {
      setInterestsUnread(0);
      setInterestedByIds([]);
      return;
    }
    const unsub = onSnapshot(doc(db, 'profiles', user.uid), (snap) => {
      if (!snap.exists()) {
        setInterestsUnread(0);
        setInterestedByIds([]);
        setTapResponsesUnread(0);
        setTapResponseIds([]);
        setTapResponsesSeenIds([]);
        return;
      }
      const data = snap.data() as any;
      const interestedBy = Array.isArray(data.interestedBy) ? data.interestedBy : [];
      const interestsSeen = Array.isArray(data.interestsSeen) ? data.interestsSeen : [];
      const unread = interestedBy.filter((id: string) => !interestsSeen.includes(id)).length;
      setInterestsUnread(unread);
      setInterestedByIds(interestedBy);
      const rawTapResponses =
        data.tapResponses && typeof data.tapResponses === 'object' ? data.tapResponses : {};
      const tapResponseIds = Object.keys(rawTapResponses);
      const tapResponsesSeen = Array.isArray(data.tapResponsesSeen) ? data.tapResponsesSeen : [];
      const tapUnread = tapResponseIds.filter((id: string) => !tapResponsesSeen.includes(id)).length;
      setTapResponsesUnread(tapUnread);
      setTapResponseIds(tapResponseIds);
      setTapResponsesSeenIds(tapResponsesSeen);
    });
    return unsub;
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    if (!isScreenFocused) return;
    if (activeTab !== 'interests') return;
    if (interestsUnread === 0) return;
    if (interestedByIds.length === 0) return;
    updateDoc(doc(db, 'profiles', user.uid), { interestsSeen: interestedByIds }).catch(() => {
      // noop
    });
  }, [activeTab, interestsUnread, interestedByIds, user?.uid, isScreenFocused]);

  useEffect(() => {
    if (!user?.uid) return;
    if (!isScreenFocused) return;
    if (activeTab !== 'interests') return;
    if (tapResponsesUnread === 0) return;
    if (tapResponseIds.length === 0) return;
    updateDoc(doc(db, 'profiles', user.uid), { tapResponsesSeen: tapResponseIds }).catch(() => {
      // noop
    });
  }, [activeTab, tapResponsesUnread, tapResponseIds, user?.uid, isScreenFocused]);

  const loadInterests = async (isRefresh = false) => {
    if (!user?.uid) {
      setInterests([]);
      setInterestsLoading(false);
      return;
    }
    if (isRefresh) setInterestsRefreshing(true);
    else setInterestsLoading(true);
    try {
      const snap = await getDoc(doc(db, 'profiles', user.uid));
      const data = snap.exists() ? (snap.data() as any) : {};
      const interestedBy = Array.isArray(data.interestedBy) ? data.interestedBy : [];
      const myBlocked = Array.isArray(data.blocked) ? data.blocked : [];
      const myBlockedBy = Array.isArray(data.blockedBy) ? data.blockedBy : [];

      const profiles = await Promise.all(
        interestedBy.map(async (id: string) => {
          const pSnap = await getDoc(doc(db, 'profiles', id));
          if (!pSnap.exists()) return null;
          const pData = pSnap.data() as any;
          const blockedByTarget = Array.isArray(pData.blocked) && pData.blocked.includes(user.uid);
          const targetSaysNo =
            Array.isArray(pData.blockedBy) && pData.blockedBy.includes(user.uid);
          const iBlocked = myBlocked.includes(pSnap.id);
          const iAmBlockedBy = myBlockedBy.includes(pSnap.id);
          if (blockedByTarget || targetSaysNo || iBlocked || iAmBlockedBy) return null;
          return {
            id: pSnap.id,
            name: pData.name ?? 'Utente',
            photo: pData.photo ?? pData.photos?.[0] ?? '',
            age: pData.age,
            city: pData.city,
          } as ProfilePreview;
        })
      );
      setInterests(profiles.filter(Boolean) as ProfilePreview[]);
      const rawTapResponses =
        data.tapResponses && typeof data.tapResponses === 'object' ? data.tapResponses : {};
      const tapResponseEntries = Object.entries(rawTapResponses).filter((entry) => {
        const response = entry[1];
        return response === 'no' || response === 'maybe' || response === 'match';
      }) as [string, 'no' | 'maybe' | 'match'][];
      if (tapResponseEntries.length) {
        const responseProfiles = await Promise.all(
          tapResponseEntries.map(async ([id, response]) => {
            const pSnap = await getDoc(doc(db, 'profiles', id));
            if (!pSnap.exists()) return null;
            const pData = pSnap.data() as any;
            const blockedByTarget =
              Array.isArray(pData.blocked) && pData.blocked.includes(user.uid);
            const targetSaysNo =
              Array.isArray(pData.blockedBy) && pData.blockedBy.includes(user.uid);
            const iBlocked = myBlocked.includes(pSnap.id);
            const iAmBlockedBy = myBlockedBy.includes(pSnap.id);
            if (blockedByTarget || targetSaysNo || iBlocked || iAmBlockedBy) return null;
            return {
              id: pSnap.id,
              name: pData.name ?? 'Utente',
              photo: pData.photo ?? pData.photos?.[0] ?? '',
              age: pData.age,
              city: pData.city,
              response,
            } as TapResponseItem;
          })
        );
        const filtered = responseProfiles.filter(Boolean) as TapResponseItem[];
        const responsePriority: Record<TapResponseItem['response'], number> = {
          match: 0,
          maybe: 1,
          no: 2,
        };
        filtered.sort((a, b) => responsePriority[a.response] - responsePriority[b.response]);
        setTapResponses(filtered);
      } else {
        setTapResponses([]);
      }
    } catch (e) {
      setInterests([]);
      setTapResponses([]);
    } finally {
      if (isRefresh) setInterestsRefreshing(false);
      else setInterestsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'interests') {
      loadInterests();
    }
  }, [activeTab, user?.uid]);

  useEffect(() => {
    if (tab === 'interests') {
      setActiveTab('interests');
    } else if (tab === 'chats') {
      setActiveTab('chats');
    }
  }, [tab]);


  const handleInterestResponse = async (
    target: ProfilePreview,
    response: 'no' | 'match' | 'maybe'
  ) => {
    if (!user?.uid) return;
    if (respondingInterest[target.id]) return;
    setRespondingInterest((prev) => ({ ...prev, [target.id]: true }));
    try {
      const myUpdates: Record<string, any> = {
        interestedBy: arrayRemove(target.id),
        interestsSeen: arrayRemove(target.id),
      };
      const targetUpdates: Record<string, any> = {
        interested: arrayRemove(user.uid),
      };
      targetUpdates[`tapResponses.${user.uid}`] = response;
      targetUpdates.tapResponsesSeen = arrayRemove(user.uid);
      if (response === 'match') {
        myUpdates.matches = arrayUnion(target.id);
        targetUpdates.matches = arrayUnion(user.uid);
      }
      await Promise.all([
        updateDoc(doc(db, 'profiles', user.uid), myUpdates),
        updateDoc(doc(db, 'profiles', target.id), targetUpdates),
      ]);
      if (response === 'match') {
        const chatId = [user.uid, target.id].sort().join('_');
        const myName = myProfile?.name || user.displayName || 'Utente';
        const myPhoto = myProfile?.photo || (myProfile as any)?.photos?.[0] || '';
        const otherName = target.name || 'Utente';
        const otherPhoto = target.photo || '';
        const messageText = 'Match confermato!';
        await setDoc(
          doc(db, 'chats', chatId),
          {
            participants: [user.uid, target.id],
            updatedAt: serverTimestamp(),
            lastMessage: messageText,
            lastSender: user.uid,
            names: {
              [target.id]: otherName,
              [user.uid]: myName,
            },
            photos: {
              [target.id]: otherPhoto,
              [user.uid]: myPhoto,
            },
          },
          { merge: true }
        );
        await setDoc(
          doc(db, 'chats', chatId, 'messages', `match-${chatId}`),
          {
            id: `match-${chatId}`,
            text: messageText,
            senderId: user.uid,
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      setInterests((prev) => prev.filter((item) => item.id !== target.id));
    } catch (e) {
      // noop
    } finally {
      setRespondingInterest((prev) => ({ ...prev, [target.id]: false }));
    }
  };

  const renderChatItem = ({ item }: { item: ChatPreview }) => {
    const otherId = item.participants.find(id => id !== user?.uid);
    const otherName = item.names?.[otherId || ''] || 'Utente';
    const otherPhoto = item.photos?.[otherId || ''] || FALLBACK_PHOTO;
    
    // Formatta la data
    let displayTime = '';
    if (item.updatedAt?.toDate) {
      const date = item.updatedAt.toDate();
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      
      if (isToday) {
        displayTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else {
        displayTime = date.toLocaleDateString([], { day: 'numeric', month: 'short' });
      }
    }

    const hasUnread = (() => {
      if (!item.lastSender || item.lastSender === user?.uid) return false;
      const updated = item.updatedAt?.toDate ? item.updatedAt.toDate().getTime() : 0;
      const read = item.readBy?.[user?.uid || '']?.toDate
        ? item.readBy[user?.uid || ''].toDate().getTime()
        : 0;
      if (!updated) return true;
      return updated > read;
    })();

    return (
      <Pressable
        onPress={() => {
          if (openingChatId === item.id) return;
          setOpeningChatId(item.id);

          // Segna come letto se non l'hai già fatto
          if (hasUnread && user?.uid) {
            setDoc(
              doc(db, 'chats', item.id),
              { readBy: { [user.uid]: serverTimestamp() } },
              { merge: true }
            );
          }
          
          // Naviga alla chat
          router.push({
            pathname: `/messages/${otherId}`,
            params: { 
              name: otherName, 
              photo: otherPhoto, 
              chatId: item.id 
            }
          });
        }}
      >
        {({ pressed }) => (
          <View style={[
            styles.chatCard,
            {
              backgroundColor: palette.card,
              borderColor: palette.border,
              opacity: pressed ? 0.9 : 1,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            }
          ]}>
            {/* Indicatore non letto laterale */}
            {hasUnread && (
              <View style={[styles.unreadSideIndicator, { backgroundColor: palette.tint }]} />
            )}

            {/* Avatar con bordo più spesso e leggermente più grande */}
            <View style={[styles.avatarWrapper, { borderColor: palette.border }]}>
              <Image
                source={{ uri: otherPhoto }}
                style={styles.avatar}
                contentFit="cover"
              />
            </View>

            {/* Contenuto chat */}
            <View style={styles.chatContent}>
              <View style={styles.chatHeader}>
                <Text style={[styles.chatName, { color: palette.text }]}>
                  {otherName}
                </Text>
                {displayTime ? (
                  <Text style={[styles.time, { color: palette.muted }]}>
                    {displayTime}
                  </Text>
                ) : null}
              </View>

              <Text 
                style={[
                  styles.messagePreview, 
                  { 
                    color: palette.muted,
                    fontWeight: hasUnread ? '600' : '400'
                  }
                ]}
                numberOfLines={2}
              >
                {item.lastMessage || 'Inizia la conversazione'}
              </Text>
            </View>

            {/* Badge non letto (se applicabile) - ora è un pallino invece che "Nuovo" */}
            {hasUnread && (
              <View style={[styles.unreadDot, { backgroundColor: palette.tint }]} />
            )}
            {openingChatId === item.id && (
              <View style={styles.cardLoader}>
                <ActivityIndicator size="small" color={palette.tint} />
              </View>
            )}
          </View>
        )}
      </Pressable>
    );
  };

  const renderInterestItem = ({ item }: { item: InterestListItem }) => {
    const hasPhoto = !!item.photo;
    const isResponding = !!respondingInterest[item.id];
    const isResponse = item.kind === 'response';
    const responseMeta: Record<
      NonNullable<InterestListItem['response']>,
      { label: string; icon: keyof typeof Ionicons.glyphMap; tone: string }
    > = {
      match: { label: 'Accettato', icon: 'checkmark-circle', tone: '#22c55e' },
      maybe: { label: 'Forse', icon: 'help-circle', tone: '#f59e0b' },
      no: { label: 'No', icon: 'ban', tone: '#ef4444' },
    };
    const responseInfo = item.response ? responseMeta[item.response] : null;
    const isUnreadResponse = !!item.response && !tapResponsesSeenIds.includes(item.id);
    return (
      <View
        style={[
          styles.interestCard,
          {
            borderColor: isUnreadResponse ? palette.tint : palette.border,
            backgroundColor: isUnreadResponse ? `${palette.tint}10` : palette.card,
          },
        ]}
      >
        <Pressable
          style={styles.interestHeader}
          onPress={() => router.push(`/profile/${item.id}`)}
        >
          <View style={styles.interestLeft}>
            {hasPhoto ? (
              <View style={[styles.interestAvatar, { borderColor: palette.border }]}>
                <Image
                  source={{ uri: item.photo }}
                  style={styles.interestAvatarImage}
                  contentFit="cover"
                />
              </View>
            ) : (
              <View
                style={[
                  styles.interestAvatar,
                  styles.interestAvatarPlaceholder,
                  { borderColor: palette.border, backgroundColor: palette.border },
                ]}
              >
                <Ionicons name="image-outline" size={20} color={palette.muted} />
              </View>
            )}
            <View>
              <Text style={[styles.chatName, { color: palette.text }]} numberOfLines={1}>
                {item.name}
                {item.age ? `, ${item.age}` : ''}
              </Text>
              {item.city ? (
                <Text style={[styles.cityText, { color: palette.muted }]} numberOfLines={1}>
                  {item.city}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={styles.interestRight}>
            {responseInfo ? (
              <View
                style={[
                  styles.interestStatusBadge,
                  {
                    borderColor: responseInfo.tone,
                    backgroundColor: `${responseInfo.tone}1A`,
                  },
                ]}
              >
                <Ionicons name={responseInfo.icon} size={14} color={responseInfo.tone} />
                <Text style={[styles.interestStatusText, { color: responseInfo.tone }]}>
                  {responseInfo.label}
                </Text>
              </View>
            ) : null}
            <Ionicons name="chevron-forward" size={18} color={palette.muted} />
          </View>
        </Pressable>
        {!isResponse && (
          <View style={styles.interestActionsRow}>
            <Pressable
              style={[
                styles.interestAction,
                styles.interestActionOutline,
                { borderColor: palette.border },
              ]}
              onPress={() => handleInterestResponse(item, 'no')}
              disabled={isResponding}
            >
              <Ionicons name="close" size={16} color={palette.text} />
              <Text style={[styles.interestActionText, { color: palette.text }]}>No</Text>
            </Pressable>
            <Pressable
              style={[
                styles.interestAction,
                styles.interestActionOutline,
                { borderColor: palette.border },
              ]}
              onPress={() => handleInterestResponse(item, 'maybe')}
              disabled={isResponding}
            >
              <Ionicons name="help-circle-outline" size={16} color={palette.text} />
              <Text style={[styles.interestActionText, { color: palette.text }]}>Forse</Text>
            </Pressable>
            <Pressable
              style={[
                styles.interestAction,
                { backgroundColor: palette.tint, borderColor: palette.tint },
              ]}
              onPress={() => handleInterestResponse(item, 'match')}
              disabled={isResponding}
            >
              <Ionicons name="checkmark" size={16} color="#fff" />
              <Text style={[styles.interestActionText, styles.interestActionTextSolid]}>
                Anche io
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  const totalInterestsBadge = interestsUnread + tapResponsesUnread;
  const interestItems = useMemo<InterestListItem[]>(() => {
    const responseMap = new Map(tapResponses.map((item) => [item.id, item.response]));
    const incomingItems = interests.map((item) => ({
      ...item,
      kind: 'incoming' as const,
      response: responseMap.get(item.id),
    }));
    const incomingIds = new Set(interests.map((item) => item.id));
    const responseOnlyItems = tapResponses
      .filter((item) => !incomingIds.has(item.id))
      .map((item) => ({ ...item, kind: 'response' as const }));
    return [...incomingItems, ...responseOnlyItems];
  }, [interests, tapResponses]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: palette.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        <Pressable 
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.backButton,
            pressed && { opacity: 0.7 }
          ]}
        >
          <Ionicons name="arrow-back" size={24} color={palette.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: palette.text }]}>
          Messaggi
        </Text>
        <View style={styles.headerRight} />
      </View>

      <View style={styles.segmentedWrap}>
        <View
          style={[
            styles.segmentedControl,
            { backgroundColor: palette.card, borderColor: palette.border },
          ]}
        >
          <Pressable
            style={[
              styles.segment,
              activeTab === 'chats' && { backgroundColor: palette.tint },
            ]}
            onPress={() => setActiveTab('chats')}
          >
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={16}
              color={activeTab === 'chats' ? '#fff' : palette.text}
            />
            <Text
              style={[
                styles.segmentText,
                { color: activeTab === 'chats' ? '#fff' : palette.text },
              ]}
            >
              Chat
            </Text>
            {(() => {
              const unreadChatCount = chats.filter((chat) => {
                if (!chat.lastSender || chat.lastSender === user?.uid) return false;
                const updated = chat.updatedAt?.toDate ? chat.updatedAt.toDate().getTime() : 0;
                const read = chat.readBy?.[user?.uid || '']?.toDate
                  ? chat.readBy[user?.uid || ''].toDate().getTime()
                  : 0;
                if (!updated) return true;
                return updated > read;
              }).length;
              if (!unreadChatCount) return null;
              return (
                <View style={[styles.segmentBadge, { backgroundColor: palette.accent }]}>
                  <Text style={styles.segmentBadgeText}>
                    {unreadChatCount > 99 ? '99+' : unreadChatCount}
                  </Text>
                </View>
              );
            })()}
          </Pressable>
          <Pressable
            style={[
              styles.segment,
              activeTab === 'interests' && { backgroundColor: palette.tint },
            ]}
            onPress={() => setActiveTab('interests')}
          >
            <Ionicons
              name="heart-outline"
              size={16}
              color={activeTab === 'interests' ? '#fff' : palette.text}
            />
            <Text
              style={[
                styles.segmentText,
                { color: activeTab === 'interests' ? '#fff' : palette.text },
              ]}
            >
              Interessi
            </Text>
            {totalInterestsBadge > 0 ? (
              <View style={[styles.segmentBadge, { backgroundColor: palette.tint }]}>
                <Text style={styles.segmentBadgeText}>
                  {totalInterestsBadge > 99 ? '99+' : totalInterestsBadge}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>

      {activeTab === 'chats' ? (
        <FlatList
          data={chats}
          keyExtractor={(item) => item.id}
          renderItem={renderChatItem}
          contentContainerStyle={[
            styles.listContent,
            chats.length === 0 && styles.listContentEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={palette.tint} />
                <Text style={[styles.loadingText, { color: palette.muted }]}>
                  Caricamento conversazioni...
                </Text>
              </View>
            ) : (
              <View style={styles.emptyContainer}>
                <View style={[styles.emptyIcon, { backgroundColor: palette.border + '20' }]}>
                  <Ionicons name="chatbubble-outline" size={60} color={palette.muted} />
                </View>
                <Text style={[styles.emptyTitle, { color: palette.text }]}>
                  Nessuna conversazione
                </Text>
                <Text style={[styles.emptySubtitle, { color: palette.muted }]}>
                  Inizia a chattare con qualcuno!
                </Text>
              </View>
            )
          }
          refreshing={loading}
          onRefresh={() => setLoading(true)}
        />
      ) : (
        <FlatList
          data={interestItems}
          keyExtractor={(item) => `${item.kind}-${item.id}`}
          renderItem={renderInterestItem}
          contentContainerStyle={[
            styles.listContent,
            interestItems.length === 0 && styles.listContentEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            interestsLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={palette.tint} />
                <Text style={[styles.loadingText, { color: palette.muted }]}>
                  Caricamento interessi...
                </Text>
              </View>
            ) : interestItems.length === 0 ? (
              <View style={styles.emptyContainer}>
                <View style={[styles.emptyIcon, { backgroundColor: palette.border + '20' }]}>
                  <Ionicons name="heart-outline" size={60} color={palette.muted} />
                </View>
                <Text style={[styles.emptyTitle, { color: palette.text }]}>
                  Nessun interesse ricevuto
                </Text>
                <Text style={[styles.emptySubtitle, { color: palette.muted }]}>
                  Quando qualcuno ti manda un tap lo vedrai qui.
                </Text>
              </View>
            ) : null
          }
          refreshing={interestsRefreshing}
          onRefresh={() => loadInterests(true)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    flex: 1,
  },
  headerRight: {
    width: 40,
  },
  segmentedWrap: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
  },
  segmentedControl: {
    flex: 1,
    flexDirection: 'row',
    padding: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  segment: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '700',
  },
  segmentBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  segmentBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  listContent: {
    padding: 12,
    paddingBottom: 20,
    paddingTop: 8,
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  chatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    position: 'relative',
    minHeight: 80, // Altezza minima per la card
  },
  unreadSideIndicator: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  avatarWrapper: {
    width: 60,
    height: 60,
    borderRadius: 30,
    overflow: 'hidden',
    marginRight: 12,
    borderWidth: 2,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  chatContent: {
    flex: 1,
    justifyContent: 'center',
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  chatName: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  time: {
    fontSize: 12,
    marginLeft: 8,
  },
  messagePreview: {
    fontSize: 14,
    lineHeight: 18,
  },
  interestCard: {
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    padding: 14,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  interestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  interestLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  interestAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    overflow: 'hidden',
    borderWidth: 1,
  },
  interestAvatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  interestAvatarImage: {
    width: '100%',
    height: '100%',
  },
  interestRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  interestStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  interestStatusText: {
    fontSize: 12,
    fontWeight: '800',
  },
  cityText: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
  },
  interestActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  interestAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  interestActionOutline: {
    backgroundColor: 'transparent',
  },
  interestActionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  interestActionTextSolid: {
    color: '#fff',
  },
  unreadDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: 8,
  },
  cardLoader: {
    position: 'absolute',
    right: 12,
    top: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  emptyIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
