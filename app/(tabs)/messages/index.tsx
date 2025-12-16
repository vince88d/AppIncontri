import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { db } from '@/lib/firebase';

type ChatPreview = {
  id: string;
  participants: string[];
  lastMessage?: string;
  lastSender?: string;
  updatedAt?: any;
  names?: Record<string, string>;
  photos?: Record<string, string>;
};

const FALLBACK_PHOTO = 'https://ui-avatars.com/api/?name=User&background=random';

export default function MessagesListScreen() {
  const { user } = useAuth();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

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

      setChats(chatList);
      setLoading(false);
    }, (error) => {
      console.error('Error fetching chats:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user?.uid]);

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

    const hasUnread = item.lastSender && item.lastSender !== user?.uid;

    return (
      <Pressable
        onPress={() => {
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
          </View>
        )}
      </Pressable>
    );
  };

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

      {/* Lista chat */}
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
  listContent: {
    padding: 12,
    paddingBottom: 20,
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
  unreadDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: 8,
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
