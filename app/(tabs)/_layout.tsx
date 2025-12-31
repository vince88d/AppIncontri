import Ionicons from '@expo/vector-icons/Ionicons';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { Redirect, Tabs } from 'expo-router';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View, useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useProfile } from '@/hooks/use-profile';
import { db } from '@/lib/firebase';

export default function TabsLayout() {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const { user, loading } = useAuth();
  const { profile, loading: loadingProfile } = useProfile(user?.uid);
  const [unreadCount, setUnreadCount] = useState(0);
  const [interestsUnread, setInterestsUnread] = useState(0);
  const [tapResponsesUnread, setTapResponsesUnread] = useState(0);

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(collection(db, 'chats'), where('participants', 'array-contains', user.uid));
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => d.data() as any);
      const count = items.filter((c) => {
        if (!c.lastSender || c.lastSender === user.uid) return false;
        const updated = c.updatedAt?.toDate ? c.updatedAt.toDate().getTime() : 0;
        const read = c.readBy?.[user.uid]?.toDate ? c.readBy[user.uid].toDate().getTime() : 0;
        if (!updated) return true;
        return updated > read;
      }).length;
      setUnreadCount(count);
    });
    return unsub;
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = onSnapshot(doc(db, 'profiles', user.uid), (snap) => {
      if (!snap.exists()) {
        setInterestsUnread(0);
        setTapResponsesUnread(0);
        return;
      }
      const data = snap.data() as any;
      const interestedBy = Array.isArray(data.interestedBy) ? data.interestedBy : [];
      const interestsSeen = Array.isArray(data.interestsSeen) ? data.interestsSeen : [];
      const unread = interestedBy.filter((id: string) => !interestsSeen.includes(id)).length;
      setInterestsUnread(unread);
      const rawTapResponses =
        data.tapResponses && typeof data.tapResponses === 'object' ? data.tapResponses : {};
      const tapResponseIds = Object.keys(rawTapResponses);
      const tapResponsesSeen = Array.isArray(data.tapResponsesSeen) ? data.tapResponsesSeen : [];
      const tapUnread = tapResponseIds.filter((id: string) => !tapResponsesSeen.includes(id)).length;
      setTapResponsesUnread(tapUnread);
    });
    return unsub;
  }, [user?.uid]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={palette.tint} />
      </View>
    );
  }

  if (!user) return <Redirect href="/auth" />;

  if (loadingProfile) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={palette.tint} />
      </View>
    );
  }

  if (!profile) {
    return <Redirect href="/profile/setup" />;
  }

  const totalUnread = unreadCount + interestsUnread + tapResponsesUnread;

  return (
    <Tabs
      screenOptions={({ route }) => {
        const focused = getFocusedRouteNameFromRoute(route) ?? route.name;
        const hideTab = route.name === 'messages';
        return {
          headerShown: false,
          tabBarActiveTintColor: palette.tint,
          tabBarStyle: hideTab ? { display: 'none' } : undefined,
        };
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Per te',
          tabBarIcon: ({ color, size }) => <Ionicons name="flame" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="groups"
        options={{
          title: 'Gruppi',
          tabBarLabel: 'Gruppi',
          href: '/groups',
          tabBarIcon: ({ color, size }) => <Ionicons name="people" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messaggi',
          tabBarLabel: 'Messaggi',
          href: '/messages',
          unmountOnBlur: true,
          tabBarIcon: ({ color, size }) => (
            <View>
              <Ionicons name="mail" color={color} size={size} />
              {totalUnread > 0 && (
                <View
                  style={{
                    position: 'absolute',
                    top: -6,
                    right: -10,
                    minWidth: 18,
                    height: 18,
                    borderRadius: 9,
                    backgroundColor: palette.tint,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 4,
                  }}>
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
                    {totalUnread > 99 ? '99+' : totalUnread}
                  </Text>
                </View>
              )}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="settings/index"
        options={{
          title: 'Impostazioni',
          tabBarLabel: 'Impostazioni',
          href: '/settings',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings/blocked"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="favorites/index"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
