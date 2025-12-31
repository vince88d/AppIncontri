import { collection, getDocs } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';

import { db } from '@/lib/firebase';

type Profile = {
  id: string;
  name: string;
  age: number;
  city: string;
  distanceKm: number;
  photo: string;
  photos?: string[];
  interests: string[];
  bio?: string;
  jobTitle?: string;
  blocked?: string[];
  blockedBy?: string[];
};

export type { Profile };

export function useProfiles() {
  const [data, setData] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const activeRef = useRef(true);

  const fetchProfiles = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const snap = await getDocs(collection(db, 'profiles'));
      if (!activeRef.current) return;
      const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Profile));
      setData(items);
      setError(null);
    } catch (err) {
      if (!activeRef.current) return;
      setError(err as Error);
    } finally {
      if (!activeRef.current) return;
      if (isRefresh) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    activeRef.current = true;
    fetchProfiles();
    return () => {
      activeRef.current = false;
    };
  }, []);

  return { data, loading, error, refresh: () => fetchProfiles(true), refreshing };
}
